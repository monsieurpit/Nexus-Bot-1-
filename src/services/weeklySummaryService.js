import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../config/bot.js';
import { getGuildConfig, setGuildConfig } from './guildConfig.js';
import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';

const STATS_KEY = (guildId) => `guild:${guildId}:weekly_stats`;
const PREV_STATS_KEY = (guildId) => `guild:${guildId}:prev_weekly_stats`;
const SUMMARY_HISTORY_KEY = (guildId) => `guild:${guildId}:weekly_summary:history`;
const MAX_SAVED_SUMMARIES = 3;

/**
 * Gets default empty weekly stats object
 */
export function getDefaultWeeklyStats() {
  return {
    weekStart: Date.now(),
    joins: 0,
    leaves: 0,
    moderations: 0,
    channelsCreated: 0,
    channelsDeleted: 0,
    rolesCreated: 0,
    rolesDeleted: 0,
    ticketsOpened: 0,
    ticketsClosed: 0,
    messagesSent: 0
  };
}

/**
 * Retrieves the saved history of the last 3 weekly summaries for a guild
 */
export async function getWeeklySummariesHistory(client, guildId) {
  try {
    const raw = await client.db?.get(SUMMARY_HISTORY_KEY(guildId));
    if (Array.isArray(raw)) {
      return raw.slice(0, MAX_SAVED_SUMMARIES);
    }
    if (raw && Array.isArray(raw.history)) {
      return raw.history.slice(0, MAX_SAVED_SUMMARIES);
    }
    // Fallback: check single previous summary
    const singlePrev = await client.db?.get(PREV_STATS_KEY(guildId));
    if (singlePrev) {
      return [singlePrev];
    }
    return [];
  } catch (err) {
    logger.debug(`Error getting weekly summaries history for ${guildId}:`, err);
    return [];
  }
}

/**
 * Archives completed weekly stats into the 3-week rolling history
 */
export async function archiveWeeklySummary(client, guildId, archivedStats) {
  try {
    if (!client.db || !archivedStats) return;
    const history = await getWeeklySummariesHistory(client, guildId);
    
    // Prepend latest summary and maintain exactly the last 3 summaries
    const newHistory = [
      {
        ...archivedStats,
        archivedAt: Date.now()
      },
      ...history
    ].slice(0, MAX_SAVED_SUMMARIES);

    await client.db.set(SUMMARY_HISTORY_KEY(guildId), newHistory);
    await client.db.set(PREV_STATS_KEY(guildId), archivedStats);
  } catch (err) {
    logger.error(`Error archiving weekly summary for guild ${guildId}:`, err);
  }
}

/**
 * Calculates percentage trend (Incline/Decline) between current and previous values
 */
export function calcTrendPercentage(currentVal, prevVal) {
  const curr = typeof currentVal === 'number' ? currentVal : 0;
  const prev = typeof prevVal === 'number' ? prevVal : 0;

  if (prev === 0 && curr === 0) {
    return { pct: 0, text: '0% ➖ (Stable)', state: 'stable' };
  }
  if (prev === 0 && curr > 0) {
    return { pct: 100, text: '+100% 📈 (Incline)', state: 'incline' };
  }
  if (prev === 0 && curr < 0) {
    return { pct: -100, text: '-100% 📉 (Decline)', state: 'decline' };
  }

  const diff = curr - prev;
  const pct = Math.round((diff / Math.abs(prev)) * 100);

  if (pct > 0) {
    return { pct, text: `+${pct}% 📈 (Incline)`, state: 'incline' };
  } else if (pct < 0) {
    return { pct, text: `${pct}% 📉 (Decline)`, state: 'decline' };
  } else {
    return { pct: 0, text: '0% ➖ (Stable)', state: 'stable' };
  }
}

/**
 * Retrieves current and previous week stats for a guild, plus last 3 summaries history.
 * Automatically archives previous week when 7 days elapse.
 */
