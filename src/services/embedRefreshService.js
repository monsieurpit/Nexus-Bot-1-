// One-time restyle of messages Nexus already posted, after an embed design update is deployed.
//
// Panels posted before an update keep their old look until something edits them. On the first
// start of a new EMBED_STYLE_VERSION, each server is walked once:
//   - ticket panel and verification panel are re-rendered with the shared builders (utils/panels.js);
//   - reaction-role panels and open tickets' header messages keep their content (staff-written
//     text, claim/priority state) and get the new colours + Nexus footer;
//   - active giveaways are re-rendered from their stored data; ended ones are restyled.
// Anything that can't be updated (message deleted, channel gone, missing permissions) is listed
// in ONE embed sent to the server's staff log channel (or the owner by DM) with the exact command
// to re-post it. Nothing is ever deleted or re-posted automatically.
import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { db, getGuildConfig, setGuildConfig } from '../utils/database.js';
import { createEmbed } from '../utils/embeds.js';
import { buildTicketPanel, buildVerificationPanel, findTicketPanelMessage, restyleEmbed } from '../utils/panels.js';

// Bump this whenever the look of posted panels changes; every server is refreshed once per value.
export const EMBED_STYLE_VERSION = '2026-11-nexus-theme-1';
const versionKey = (guildId) => `nexus:embedstyle:${guildId}`;
const EDIT_GAP_MS = 700; // gentle on Discord rate limits — this runs in the background
const MAX_EDITS_PER_KIND = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasButton = (msg, customId) =>
  msg?.components?.some((row) => row.components?.some((c) => c.customId === customId));

function explainFailure(error) {
  if (error?.code === 50013 || error?.code === 50001) return "I'm missing permissions there (View Channel, Read Message History, Send Messages, Embed Links)";
  if (error?.code === 10008) return 'the message was deleted';
  if (error?.code === 10003) return 'the channel was deleted';
  return 'Discord refused the edit';
}

async function edit(message, payload, report, what, fix) {
  try {
    await message.edit(payload);
    report.updated++;
    await sleep(EDIT_GAP_MS);
    return true;
  } catch (error) {
    report.todo.push({ what, where: message.channel ? `${message.channel}` : null, why: explainFailure(error), fix });
    return false;
  }
}

async function refreshTicketPanel(client, guild, config, report) {
  if (!config.ticketPanelChannelId) return;
  const fix = 'Run `/ticket setup` to post a fresh panel.';
  const { channel, message } = await findTicketPanelMessage(client, guild, config);
  if (!channel) {
    report.todo.push({ what: '🎫 Ticket panel', where: null, why: 'its channel no longer exists', fix });
    return;
  }
  if (!message) {
    report.todo.push({ what: '🎫 Ticket panel', where: `${channel}`, why: "I couldn't find the panel message", fix });
    return;
  }
  const ok = await edit(message, buildTicketPanel({ message: config.ticketPanelMessage, buttonLabel: config.ticketButtonLabel, guild }),
    report, '🎫 Ticket panel', fix);
  // Remember the message ID so future updates don't need to search for it.
  if (ok && config.ticketPanelMessageId !== message.id) {
    await setGuildConfig(client, guild.id, { ticketPanelMessageId: message.id }).catch(() => null);
  }
}

async function refreshVerificationPanel(client, guild, config, report) {
  const v = config.verification;
  if (!v?.enabled || !v.channelId) return;
  const fix = 'Run `/verification setup` (or `/verification dashboard`) to post a fresh panel.';
  const channel = await guild.channels.fetch(v.channelId).catch(() => null);
  if (!channel?.messages) {
    report.todo.push({ what: '✅ Verification panel', where: null, why: 'its channel no longer exists', fix });
    return;
  }
  const message = v.messageId ? await channel.messages.fetch(v.messageId).catch(() => null) : null;
  if (!message || !hasButton(message, 'verify_user')) {
    report.todo.push({ what: '✅ Verification panel', where: `${channel}`, why: "I couldn't find the panel message", fix });
    return;
  }
  await edit(message, buildVerificationPanel({ message: v.message, buttonText: v.buttonText, guild }), report, '✅ Verification panel', fix);
}

async function refreshReactionRolePanels(client, guild, report) {
  const { getAllReactionRoleMessages } = await import('./reactionRoleService.js');
  const panels = await getAllReactionRoleMessages(client, guild.id).catch(() => []);
  for (const panel of panels.slice(0, MAX_EDITS_PER_KIND)) {
    const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
    // Deleted panels are cleaned up by reconcileReactionRoleMessages on start; nothing to report.
    if (!message || message.author?.id !== client.user.id || !message.embeds?.length) continue;
    const [first, ...rest] = message.embeds;
    await edit(message, { embeds: [restyleEmbed(first, { fallbackColor: 'community' }), ...rest] }, report,
      '🎭 Reaction-role panel', 'Re-create it with `/reactroles setup`.');
  }
}

