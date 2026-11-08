// Builders for the long-lived panels Nexus posts in servers. Used both when a panel is first
// posted and by the startup embed refresh (src/services/embedRefreshService.js), so an old panel
// can be re-rendered in place and look exactly like a freshly posted one.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { createEmbed, brandFooter } from './embeds.js';
import { getColor } from '../config/bot.js';

/** Ticket creation panel ("Create Ticket" button, customId create_ticket). */
export function buildTicketPanel({ message, buttonLabel, guild } = {}) {
  const embed = createEmbed({
    author: guild ? { name: `${guild.name} · Support`, iconURL: guild.iconURL?.({ size: 64 }) || undefined } : null,
    title: '🎫 Need a hand?',
    description:
      `${message || 'Click the button below to create a support ticket.'}\n\n` +
      '**How it works**\n' +
      '1️⃣ Press the button below\n' +
      '2️⃣ A private channel opens for you and the staff team\n' +
      '3️⃣ Explain what you need — we\'ll reply as soon as we can',
    color: 'info',
    thumbnail: guild?.iconURL?.({ size: 256 }) || null,
    footer: 'Please open one ticket per issue',
    timestamp: false,
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel((buttonLabel || 'Create Ticket').slice(0, 80))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📩'),
  );
  return { embeds: [embed], components: [row] };
}

/** Verification panel (customId verify_user). */
export function buildVerificationPanel({ message, buttonText, guild } = {}) {
  const embed = createEmbed({
    author: guild ? { name: `Welcome to ${guild.name}`, iconURL: guild.iconURL?.({ size: 64 }) || undefined } : null,
    title: '✅ Verify to get access',
    description: `${message || 'Click the button below to verify yourself and gain access to the server.'}\n\nOne click — it only takes a second.`,
    color: 'success',
    thumbnail: guild?.iconURL?.({ size: 256 }) || null,
    footer: 'Verification keeps bots and raiders out',
    timestamp: false,
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_user')
      .setLabel((buttonText || 'Verify').slice(0, 80))
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
  );
  return { embeds: [embed], components: [row] };
}

// Colours of the previous palette → theme names, so restyled embeds keep their meaning
// (a red "closed" stays red, a yellow "claimed" stays yellow) in the new colours.
const OLD_COLOURS = {
  0x336699: 'primary', 0x5865F2: 'primary', 0x2F3136: 'secondary',
  0x57F287: 'success', 0x2ECC71: 'success', 0x00FF00: 'success',
  0xED4245: 'error', 0xE74C3C: 'error', 0xFF0000: 'error',
  0xFEE75C: 'warning', 0xF1C40F: 'warning', 0xFAA61A: 'warning', 0xF39C12: 'warning',
  0x3498DB: 'info', 0x9B59B6: 'moderation', 0x99AAB5: 'gray', 0x95A5A6: 'gray',
};

/**
 * Re-renders an existing bot embed in the current theme without touching its content: same
 * title, text, fields, images and author; new colour (mapped from the old palette) and the Nexus
 * footer. Used where the content carries state (claimed tickets) or was written by staff
 * (reaction-role panel text). Returns null if there is nothing to restyle.
 */
export function restyleEmbed(oldEmbed, { fallbackColor = 'primary', footerExtra = null } = {}) {
  if (!oldEmbed) return null;
  const data = typeof oldEmbed.toJSON === 'function' ? oldEmbed.toJSON() : { ...(oldEmbed.data || oldEmbed) };
  const embed = new EmbedBuilder(data);
  let color;
  if (data.color == null) color = getColor(fallbackColor);
  else if (OLD_COLOURS[data.color]) color = getColor(OLD_COLOURS[data.color]);
  else color = data.color; // already a theme colour or a deliberate custom one: keep it
  embed.setColor(color);
  const oldFooter = data.footer?.text || '';
  const extra = footerExtra || (oldFooter && !oldFooter.startsWith('Nexus') ? oldFooter : null);
  embed.setFooter(brandFooter(extra));
  return embed;
}

/**
 * Locates the posted ticket panel: by stored message ID when known (panels posted from now on),
 * otherwise the newest bot message with the create_ticket button in the panel channel.
 * Returns { channel, message } (either may be null).
 */
export async function findTicketPanelMessage(client, guild, config) {
  if (!config?.ticketPanelChannelId) return { channel: null, message: null };
  const channel = await guild.channels.fetch(config.ticketPanelChannelId).catch(() => null);
  if (!channel?.messages) return { channel: null, message: null };
  if (config.ticketPanelMessageId) {
    const byId = await channel.messages.fetch(config.ticketPanelMessageId).catch(() => null);
    if (byId) return { channel, message: byId };
  }
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const message = recent?.find((m) =>
    m.author?.id === client.user.id &&
    m.components?.some((row) => row.components?.some((c) => c.customId === 'create_ticket'))) || null;
  return { channel, message };
}