export async function getWeeklyStats(client, guildId) {
  try {
    const raw = await client.db?.get(STATS_KEY(guildId));
    let stats = raw || getDefaultWeeklyStats();

    const history = await getWeeklySummariesHistory(client, guildId);
    let prevStats = history.length > 0 ? history[0] : getDefaultWeeklyStats();

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    if (!stats.weekStart || (Date.now() - stats.weekStart >= SEVEN_DAYS_MS)) {
      await archiveWeeklySummary(client, guildId, stats);
      prevStats = { ...stats };
      stats = getDefaultWeeklyStats();
      if (client.db) {
        await client.db.set(STATS_KEY(guildId), stats);
      }
    }
    return { stats, prevStats, history };
  } catch (err) {
    logger.debug(`Error getting weekly stats for ${guildId}:`, err);
    return { stats: getDefaultWeeklyStats(), prevStats: getDefaultWeeklyStats(), history: [] };
  }
}

/**
 * Increments a weekly statistic metric
 */
// Stat increments are buffered in memory and written in one batch per guild every
// WEEKLY_STAT_FLUSH_MS. Writing on every single message (the `messagesSent` metric) was both racy —
// two messages at once read the same value and one increment was lost — and cost one database
// write per message (Firestore's free tier allows 20k writes a day).
const WEEKLY_STAT_FLUSH_MS = 30 * 1000;
const pendingWeeklyStats = new Map(); // guildId -> { client, metrics: Map<metric, amount> }
let weeklyStatFlushTimer = null;

export async function recordWeeklyStat(client, guildId, metric, amount = 1) {
  if (!client || !guildId || !metric) return;
  let pending = pendingWeeklyStats.get(guildId);
  if (!pending) {
    pending = { client, metrics: new Map() };
    pendingWeeklyStats.set(guildId, pending);
  }
  pending.metrics.set(metric, (pending.metrics.get(metric) || 0) + amount);

  if (!weeklyStatFlushTimer) {
    weeklyStatFlushTimer = setTimeout(() => {
      weeklyStatFlushTimer = null;
      flushWeeklyStats().catch(err => logger.debug('Weekly stat flush failed:', err));
    }, WEEKLY_STAT_FLUSH_MS);
    weeklyStatFlushTimer.unref?.();
  }
}

/** Writes every buffered stat increment (one read + one write per guild). */
export async function flushWeeklyStats() {
  const batch = [...pendingWeeklyStats.entries()];
  pendingWeeklyStats.clear();
  for (const [guildId, { client, metrics }] of batch) {
    try {
      // Same lock as the weekly reset in postWeeklySummary, so a flush can never write last
      // week's numbers back over a freshly reset week (or archive the same week twice).
      await Mutex.runExclusive(`weekly-stats:${guildId}`, async () => {
        const { stats } = await getWeeklyStats(client, guildId);
        let changed = false;
        for (const [metric, amount] of metrics) {
          if (typeof stats[metric] === 'number') {
            stats[metric] += amount;
            changed = true;
          }
        }
        if (changed && client.db) {
          await client.db.set(STATS_KEY(guildId), stats);
        }
      });
    } catch (err) {
      logger.debug(`Error flushing weekly stats for guild ${guildId}:`, err);
    }
  }
}

/**
 * Generates the Weekly Server Digest embed with Week-over-Week Incline/Decline trends
 */