async function refreshGiveaways(client, guild, report) {
  const { getGuildGiveaways } = await import('../utils/giveaways.js');
  const { createGiveawayEmbed } = await import('./giveawayService.js');
  const giveaways = await getGuildGiveaways(client, guild.id).catch(() => []);
  const recentFirst = [...giveaways].sort((a, b) => (b.endsAt ?? b.endTime ?? 0) - (a.endsAt ?? a.endTime ?? 0));
  for (const g of recentFirst.slice(0, MAX_EDITS_PER_KIND)) {
    if (!g?.channelId || !g?.messageId) continue;
    const channel = await guild.channels.fetch(g.channelId).catch(() => null);
    const message = channel?.messages ? await channel.messages.fetch(g.messageId).catch(() => null) : null;
    if (!message || message.author?.id !== client.user.id) continue; // a deleted giveaway needs no notice
    const embed = g.ended
      ? restyleEmbed(message.embeds?.[0], { fallbackColor: 'giveaway.ended' })
      : createGiveawayEmbed(g, 'active');
    if (!embed) continue;
    await edit(message, { embeds: [embed] }, report, `🎉 Giveaway "${String(g.prize).slice(0, 60)}"`,
      g.ended ? 'No action needed for an ended giveaway.' : 'It still works — only the look could not be updated.');
  }
}

async function refreshOpenTickets(client, guild, report) {
  const keys = await db.list(`guild:${guild.id}:ticket:`).catch(() => []);
  const channelIds = (Array.isArray(keys) ? keys : [])
    .map((k) => k.split(':')[3])
    .filter((id) => /^\d{17,20}$/.test(id || ''));
  let done = 0;
  for (const channelId of channelIds) {
    if (done >= MAX_EDITS_PER_KIND) break;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.messages) continue; // closed & deleted ticket
    const data = await db.get(`guild:${guild.id}:ticket:${channelId}`).catch(() => null);
    if (!data || data.status === 'closed') continue;
    const pinned = await channel.messages.fetchPinned().catch(() => null);
    let header = pinned?.find((m) => m.author?.id === client.user.id && hasButton(m, 'ticket_close'));
    if (!header) {
      const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
      header = recent?.filter((m) => m.author?.id === client.user.id && hasButton(m, 'ticket_close')).last();
    }
    if (!header?.embeds?.length) continue;
    const [first, ...rest] = header.embeds;
    done++;
    await edit(header, { embeds: [restyleEmbed(first, { fallbackColor: 'ticket.open' }), ...rest] }, report,
      '🎫 Open ticket', 'The ticket still works — only its look could not be updated.');
  }
}

/** Where to tell staff about things that need their attention. */
async function staffDestination(client, guild, config) {
  const candidates = [config?.logging?.channelId, config?.logChannelId, config?.raidShield?.notificationChannelId];
  for (const id of candidates.filter(Boolean)) {
    const channel = guild.channels.cache.get(id);
    const me = guild.members.me;
    if (channel?.isTextBased?.() && (!me || channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]))) {
      return channel;
    }
  }
  return null; // falls back to a DM to the owner
}

async function notifyStaff(client, guild, config, report) {
  if (!report.todo.length) return;
  const lines = report.todo.slice(0, 15).map((t) =>
    `**${t.what}**${t.where ? ` in ${t.where}` : ''}\n${t.why}. ${t.fix}`);
  if (report.todo.length > 15) lines.push(`*…and ${report.todo.length - 15} more.*`);
  const embed = createEmbed({
    title: '🎨 Nexus got a new look — a few things need you',
    description:
      `I restyled **${report.updated}** message${report.updated === 1 ? '' : 's'} in **${guild.name}** automatically. ` +
      `These ones I couldn't update by myself:\n\n${lines.join('\n\n')}`,
    color: 'warning',
    footer: 'This notice is sent once per update',
  });
  const channel = await staffDestination(client, guild, config);
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (channel) {
    await channel.send(payload).catch((err) => logger.warn(`Embed refresh notice failed in ${guild.id}: ${err.message}`));
    return;
  }
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send(payload).catch(() => logger.warn(`Embed refresh: could not notify the owner of ${guild.id}`));
}

/** Refreshes one server. Returns { updated, todo } — exported for tests. */
export async function refreshGuildEmbeds(client, guild) {
  const report = { updated: 0, todo: [] };
  const config = await getGuildConfig(client, guild.id);
  await refreshTicketPanel(client, guild, config, report);
  await refreshVerificationPanel(client, guild, config, report);
  await refreshReactionRolePanels(client, guild, report);
  await refreshGiveaways(client, guild, report);
  await refreshOpenTickets(client, guild, report);
  await notifyStaff(client, guild, config, report);
  return report;
}

/** Runs once per server per EMBED_STYLE_VERSION. Safe to call on every start. */
export async function runEmbedRefresh(client) {
  if (!db.getStatus().persistent) {
    // Without persistent storage the "already done" marker would be lost and staff would get the
    // notice on every restart.
    logger.warn('Embed refresh skipped: database is not persistent');
    return;
  }
  let guilds = 0;
  let updated = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      if ((await db.getStrict(versionKey(guild.id))) === EMBED_STYLE_VERSION) continue;
      const report = await refreshGuildEmbeds(client, guild);
      await db.set(versionKey(guild.id), EMBED_STYLE_VERSION);
      guilds++;
      updated += report.updated;
      logger.info(`Embed refresh for ${guild.id}: ${report.updated} updated, ${report.todo.length} need staff`);
    } catch (error) {
      // Not marked as done: retried on the next start.
      logger.warn(`Embed refresh failed for guild ${guild.id}: ${error.message}`);
    }
  }
  if (guilds) logger.info(`Embed refresh complete: ${guilds} server(s), ${updated} message(s) restyled (style ${EMBED_STYLE_VERSION})`);
}
