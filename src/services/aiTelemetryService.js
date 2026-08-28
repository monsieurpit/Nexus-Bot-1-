import { ChannelType } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from './guildConfig.js';

/**
 * Resolves one of the AI-telemetry text channels for a guild — database-backed
 * (guildConfig.js's aiTelemetry.* fields, same Firestore/Postgres store every other per-guild
 * setting in this bot uses, e.g. logging.channelId), configured live via /set-ai-telemetry
 * instead of an env var + redeploy. Checks send/embed permissions along the way. Returns null
 * (never throws) on any failure — same defensive contract as loggingService.js's logEvent(), so a
 * broken/misconfigured/unset channel can never take down the actual AI response path these
 * logging calls are attached to.
 */
async function resolveLogChannel(client, guildId, configKey) {
  if (!guildId) return null;
  try {
    const config = await getGuildConfig(client, guildId);
    const channelId = config?.aiTelemetry?.[configKey];
    if (!channelId) return null;

    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return null;

    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) return null;

    const permissions = channel.permissionsFor(guild.members.me);
    if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks'])) return null;

    return channel;
  } catch (error) {
    logger.warn(`[AI Telemetry] Could not resolve log channel (${configKey}) for guild ${guildId}: ${error.message}`);
    return null;
  }
}

/**
 * Truncates a value to Discord's 1024-char embed field limit, always leaving room for a
 * "truncated" marker so a long stack trace or prompt never silently overflows and gets rejected
 * by Discord's API instead of posted.
 */
function truncateField(value, maxLength = 1000) {
  const str = String(value ?? '');
  if (str.length <= maxLength) return str || '(empty)';
  return `${str.slice(0, maxLength)}\n… (truncated)`;
}

/**
 * #bot-logs — response metrics for every AI reply: latency, detected language, applied
 * temperature, whether the swear floor fired, and a snippet of the prompt that produced it.
 * Fire-and-forget from the caller's perspective — never throws, logs to the console logger and
 * gives up silently on any failure so a broken/misconfigured channel can never affect the actual
 * Discord reply the user is waiting on.
 */
export async function logTelemetry(client, guildId, { latencyMs, language, temperature, swearFloorTriggered, promptSnippet } = {}) {
  try {
    const channel = await resolveLogChannel(client, guildId, 'botLogsChannelId');
    if (!channel) return;

    const embed = createEmbed({
      title: '📡 AI Response Telemetry',
      color: 'info',
      fields: [
        { name: 'Latency', value: latencyMs != null ? `${latencyMs}ms` : 'n/a', inline: true },
        { name: 'Language', value: language ?? 'n/a', inline: true },
        { name: 'Temperature', value: temperature != null ? String(temperature) : 'n/a', inline: true },
        { name: 'Swear Floor', value: swearFloorTriggered ? 'triggered' : 'not needed', inline: true },
        { name: 'Prompt', value: truncateField(promptSnippet, 500) },
      ],
    });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn(`[AI Telemetry] logTelemetry failed: ${error.message}`);
  }
}

/**
 * #prompt-workbench — execution crashes, unhandled exceptions, and AI generation failures, with
 * the triggering input (when available) and a truncated stack trace. Never throws — this is
 * explicitly meant to be safe to call from inside a crash handler, where a second unhandled
 * failure while trying to report the first one would be its own bug.
 */
export async function logCrash(client, guildId, { input, error, source } = {}) {
  try {
    const channel = await resolveLogChannel(client, guildId, 'promptWorkbenchChannelId');
    if (!channel) return;

    const errorMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    const stack = error instanceof Error ? error.stack : undefined;

    const embed = createEmbed({
      title: '💥 Generation Failure / Crash',
      color: 'error',
      fields: [
        { name: 'Source', value: source || 'unknown', inline: true },
        { name: 'Error', value: truncateField(errorMessage, 500) },
        ...(input ? [{ name: 'Input', value: truncateField(input, 500) }] : []),
        ...(stack ? [{ name: 'Stack Trace', value: truncateField(`\`\`\`${stack}\`\`\``, 1000) }] : []),
      ],
    });

    await channel.send({ embeds: [embed] });
  } catch (loggingError) {
    logger.warn(`[AI Telemetry] logCrash failed: ${loggingError.message}`);
  }
}

/**
 * #negative-feedback — fired when a member 👎-reacts to a Nexus AI reply. This is the only signal
 * this bot had for "the AI got something wrong" was scrolling raw chat logs looking for
 * complaints — a 👎 reaction is a direct, low-friction way for any member to flag a bad answer,
 * and posting the full question+answer pair here gives whoever maintains the corpus a ready-made
 * list of real gaps to go fix, instead of relying on someone remembering to report it.
 */
export async function logNegativeFeedback(client, guildId, { question, answer, reactedBy, messageUrl } = {}) {
  try {
    const channel = await resolveLogChannel(client, guildId, 'negativeFeedbackChannelId');
    if (!channel) return;

    const embed = createEmbed({
      title: '👎 AI Reply Flagged',
      color: 'warning',
      fields: [
        { name: 'Flagged by', value: reactedBy ? `<@${reactedBy}>` : 'n/a', inline: true },
        ...(messageUrl ? [{ name: 'Message', value: messageUrl, inline: true }] : []),
        { name: 'Question', value: truncateField(question, 500) },
        { name: 'Answer', value: truncateField(answer, 900) },
      ],
    });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn(`[AI Telemetry] logNegativeFeedback failed: ${error.message}`);
  }
}

/**
 * #jailbreak-stress-test — persona state triggers only: fired specifically when Meltdown/CAPS
 * mode activates or the swear floor override actually had to step in. Deliberately NOT a full
 * stream of every response (that's #bot-logs) — callers should only invoke this when the relevant
 * condition is actually true.
 */
export async function logPersonaTrigger(client, guildId, { type, promptSnippet } = {}) {
  try {
    const channel = await resolveLogChannel(client, guildId, 'jailbreakStressTestChannelId');
    if (!channel) return;

    const labels = {
      meltdown: '🔥 Meltdown / CAPS Mode Activated',
      swear_floor: '🧵 Swear Floor Override Fired',
    };

    const embed = createEmbed({
      title: labels[type] || `⚠️ Persona Trigger: ${type}`,
      color: 'warning',
      fields: [{ name: 'Prompt', value: truncateField(promptSnippet, 500) }],
    });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn(`[AI Telemetry] logPersonaTrigger failed: ${error.message}`);
  }
}
