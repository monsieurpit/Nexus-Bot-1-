// Renders the quest/season views. Shared by the slash commands and the buttons so both always
// show exactly the same thing.
import { logger } from '../../utils/logger.js';
import { createEmbed } from '../../utils/embeds.js';
import {
  getQuestOverview, claimQuestRewards, getSeasonLeaderboard, getSeasonStats, getQuestSettings, periodKeys,
} from './questService.js';
import {
  buildQuestBoardEmbed, questBoardButtons, countReady, buildClaimEmbed, buildSeasonEmbed, seasonButtons,
} from './questEmbeds.js';

export function questsDisabledEmbed() {
  return createEmbed({
    title: '📜 Quests aren\'t active',
    description: "Seasons & Quests aren't active on this server yet. An admin can start them with `/quests setup`.",
    color: 'gray',
  });
}

/** Payload for a member's quest board. Buttons only when the viewer is looking at their own. */
export async function renderQuestBoard(client, guild, member, viewer) {
  // Checked first: a server that hasn't set quests up gets no stored data at all.
  if (!(await getQuestSettings(guild.id)).enabled) return { embeds: [questsDisabledEmbed()], components: [] };
  const overview = await getQuestOverview(client, guild.id, member.id);
  const embed = buildQuestBoardEmbed({ member, guild, overview, viewer });
  const own = !viewer || viewer.id === member.id;
  return { embeds: [embed], components: own ? questBoardButtons(member.id, countReady(overview)) : [] };
}

export async function renderSeason(client, guild, member) {
  if (!(await getQuestSettings(guild.id)).enabled) return { embeds: [questsDisabledEmbed()], components: [] };
  const overview = await getQuestOverview(client, guild.id, member.id);
  const seasonId = overview.state.season.id;
  const [leaderboard, stats] = await Promise.all([getSeasonLeaderboard(guild.id, seasonId, 10), getSeasonStats(guild.id, seasonId)]);
  const embed = buildSeasonEmbed({ guild, member, state: overview.state, leaderboard, stats, settings: overview.settings, keys: periodKeys() });
  return { embeds: [embed], components: seasonButtons(member.id) };
}

/** Claims everything ready; returns { board, celebration } payloads (celebration null if nothing). */
export async function claimAndRender(client, guild, member) {
  const settings = await getQuestSettings(guild.id);
  if (!settings.enabled) return { board: { embeds: [questsDisabledEmbed()], components: [] }, celebration: null };
  const summary = await claimQuestRewards(client, guild.id, member.id);

  // Tier role rewards — best effort, and reported honestly if the bot can't give them.
  summary.rolesGiven = [];
  summary.rolesFailed = [];
  for (const roleId of summary.roles || []) {
    const role = guild.roles.cache.get(roleId);
    const ok = role && guild.members.me && role.position < guild.members.me.roles.highest.position
      ? await member.roles.add(role, `Season tier reward`).then(() => true).catch(() => false)
      : false;
    (ok ? summary.rolesGiven : summary.rolesFailed).push(roleId);
    if (!ok) logger.warn(`[Quests] Could not give tier role ${roleId} to ${member.id} in ${guild.id}`);
  }

  const board = await renderQuestBoard(client, guild, member, member);
  const celebration = summary.quests.length || summary.chests.length
    ? { embeds: [buildClaimEmbed({ member, summary, guild })] }
    : null;
  return { board, celebration };
}
