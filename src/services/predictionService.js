import { db } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { getFootballConfig, setFootballConfig, getAllMatches } from './footballService.js';

/**
 * Prediction Service
 * ===================
 * Captures free-text score predictions ("Barça 2-1 Real Madrid") posted in the
 * configured prediction channel (see footballService.sendPredictionRequest),
 * scores them once a staff member records the real final score, and keeps a
 * persistent per-guild leaderboard.
 *
 * Scoring: 3 points for an exact scoreline, 1 point for the correct outcome
 * (home win / draw / away win) with a wrong scoreline, 0 otherwise.
 */

// ─── Per-guild async mutex — same pattern as economy.js, avoids lost updates
// when several predictions land in the same channel within milliseconds. ───
const _locks = new Map();
async function withLock(key, fn) {
  const prev = _locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  _locks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (_locks.get(key) === next) _locks.delete(key);
  }
}

const predictionsKey = (guildId, matchId) => `predictions:${guildId}:match:${matchId}`;
const leaderboardKey = (guildId) => `predictions:${guildId}:leaderboard`;

// Matches "2-1", "2 - 1", "2:1", "2 vs 1", optionally with team names/words around the
// numbers — deliberately permissive since the channel is dedicated to predictions, but
// still requires two small integers (a realistic football scoreline) joined by a
// dash/colon/"vs", not just any two numbers anywhere in the message.
const SCORE_RE = /\b([0-9]|1[0-9])\s*(?:-|:|vs\.?|to)\s*([0-9]|1[0-9])\b/i;

export function parsePredictionScore(content) {
  if (!content) return null;
  const match = SCORE_RE.exec(content);
  if (!match) return null;
  const a = parseInt(match[1], 10);
  const b = parseInt(match[2], 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return { a, b };
}

/**
 * Handles one message posted in the guild's configured prediction channel.
 * No-ops immediately (cheap checks first) if predictions aren't set up, this
 * isn't the right channel, there's no active match to predict for, or the
 * message doesn't parse as a scoreline. Reacts to confirm capture / explain
 * why a message was ignored.
 */
export async function capturePrediction(message, client) {
  if (!message.guild || message.author?.bot) return;

  const config = await getFootballConfig(client, message.guild.id);
  if (!config.predictionsEnabled || !config.predictionChannelId) return;
  if (message.channel.id !== config.predictionChannelId) return;
  if (!config.activePredictionMatchId) return;

  const matches = getAllMatches(config.customMatches);
  const match = matches.find((m) => m.id === config.activePredictionMatchId);
  if (!match) return;

  const kickoffMs = match.kickoffUtc ? new Date(match.kickoffUtc).getTime() : null;
  if (kickoffMs && Date.now() >= kickoffMs) {
    // Predictions closed at kick-off — a late guess isn't a real prediction.
    await message.react('⏰').catch(() => null);
    return;
  }

  const score = parsePredictionScore(message.content);
  if (!score) return;

  // homeScore/awayScore assume the first number in the message is the home side's —
  // matches formatMatchAnnouncement's own "FC BARCELONA vs OPPONENT" title ordering when
  // Barça is home, and is close enough for an away fixture too (Discord score predictions
  // are almost always typed in fixture order, "Opponent X-Y Barça").
  const isHome = match.homeOrAway === 'home';
  const homeScore = isHome ? score.a : score.b;
  const awayScore = isHome ? score.b : score.a;

  await withLock(predictionsKey(message.guild.id, match.id), async () => {
    const stored = (await db.get(predictionsKey(message.guild.id, match.id))) || { entries: {} };
    const isEdit = Boolean(stored.entries[message.author.id]);
    stored.entries[message.author.id] = {
      userId: message.author.id,
      username: message.author.username,
      homeScore,
      awayScore,
      messageId: message.id,
      updatedAt: Date.now(),
    };
    await db.set(predictionsKey(message.guild.id, match.id), stored);
    await message.react(isEdit ? '🔁' : '✅').catch(() => null);
  }).catch((err) => {
    logger.error(`Error capturing prediction for guild ${message.guild.id}:`, err);
  });
}

export async function getPredictionsForMatch(guildId, matchId) {
  const stored = (await db.get(predictionsKey(guildId, matchId))) || { entries: {} };
  return Object.values(stored.entries || {});
}

export async function clearPredictionsForMatch(guildId, matchId) {
  await db.delete(predictionsKey(guildId, matchId)).catch(() => null);
}

function outcomeOf(homeScore, awayScore) {
  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';
  return 'draw';
}

/**
 * Records the real final score for a match, scores every stored prediction
 * against it, and merges the results into the guild's persistent leaderboard.
 * Returns the per-user results (for the announcement embed) and clears the
 * match's raw prediction store afterward.
 */
export async function resolvePredictions(client, guildId, matchId, finalHomeScore, finalAwayScore) {
  const predictions = await getPredictionsForMatch(guildId, matchId);
  const actualOutcome = outcomeOf(finalHomeScore, finalAwayScore);

  const results = predictions.map((p) => {
    const exact = p.homeScore === finalHomeScore && p.awayScore === finalAwayScore;
    const correctOutcome = !exact && outcomeOf(p.homeScore, p.awayScore) === actualOutcome;
    const points = exact ? 3 : correctOutcome ? 1 : 0;
    return { ...p, exact, correctOutcome, points };
  });

  await withLock(leaderboardKey(guildId), async () => {
    const board = (await db.get(leaderboardKey(guildId))) || { users: {} };
    for (const r of results) {
      const entry = board.users[r.userId] || {
        userId: r.userId,
        username: r.username,
        points: 0,
        exactCount: 0,
        correctCount: 0,
        predictionCount: 0,
      };
      entry.username = r.username || entry.username;
      entry.points += r.points;
      entry.predictionCount += 1;
      if (r.exact) entry.exactCount += 1;
      else if (r.correctOutcome) entry.correctCount += 1;
      board.users[r.userId] = entry;
    }
    await db.set(leaderboardKey(guildId), board);
  });

  await clearPredictionsForMatch(guildId, matchId);

  const config = await getFootballConfig(client, guildId);
  if (config.activePredictionMatchId === matchId) {
    await setFootballConfig(client, guildId, { activePredictionMatchId: null });
  }

  return results.sort((a, b) => b.points - a.points);
}

export async function getLeaderboard(guildId, limit = 10) {
  const board = (await db.get(leaderboardKey(guildId))) || { users: {} };
  return Object.values(board.users || {})
    .sort((a, b) => b.points - a.points || b.exactCount - a.exactCount)
    .slice(0, limit);
}