export async function buildWeeklySummaryEmbed(client, guild, statsOverride = null) {
  let stats, prevStats;
  if (statsOverride) {
    stats = statsOverride.stats || statsOverride;
    prevStats = statsOverride.prevStats || getDefaultWeeklyStats();
  } else {
    const fetched = await getWeeklyStats(client, guild.id);
    stats = fetched.stats;
    prevStats = fetched.prevStats;
  }

  const joins = stats.joins || 0;
  const leaves = stats.leaves || 0;
  const netGrowth = joins - leaves;
  const netStr = netGrowth > 0 ? `+${netGrowth} 📈` : netGrowth < 0 ? `${netGrowth} 📉` : `0 ➖`;

  const prevJoins = prevStats.joins || 0;
  const prevLeaves = prevStats.leaves || 0;
  const prevNetGrowth = prevJoins - prevLeaves;

  const moderations = stats.moderations || 0;
  const channelsCreated = stats.channelsCreated || 0;
  const channelsDeleted = stats.channelsDeleted || 0;
  const rolesCreated = stats.rolesCreated || 0;
  const rolesDeleted = stats.rolesDeleted || 0;
  const ticketsOpened = stats.ticketsOpened || 0;
  const ticketsClosed = stats.ticketsClosed || 0;
  const messagesSent = stats.messagesSent || 0;

  const prevMessagesSent = prevStats.messagesSent || 0;

  // Calculate Week-over-Week Trends
  const msgTrend = calcTrendPercentage(messagesSent, prevMessagesSent);
  const joinTrend = calcTrendPercentage(joins, prevJoins);
  const netTrend = calcTrendPercentage(netGrowth, prevNetGrowth);

  // Overall Server Velocity Score (weighted metric combination)
  const currScore = (joins * 5) + (messagesSent * 1) + (ticketsClosed * 2);
  const prevScore = (prevJoins * 5) + (prevMessagesSent * 1) + (prevStats.ticketsClosed || 0) * 2;
  const overallTrend = calcTrendPercentage(currScore, prevScore);

  let momentumBadge = '📊 **Baseline Week** (Establishing performance baseline)';
  if (prevScore > 0 || currScore > 0) {
    if (overallTrend.state === 'incline') {
      momentumBadge = `🚀 **Incline (+${overallTrend.pct}% vs previous week)**`;
    } else if (overallTrend.state === 'decline') {
      momentumBadge = `📉 **Decline (${overallTrend.pct}% vs previous week)**`;
    } else {
      momentumBadge = `➖ **Stable (0% variance vs previous week)**`;
    }
  }

  const totalMembers = guild.memberCount || guild.members?.cache?.size || 0;
  const textChannelsCount = guild.channels?.cache?.filter(c => c.type === 0).size || 0;
  const voiceChannelsCount = guild.channels?.cache?.filter(c => c.type === 2).size || 0;
  const totalRolesCount = guild.roles?.cache?.size || 0;

  const weekStartDate = new Date(stats.weekStart || Date.now());
  const now = new Date();

  const embed = new EmbedBuilder()
    .setColor(overallTrend.state === 'incline' ? 0x22c55e : overallTrend.state === 'decline' ? 0xef4444 : (getColor('primary') || 0x3b82f6))
    .setTitle(`📊 Weekly Server Digest – ${guild.name}`)
    .setDescription(`Here is your server activity summary for the past week (<t:${Math.floor(weekStartDate.getTime() / 1000)}:d> to <t:${Math.floor(now.getTime() / 1000)}:d>)!`)
    .setThumbnail(guild.iconURL({ dynamic: true }) || null)
    .addFields(
      {
        name: '🔥 Overall Server Momentum Index',
        value: `• **Status:** ${momentumBadge}\n• **Activity Trend:** Messages ${msgTrend.text} | Inflow ${joinTrend.text}`,
        inline: false
      },
      {
        name: '👥 Member Growth & Flow',
        value: `• **Joins:** ${joins} *(${joinTrend.text})*\n• **Leaves:** ${leaves}\n• **Net Growth:** ${netStr} *(${netTrend.text})*\n• **Total Members:** ${totalMembers.toLocaleString()}`,
        inline: true
      },
      {
        name: '🛡️ Moderation Activity',
        value: `• **Total Actions:** ${moderations}\n• **Status:** ${moderations === 0 ? 'Quiet week ✅' : `${moderations} action(s) logged ⚠️`}`,
        inline: true
      },
      {
        name: '💬 Server Activity',
        value: `• **Messages Sent:** ${messagesSent > 0 ? messagesSent.toLocaleString() : 'Active'} *(${msgTrend.text})*\n• **Tickets Opened:** ${ticketsOpened}\n• **Tickets Closed:** ${ticketsClosed}`,
        inline: true
      },
      {
        name: '🏗️ Structural Changes',
        value: `• **Channels Created:** +${channelsCreated}\n• **Channels Deleted:** -${channelsDeleted}\n• **Roles Created:** +${rolesCreated}\n• **Roles Deleted:** -${rolesDeleted}`,
        inline: true
      },
      {
        name: '🏰 Current Server Stats',
        value: `• **Text Channels:** ${textChannelsCount}\n• **Voice Channels:** ${voiceChannelsCount}\n• **Total Roles:** ${totalRolesCount}`,
        inline: true
      }
    )
    .setFooter({
      text: `${guild.name} • Weekly Server Summary`,
      iconURL: guild.iconURL() || undefined
    })
    .setTimestamp();

  return embed;
}

