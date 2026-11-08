// Every embed and button row of the Seasons & Quests feature.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed, dashboardEmbed, channelOr, onOff, NOT_SET } from '../../utils/embeds.js';
import {
  DIFFICULTY, STARS_PER_TIER, MAX_TIER, MILESTONES, tierReward, badgeForTier, PODIUM,
} from './catalog.js';
import { progressFor, isComplete, claimable, seasonInfo } from './questService.js';

const n = (v) => Number(v || 0).toLocaleString('en-US');
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const MEDALS = ['🥇', '🥈', '🥉'];

export function bar(value, max, size = 10) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function rewardText(q, { economy, multiplier }) {
  const coins = economy ? `**+${n(Math.round(q.coins * multiplier))}** 🪙 · ` : '';
  return `${coins}**${q.stars}** ⭐${q.lucky ? ' · 🍀 lucky' : ''}`;
}

function questLines(board, periodState, ctx) {
  return board.quests.map((q) => {
    const done = isComplete(periodState, q);
    const claimed = periodState?.claimed?.includes(q.id);
    const value = done ? q.target : Math.min(progressFor(periodState, q), q.target);
    const tag = board.kind === 'weekly' ? `${DIFFICULTY[q.difficulty].emoji} ` : '';
    const icon = claimed ? '☑️' : done ? '🎁' : q.emoji;
    const title = claimed ? `~~${q.title}~~` : `**${q.title}**`;
    const status = claimed
      ? 'claimed'
      : done
        ? `**ready to claim** · ${rewardText(q, ctx)}`
        : `${bar(value, q.target)} \`${n(value)}/${n(q.target)}\` · ${rewardText(q, ctx)}`;
    return `${icon} ${tag}${title} — ${q.description}\n╰ ${status}`;
  });
}

function chestLine(board, periodState, ctx) {
  const done = board.quests.filter((q) => isComplete(periodState, q)).length;
  const total = board.quests.length;
  const coins = ctx.economy ? `+${n(Math.round(board.chest.coins * ctx.multiplier))} 🪙 · ` : '';
  if (periodState?.chestClaimed) return `${board.chest.emoji} ~~${board.chest.name}~~ — claimed`;
  if (done === total && total > 0) return `${board.chest.emoji} **${board.chest.name} unlocked!** ${coins}**${board.chest.stars}** ⭐`;
  return `${board.chest.emoji} ${board.chest.name}: finish all ${total} → ${coins}**${board.chest.stars}** ⭐ \`${done}/${total}\``;
}

export function countReady(overview) {
  const { boards, state } = overview;
  const d = claimable(state.daily, boards.daily);
  const w = claimable(state.weekly, boards.weekly);
  return d.quests.length + w.quests.length + (d.chest ? 1 : 0) + (w.chest ? 1 : 0);
}

/** The /quests board. */
export function buildQuestBoardEmbed({ member, guild, overview, viewer = null }) {
  const { keys, boards, state, settings, features, notice } = overview;
  const ctx = { economy: features.economy, multiplier: Number(settings.multiplier) > 0 ? Number(settings.multiplier) : 1 };
  const theme = boards.weekly.theme;
  const ready = countReady(overview);
  const season = seasonInfo(guild.id, state.season.id);
  const tier = state.season.tier;
  const badge = badgeForTier(tier);
  const isSelf = !viewer || viewer.id === member.id;

  const lines = [`${theme.blurb}`];
  if (notice && isSelf) {
    lines.push(`\n🕰️ While you were away, I collected **${notice.quests}** finished reward${notice.quests === 1 ? '' : 's'} for you` +
      `${ctx.economy && notice.coins ? `: **+${n(notice.coins)}** 🪙` : ''} · **+${notice.stars}** ⭐`);
  }
  if (ready > 0 && isSelf) lines.push(`\n🎁 **${ready} reward${ready === 1 ? '' : 's'} ready** — press **Claim** below!`);

  return createEmbed({
    author: { name: `${member.displayName ?? member.user?.username ?? 'Member'}'s quests`, iconURL: member.displayAvatarURL?.({ size: 64 }) },
    title: `${theme.emoji} ${theme.name}`,
    description: lines.join('\n'),
    color: ready > 0 ? 'economy' : 'primary',
    thumbnail: member.displayAvatarURL?.({ size: 128 }),
    fields: [
      { name: `☀️ Daily quests · new ${ts(keys.dayEndsAt)}`, value: [...questLines(boards.daily, state.daily, ctx), chestLine(boards.daily, state.daily, ctx)].join('\n'), inline: false },
      { name: `📜 Weekly quests · new ${ts(keys.weekEndsAt)}`, value: [...questLines(boards.weekly, state.weekly, ctx), chestLine(boards.weekly, state.weekly, ctx)].join('\n'), inline: false },
    ],
    footer: `${season.emoji} Season ${season.number}: ${season.name} · ${badge ? `${badge.badge} ` : ''}Tier ${tier} · ${n(state.season.stars)} ⭐`,
  });
}

