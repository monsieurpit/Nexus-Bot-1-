import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';

const STANDINGS_API_URL = 'https://site.api.espn.com/apis/v2/sports/soccer/esp.1/standings';

const LALIGA_STANDINGS_DEFAULTS = {
  enabled: false,
  channelId: null,
  messageId: null
};

export async function getLaligaStandingsConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return { ...LALIGA_STANDINGS_DEFAULTS, ...(guildConfig.laligaStandings || {}) };
  } catch (error) {
    logger.error(`Error retrieving LaLiga standings config for guild ${guildId}:`, error);
    return { ...LALIGA_STANDINGS_DEFAULTS };
  }
}

export async function setLaligaStandingsConfig(client, guildId, patch) {
  const current = await getLaligaStandingsConfig(client, guildId);
  const updated = { ...current, ...patch };
  await setGuildConfig(client, guildId, { laligaStandings: updated });
  return updated;
}

/**
 * Fetches the current LaLiga table from ESPN's public soccer standings API
 * (the same free, keyless API footballService.js already uses for fixtures).
 */
export async function fetchLaLigaStandings() {
  const res = await fetch(STANDINGS_API_URL);
  if (!res.ok) {
    throw new Error(`ESPN standings API HTTP ${res.status}`);
  }

  const data = await res.json();
  const entries = data?.children?.[0]?.standings?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ESPN standings API returned no entries.');
  }

  const rows = entries.map(entry => {
    const stats = {};
    for (const stat of entry.stats || []) {
      stats[stat.name] = stat;
    }
    return {
      rank: stats.rank?.value ?? null,
      team: entry.team?.displayName || entry.team?.name || 'Unknown',
      note: entry.note?.description || null,
      played: stats.gamesPlayed?.displayValue ?? '0',
      wins: stats.wins?.displayValue ?? '0',
      draws: stats.ties?.displayValue ?? '0',
      losses: stats.losses?.displayValue ?? '0',
      goalsFor: stats.pointsFor?.displayValue ?? '0',
      goalsAgainst: stats.pointsAgainst?.displayValue ?? '0',
      goalDiff: stats.pointDifferential?.displayValue ?? '0',
      points: stats.points?.displayValue ?? '0'
    };
  });

  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return rows;
}

function buildStandingsEmbed(rows) {
  const header = '#  Team                 GP  W  D  L   GD  PTS';
  const lines = rows.map(r => {
    const rank = String(r.rank).padStart(2, ' ');
    const team = r.team.slice(0, 18).padEnd(18, ' ');
    const gp = String(r.played).padStart(2, ' ');
    const w = String(r.wins).padStart(2, ' ');
    const d = String(r.draws).padStart(2, ' ');
    const l = String(r.losses).padStart(2, ' ');
    const gd = String(r.goalDiff).padStart(4, ' ');
    const pts = String(r.points).padStart(3, ' ');
    return `${rank} ${team} ${gp} ${w} ${d} ${l} ${gd} ${pts}`;
  });

  const table = '```\n' + header + '\n' + lines.join('\n') + '\n```';
  const nowUtcStr = new Date().toISOString().slice(0, 16).replace('T', ' ');

  return new EmbedBuilder()
    .setColor(0xEE8707) // LaLiga orange
    .setTitle('🇪🇸 LaLiga Standings / Clasificación')
    .setDescription(table)
    .setFooter({ text: `🔄 Auto-Updates Hourly • Source: ESPN • Last Updated: ${nowUtcStr} UTC` })
    .setTimestamp();
}

/**
 * Posts or edits a guild's live-updating LaLiga standings board.
 */
export async function updateLaligaStandingsBoard(client, guildId, customChannel = null, forceNewMessage = false) {
  const config = await getLaligaStandingsConfig(client, guildId);

  const channelId = customChannel ? customChannel.id : config.channelId;
  if (!channelId) return null;

  let channel = customChannel;
  if (!channel) {
    channel = client.channels?.cache?.get(channelId) || await client.channels?.fetch?.(channelId).catch(() => null);
  }

  if (!channel || typeof channel.send !== 'function') {
    logger.warn(`[LaLiga Standings] Target channel ${channelId} not found or inaccessible in guild ${guildId}`);
    return null;
  }

  const rows = await fetchLaLigaStandings();
  const embed = buildStandingsEmbed(rows);

  let message = null;
  if (config.messageId && !forceNewMessage) {
    message = await channel.messages.fetch(config.messageId).catch(() => null);
  }

  if (message) {
    await message.edit({ embeds: [embed] });
    logger.info(`[LaLiga Standings] Edited existing board (${message.id}) in guild "${channel.guild?.name || guildId}" (#${channel.name || channel.id})`);
  } else {
    message = await channel.send({ embeds: [embed] });
    logger.info(`[LaLiga Standings] Posted new board (${message.id}) in guild "${channel.guild?.name || guildId}" (#${channel.name || channel.id})`);
  }

  await setLaligaStandingsConfig(client, guildId, {
    channelId: channel.id,
    messageId: message.id,
    enabled: true
  });

  return message;
}

/**
 * Cron-driven check (run hourly) that refreshes every guild's LaLiga standings board.
 */
export async function checkLaligaStandingsUpdates(client) {
  if (!client?.isReady?.()) return;

  const guilds = client.guilds?.cache ? Array.from(client.guilds.cache.values()) : [];
  if (guilds.length === 0) return;

  logger.info(`[LaLiga Standings] Running hourly standings refresh across ${guilds.length} server(s)...`);

  for (const guild of guilds) {
    try {
      const config = await getLaligaStandingsConfig(client, guild.id);
      if (!config.enabled || !config.channelId) continue;

      await updateLaligaStandingsBoard(client, guild.id).catch(err => {
        logger.error(`[LaLiga Standings] Failed to update board for guild ${guild.id}: ${err.message}`);
      });
    } catch (err) {
      logger.error(`[LaLiga Standings] Error checking guild ${guild.id}: ${err.message}`);
    }
  }
}
