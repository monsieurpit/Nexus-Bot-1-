import { getGuildConfig, setGuildConfig } from './guildConfig.js';
import { startPlaylistPlayback, stopPlaylistPlayback, isPlaybackActive, getPlaybackStatus } from './vcMusicPlayer.js';
import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_VC_EVENT_PLAYLIST = 'https://open.spotify.com/playlist/4VX8HbQ88fqnejFJbCROxV';

const VC_EVENT_DEFAULTS = {
  enabled: false,
  dayOfWeek: null,      // 0 = Sunday .. 6 = Saturday
  hour: null,            // 0-23, fixed UTC-4
  minute: 0,
  announceChannelId: null,
  voiceChannelId: null,
  pingRoleId: null,
  playlistUrl: DEFAULT_VC_EVENT_PLAYLIST,
  loopCount: 3,
  lastTriggeredKey: null
};

const VC_EVENT_CATCH_UP_MINUTES = 10;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function getVcEventConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return { ...VC_EVENT_DEFAULTS, ...(guildConfig.vcEvent || {}) };
  } catch (error) {
    logger.error(`Error retrieving VC event config for guild ${guildId}:`, error);
    return { ...VC_EVENT_DEFAULTS };
  }
}

export async function setVcEventConfig(client, guildId, patch) {
  const current = await getVcEventConfig(client, guildId);
  const updated = { ...current, ...patch };

  // setGuildConfig persists the full blob and also mirrors `vcEvent` live into the
  // dedicated vc_event_configs Firestore table (see firestoreDatabase.js's set()).
  await setGuildConfig(client, guildId, { vcEvent: updated });

  return updated;
}

/**
 * Returns the current day-of-week/hour/minute as seen in the fixed UTC-4 offset
 * requested for VC events (not a DST-aware timezone, a literal -4h shift).
 */
function getUtcMinus4Parts(date = new Date()) {
  const shifted = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  return {
    dayOfWeek: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dateKey: shifted.toISOString().slice(0, 10)
  };
}

export async function runVcEventNow(client, guild, config) {
  const announceChannel = guild.channels.cache.get(config.announceChannelId);
  const voiceChannel = guild.channels.cache.get(config.voiceChannelId);

  if (announceChannel?.isTextBased()) {
    const pingContent = config.pingRoleId ? `<@&${config.pingRoleId}>` : undefined;
    const embed = createEmbed({
      title: '🎧 VC Listening Event',
      description: `It's time! Join **${voiceChannel?.name || 'the voice channel'}** — the playlist is starting now.`,
      color: 'info'
    });
    await announceChannel.send({
      content: pingContent,
      embeds: [embed],
      allowedMentions: { roles: config.pingRoleId ? [config.pingRoleId] : [] }
    }).catch(err => logger.warn(`[VC Event] Failed to send announcement in guild ${guild.id}: ${err.message}`));
  }

  if (!voiceChannel || !voiceChannel.isVoiceBased?.()) {
    logger.warn(`[VC Event] Voice channel ${config.voiceChannelId} not found or not joinable in guild ${guild.id}`);
    return;
  }

  await startPlaylistPlayback({
    guild,
    voiceChannel,
    playlistUrl: config.playlistUrl || DEFAULT_VC_EVENT_PLAYLIST,
    loopCount: config.loopCount || 3
  });
}

/**
 * Cron-driven check (run every minute) that fires each guild's configured VC event
 * at most once per calendar day, at its configured day/hour/minute in fixed UTC-4.
 */
export async function checkVcEvents(client) {
  if (!client?.isReady?.()) return;

  const guilds = client.guilds?.cache ? Array.from(client.guilds.cache.values()) : [];
  if (guilds.length === 0) return;

  const { dayOfWeek, hour, minute, dateKey } = getUtcMinus4Parts();

  for (const guild of guilds) {
    try {
      const config = await getVcEventConfig(client, guild.id);
      if (!config.enabled) continue;
      if (config.dayOfWeek === null || config.hour === null) continue;
      // A catch-up window instead of an exact-minute match: a restart/redeploy (or a delayed cron
      // tick) during the scheduled minute used to skip that whole week's event.
      const minutesNow = hour * 60 + minute;
      const minutesScheduled = config.hour * 60 + (config.minute || 0);
      const minutesLate = minutesNow - minutesScheduled;
      if (config.dayOfWeek !== dayOfWeek || minutesLate < 0 || minutesLate > VC_EVENT_CATCH_UP_MINUTES) continue;
      if (config.lastTriggeredKey === dateKey) continue;
      if (!config.announceChannelId || !config.voiceChannelId) continue;

      // Mark as triggered immediately so overlapping cron ticks never double-fire.
      await setVcEventConfig(client, guild.id, { lastTriggeredKey: dateKey });

      logger.info(`[VC Event] Triggering scheduled event for guild ${guild.id} (${guild.name})`);
      runVcEventNow(client, guild, config).catch(err => {
        logger.error(`[VC Event] Failed to run event for guild ${guild.id}: ${err.message}`);
      });
    } catch (err) {
      logger.error(`[VC Event] Error checking guild ${guild.id}: ${err.message}`);
    }
  }
}

export { isPlaybackActive, stopPlaylistPlayback, getPlaybackStatus };