export function questBoardButtons(userId, ready) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`quests:claim:${userId}`).setLabel(ready > 0 ? `Claim ${ready}` : 'Nothing to claim').setEmoji('🎁')
      .setStyle(ready > 0 ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(ready === 0),
    new ButtonBuilder().setCustomId(`quests:season:${userId}`).setLabel('Season').setEmoji('🏆').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`quests:refresh:${userId}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  )];
}

/** Shown after pressing Claim. */
export function buildClaimEmbed({ member, summary, guild }) {
  const mult = 1; // coins in summary are already multiplied
  const lines = summary.quests.map((q) =>
    `${q.kind === 'daily' ? '☀️' : DIFFICULTY[q.difficulty].emoji} **${q.title}**${summary.economy ? ` · +${n(Math.round(q.coins * (summary.multiplier || mult)))} 🪙` : ''} · ${q.stars} ⭐`);
  for (const c of summary.chests) {
    lines.push(`${c.emoji} **${c.name}**${summary.economy ? ` · +${n(Math.round(c.coins * (summary.multiplier || mult)))} 🪙` : ''} · ${c.stars} ⭐`);
  }
  const fields = [];
  if (summary.tiersReached.length) {
    const tierLines = summary.tiersReached.map((t) => {
      const m = MILESTONES[t];
      return `🎖️ **Tier ${t}**${summary.economy ? ` · +${n(Math.round(tierReward(t) * (summary.multiplier || mult)))} 🪙` : ''}${m ? ` · ${m.badge} **${m.name}** badge!` : ''}`;
    });
    if (summary.rolesGiven?.length) tierLines.push(`🎭 New role${summary.rolesGiven.length === 1 ? '' : 's'}: ${summary.rolesGiven.map((r) => `<@&${r}>`).join(' ')}`);
    if (summary.rolesFailed?.length) tierLines.push(`⚠️ I couldn't give ${summary.rolesFailed.map((r) => `<@&${r}>`).join(' ')} — ask staff to check my role position.`);
    fields.push({ name: '🆙 Season tier up!', value: tierLines.join('\n'), inline: false });
  }
  const season = seasonInfo(guild.id, summary.state.season.id);
  const stars = summary.state.season.stars;
  const tier = summary.state.season.tier;
  const inTier = tier >= MAX_TIER ? STARS_PER_TIER : stars - tier * STARS_PER_TIER;
  fields.push(
    ...(summary.economy ? [{ name: '🪙 Coins', value: `**+${n(summary.coins)}**`, inline: true }] : []),
    { name: '⭐ Stars', value: `**+${summary.stars}** (total ${n(stars)})`, inline: true },
    { name: `${season.emoji} Season tier`, value: tier >= MAX_TIER ? `**${tier}** — max tier! 💠` : `**${tier}** → ${tier + 1}\n${bar(inTier, STARS_PER_TIER, 12)} \`${inTier}/${STARS_PER_TIER}\``, inline: true },
  );
  return createEmbed({
    author: { name: `${member.displayName ?? member.user?.username}`, iconURL: member.displayAvatarURL?.({ size: 64 }) },
    title: summary.tiersReached.length ? '🎉 Rewards claimed — tier up!' : '🎁 Rewards claimed!',
    description: lines.join('\n'),
    color: 'economy',
    fields,
  });
}