/**
 * Posts the weekly summary to the configured channel and archives previous week
 */
export async function postWeeklySummary(client, guildId, targetChannel = null, isTest = false) {
  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;

    const config = await getGuildConfig(client, guildId);
    const summaryConfig = config?.weeklySummary || {};

    const channelId = targetChannel?.id || summaryConfig.channelId;
    if (!channelId) return null;

    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    const me = guild.members.me;
    if (me && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      logger.warn(`Missing permissions to post weekly summary in channel ${channelId} for guild ${guildId}`);
      return null;
    }

    // Include everything counted so far before building the summary.
    await flushWeeklyStats();
    const { stats, prevStats } = await getWeeklyStats(client, guild.id);
    const embed = await buildWeeklySummaryEmbed(client, guild, { stats, prevStats });

    const pingRole = summaryConfig.roleId ? `<@&${summaryConfig.roleId}>` : '';
    const content = isTest
      ? `⚙️ **[Manual Test] Weekly Server Summary Preview** ${pingRole}`
      : `📢 **Weekly Server Summary is here!** ${pingRole}`;

    const message = await channel.send({
      content,
      embeds: [embed],
      allowedMentions: summaryConfig.roleId ? { roles: [summaryConfig.roleId] } : { parse: [] }
    });

    if (!isTest) {
      if (client.db) {
        // Archive current stats to the 3-summary rolling history and start fresh week
        await Mutex.runExclusive(`weekly-stats:${guildId}`, async () => {
          await archiveWeeklySummary(client, guildId, stats);
          await client.db.set(STATS_KEY(guildId), getDefaultWeeklyStats());
        });
      }
    }

    logger.info(`Posted weekly server summary for guild ${guild.name} (${guildId}) in #${channel.name}`);
    return message;
  } catch (error) {
    logger.error(`Failed to post weekly summary for guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Hourly cron check for scheduled automated postings
 */
export async function checkWeeklySummaries(client) {
  if (!client || !client.isReady || !client.isReady()) return;

  const now = new Date();
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = daysOfWeek[now.getUTCDay()];
  const currentHour = now.getUTCHours();

  for (const guild of client.guilds.cache.values()) {
    try {
      const config = await getGuildConfig(client, guild.id);
      const summaryConfig = config?.weeklySummary;

      if (!summaryConfig?.enabled || !summaryConfig?.channelId) continue;

      const scheduledDay = summaryConfig.day || 'Sunday';
      const scheduledTime = summaryConfig.time || '18:00';
      const [schedHourStr] = scheduledTime.split(':');
      const schedHour = parseInt(schedHourStr, 10) || 18;

      if (currentDay.toLowerCase() === scheduledDay.toLowerCase() && currentHour === schedHour) {
        const lastPosted = summaryConfig.lastPostedAt || 0;
        const ONE_HOUR_MS = 55 * 60 * 1000;
        if (Date.now() - lastPosted < ONE_HOUR_MS) continue;

        await postWeeklySummary(client, guild.id);

        summaryConfig.lastPostedAt = Date.now();
        await setGuildConfig(client, guild.id, {
          weeklySummary: summaryConfig
        });
      }
    } catch (err) {
      logger.error(`Error in weekly summary scheduler check for guild ${guild.id}:`, err);
    }
  }
}
