// Posts quest completions and season results in each server's quest channel (if one is set).
import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getQuestSettings, updateQuestSettings, finalizeSeasonIfNeeded, getFeatures, seasonInfo, periodKeys, getBoard, getSeasonLeaderboard } from './questService.js';
import { buildCompletionAnnouncement, buildSeasonRecapEmbed, buildDailyPostEmbed, dailyPostButtons } from './questEmbeds.js';

async function questChannel(client, guildId, settings) {
  if (!settings.channelId) return null;
  const guild = client.guilds?.cache?.get(guildId);
  const channel = guild?.channels?.cache?.get(settings.channelId);
  const me = guild?.members?.me;
  if (!channel?.isTextBased?.()) return null;
  if (me && !channel.permissionsFor(me)?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel;
}

/** One message per server per batch — never one message per quest. Never pings anyone. */
export async function announceQuestCompletions(client, completions = []) {
  const byGuild = new Map();
  for (const c of completions) {
    if (!byGuild.has(c.guildId)) byGuild.set(c.guildId, []);
    byGuild.get(c.guildId).push(c);
  }
  for (const [guildId, list] of byGuild) {
    try {
      const settings = await getQuestSettings(guildId);
      if (!settings.enabled || !settings.announceCompletions) continue;
      const channel = await questChannel(client, guildId, settings);
      if (!channel) continue;
      const features = await getFeatures(client, guildId);
      const multiplier = Number(settings.multiplier) > 0 ? Number(settings.multiplier) : 1;
      await channel.send({
        embeds: [buildCompletionAnnouncement(list, { economy: features.economy, multiplier })],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.warn(`[Quests] Completion announcement failed in ${guildId}: ${error.message}`);
    }
  }
}

/** Hourly: closes finished seasons (pays the podium) and posts the recap. */
export async function runSeasonRollover(client) {
  for (const guild of client.guilds?.cache?.values?.() || []) {
    try {
      const settings = await getQuestSettings(guild.id);
      if (!settings.enabled) continue;
      const result = await finalizeSeasonIfNeeded(guild.id);
      if (!result) continue;
      logger.info(`[Quests] Season ${result.season.id} closed in ${guild.id}: ${result.players} players, ${result.podium.length} podium`);
      const channel = await questChannel(client, guild.id, settings);
      if (!channel) continue;
      const next = seasonInfo(guild.id, periodKeys().season);
      await channel.send({ embeds: [buildSeasonRecapEmbed(result, next)], allowedMentions: { parse: [] } });
    } catch (error) {
      logger.warn(`[Quests] Season rollover failed in ${guild.id}: ${error.message}`);
    }
  }
}

/**
 * Posts today's quest board in the quest channel. Returns true when posted. Without `force` it
 * posts at most once per day (the day is remembered, so restarts don't post twice).
 */
export async function postDailyBoard(client, guild, { force = false } = {}) {
  const settings = await getQuestSettings(guild.id);
  if (!settings.enabled) return false;
  const keys = periodKeys();
  if (!force && settings.lastDailyPost === keys.day) return false;
  const channel = await questChannel(client, guild.id, settings);
  if (!channel) return false;
  const [daily, weekly, features, leaders] = await Promise.all([
    getBoard(client, guild.id, 'daily'), getBoard(client, guild.id, 'weekly'),
    getFeatures(client, guild.id), getSeasonLeaderboard(guild.id, keys.season, 3),
  ]);
  // Remember the day BEFORE sending: a failed save then means no post, never two posts.
  await updateQuestSettings(guild.id, { lastDailyPost: keys.day });
  await channel.send({
    embeds: [buildDailyPostEmbed({ guild, boards: { daily, weekly }, keys, settings, features, leaders })],
    components: dailyPostButtons(),
    allowedMentions: { parse: [] },
  });
  return true;
}

/** Hourly: posts the new day's board in every server that hasn't had it yet. */
export async function runDailyPosts(client) {
  for (const guild of client.guilds?.cache?.values?.() || []) {
    await postDailyBoard(client, guild).catch((error) =>
      logger.warn(`[Quests] Daily post failed in ${guild.id}: ${error.message}`));
  }
}