/** /quests season overview. */
export function buildSeasonEmbed({ guild, member, state, leaderboard, stats, settings, keys }) {
  const season = seasonInfo(guild.id, state.season.id);
  const stars = state.season.stars;
  const tier = state.season.tier;
  const badge = badgeForTier(tier);
  const inTier = tier >= MAX_TIER ? STARS_PER_TIER : stars - tier * STARS_PER_TIER;
  const myRank = leaderboard.findIndex((r) => r.userId === member.id);

  const upcoming = [];
  for (let t = tier + 1; t <= Math.min(MAX_TIER, tier + 4); t++) {
    const m = MILESTONES[t];
    const role = settings.tierRoles?.[t];
    upcoming.push(`\`T${String(t).padStart(2, '0')}\` ${m ? m.badge : '▫️'} +${n(tierReward(t) * (Number(settings.multiplier) || 1))} 🪙${role ? ` · <@&${role}>` : ''}${m ? ` · **${m.name}**` : ''}`);
  }

  const board = leaderboard.length
    ? leaderboard.map((r, i) => `${MEDALS[i] || `\`#${i + 1}\``} <@${r.userId}> · Tier **${r.tier}** · ${n(r.stars)} ⭐`).join('\n')
    : '*Nobody has earned stars yet — be the first with `/quests progress`!*';

  return createEmbed({
    author: { name: `${guild.name} · Season ${season.number}`, iconURL: guild.iconURL?.({ size: 64 }) || undefined },
    title: `${season.emoji} ${season.name}`,
    description:
      `Complete quests to earn ⭐ and climb **${MAX_TIER} tiers**. Ends ${ts(season.endsAt)} (${ts(season.endsAt, 'D')}).\n` +
      `The top 3 win **${PODIUM.map((p) => n(p * (Number(settings.multiplier) || 1))).join(' / ')}** 🪙 when the season ends.`,
    color: 'primary',
    thumbnail: member.displayAvatarURL?.({ size: 128 }),
    fields: [
      {
        name: `${badge ? badge.badge : '🎖️'} Your progress`,
        value: tier >= MAX_TIER
          ? `**Tier ${tier}** — max tier reached with **${n(stars)}** ⭐! 💠`
          : `**Tier ${tier}** · ${n(stars)} ⭐\n${bar(inTier, STARS_PER_TIER, 14)} \`${inTier}/${STARS_PER_TIER}\` to tier ${tier + 1}` +
            (myRank >= 0 ? `\nYou're **#${myRank + 1}** this season` : ''),
        inline: false,
      },
      ...(upcoming.length ? [{ name: '🎁 Next rewards', value: upcoming.join('\n'), inline: false }] : []),
      { name: '🏆 Leaderboard', value: board, inline: false },
      { name: '📊 This season', value: `**${n(stats.players)}** players · **${n(stats.quests)}** quests completed`, inline: false },
    ],
    footer: `Daily quests renew ${new Date(keys.dayEndsAt).toUTCString().slice(17, 22)} UTC · weekly on Mondays`,
  });
}

export function seasonButtons(userId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`quests:board:${userId}`).setLabel('My quests').setEmoji('📜').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`quests:season:${userId}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  )];
}

/** Posted in the quest channel when members finish quests (one message per batch). */
export function buildCompletionAnnouncement(completions, { economy, multiplier }) {
  const shown = completions.slice(0, 12);
  const lines = shown.map(({ userId, quest, kind }) =>
    `${quest.emoji} <@${userId}> finished **${quest.title}** ${kind === 'daily' ? '☀️' : DIFFICULTY[quest.difficulty].emoji}` +
    ` · ${economy ? `${n(Math.round(quest.coins * multiplier))} 🪙 · ` : ''}${quest.stars} ⭐`);
  if (completions.length > shown.length) lines.push(`*…and ${completions.length - shown.length} more!*`);
  return createEmbed({
    title: completions.length === 1 ? '🏆 Quest complete!' : `🏆 ${completions.length} quests completed!`,
    description: `${lines.join('\n')}\n\nClaim rewards with \`/quests progress\` · see the race with \`/quests season\``,
    color: 'success',
  });
}

/** Posted when a season ends. */
export function buildSeasonRecapEmbed(result, nextSeason) {
  const podium = result.podium.length
    ? result.podium.map((p, i) => `${MEDALS[i]} <@${p.userId}> · ${n(p.stars)} ⭐${p.prize ? ` · **+${n(p.prize)}** 🪙` : ''}`).join('\n')
    : '*Nobody played this season.*';
  return createEmbed({
    title: `${result.season.emoji} Season ${result.season.number}: ${result.season.name} is over!`,
    description: `${podium}\n\n**${n(result.players)}** players completed **${n(result.quests)}** quests. GG everyone!`,
    color: 'economy',
    fields: [{ name: `${nextSeason.emoji} Next up: Season ${nextSeason.number} — ${nextSeason.name}`, value: 'Tiers reset and new quests are live. Start climbing with `/quests progress`!', inline: false }],
  });
}

/** /quests admin dashboard. */
export function buildQuestSettingsEmbed(guild, settings) {
  const roles = Object.entries(settings.tierRoles || {}).sort(([a], [b]) => Number(a) - Number(b));
  return dashboardEmbed({
    guild,
    feature: 'Seasons & Quests',
    icon: '📜',
    color: 'primary',
    enabled: Boolean(settings.enabled),
    summary: settings.enabled ? 'Daily and weekly quests that change every period, a monthly season with 20 tiers, and a leaderboard.' : 'Not active yet — run `/quests setup channel:#…` to start.',
    fields: [
      { name: '📣 Quest channel', value: `${channelOr(settings.channelId)}\nDaily board: ${settings.channelId ? '🟢 posted every day' : NOT_SET}\nCompletions: ${onOff(settings.announceCompletions)}`, inline: true },
      { name: '💰 Reward multiplier', value: `**×${Number(settings.multiplier || 1)}**`, inline: true },
      { name: '🎭 Tier roles', value: roles.length ? roles.map(([t, r]) => `Tier **${t}** → <@&${r}>`).join('\n') : NOT_SET, inline: true },
      {
        name: '🛠️ Commands',
        value: '`/quests setup` · `/quests admin disable` · `/quests admin channel`\n`/quests admin announcements` · `/quests admin multiplier` · `/quests admin tier-role`',
        inline: false,
      },
    ],
    hint: 'Members use /quests progress and /quests season',
  });
}

/** The daily post in the quest channel: today's daily quests, this week's board and the season race. */
export function buildDailyPostEmbed({ guild, boards, keys, settings, features, leaders }) {
  const ctx = { economy: features.economy, multiplier: Number(settings.multiplier) > 0 ? Number(settings.multiplier) : 1 };
  const theme = boards.weekly.theme;
  const season = seasonInfo(guild.id, keys.season);
  const date = new Date(keys.dayEndsAt - 86400000);
  const isMonday = date.getUTCDay() === 1;
  const reward = (q) => `${ctx.economy ? `+${n(Math.round(q.coins * ctx.multiplier))} 🪙 · ` : ''}${q.stars} ⭐${q.lucky ? ' · 🍀' : ''}`;
  const chest = (b) => `${b.chest.emoji} *${b.chest.name}: finish all → ${ctx.economy ? `+${n(Math.round(b.chest.coins * ctx.multiplier))} 🪙 · ` : ''}${b.chest.stars} ⭐*`;
  const daily = boards.daily.quests.map((q) => `${q.emoji} **${q.title}** — ${q.description}\n╰ ${reward(q)}`);
  const weekly = boards.weekly.quests.map((q) => `${DIFFICULTY[q.difficulty].emoji} **${q.title}** — ${q.description} · ${reward(q)}`);
  const race = leaders.length
    ? leaders.slice(0, 3).map((r, i) => `${MEDALS[i]} <@${r.userId}> · Tier ${r.tier} · ${n(r.stars)} ⭐`).join('\n')
    : '*Nobody on the board yet — today could be your day!*';

  return createEmbed({
    author: { name: `${guild.name} · Daily quests`, iconURL: guild.iconURL?.({ size: 64 }) || undefined },
    title: `📜 Today's quests — ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`,
    description:
      `${isMonday ? '🆕 **A new week begins!** Fresh weekly quests and a new theme.\n' : ''}` +
      `${theme.emoji} **${theme.name}** — ${theme.blurb}\n` +
      `Daily quests renew ${ts(keys.dayEndsAt)} · weekly quests ${ts(keys.weekEndsAt)}`,
    color: 'primary',
    thumbnail: guild.iconURL?.({ size: 256 }) || null,
    fields: [
      { name: '☀️ Today', value: [...daily, chest(boards.daily)].join('\n'), inline: false },
      { name: '📜 This week', value: [...weekly, chest(boards.weekly)].join('\n'), inline: false },
      { name: `${season.emoji} Season ${season.number}: ${season.name} · ends ${ts(season.endsAt)}`, value: race, inline: false },
    ],
    footer: 'Press "My progress" to see how far you are',
  });
}

export function dailyPostButtons() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('quests:mine').setLabel('My progress').setEmoji('📜').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('quests:leaderboard').setLabel('Season leaderboard').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
  )];
}
