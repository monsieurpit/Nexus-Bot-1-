// Seasons & Quests — boards, progress tracking, claiming and season rollover.
//
// Data (all through the DatabaseWrapper, so Firestore in production):
//   quests:<guild>:settings                    { enabled, channelId, announceCompletions, multiplier, tierRoles }
//   quests:<guild>:board:<daily|weekly>:<key>  the generated board for that period (frozen once created)
//   quests:<guild>:user:<user>                 { daily, weekly, season } progress/claims
//   quests:<guild>:season:<YYYY-MM>            { stars: {user: n}, completed: {user: n}, finalized }
//   quests:<guild>:season:current              id of the last season this server played
//
// Activity is counted in memory (trackQuestEvent) and written in batches
// (flushQuestProgress, every 5 minutes), so busy chats don't cost a database write per message.
import { db } from '../../utils/database.js';
import { logger } from '../../utils/logger.js';
import { Mutex } from '../../utils/mutex.js';
import {
  TEMPLATES, METRICS, DIFFICULTY, CHESTS, THEMES, SEASON_NAMES, MAX_TIER,
  seededRandom, pick, shuffle, tierForStars, tierReward, PODIUM,
} from './catalog.js';

// ─── Periods (UTC) ─────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

export function periodKeys(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  // ISO week: Thursday of the current week decides the year.
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getTime() - dow * 86400000);
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  const week = `${thursday.getUTCFullYear()}-W${pad(weekNo)}`;
  const season = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  return {
    day,
    week,
    weekNumber: weekNo,
    season,
    dayEndsAt: d.getTime() + 86400000,
    weekEndsAt: monday.getTime() + 7 * 86400000,
    seasonEndsAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  };
}

function previousKey(kind, now) {
  const back = kind === 'daily' ? 86400000 : 7 * 86400000;
  const keys = periodKeys(new Date(now.getTime() - back));
  return kind === 'daily' ? keys.day : keys.week;
}

// ─── Season identity ───────────────────────────────────────────────────────────
export function seasonInfo(guildId, seasonId) {
  const rng = seededRandom(`${guildId}:season:${seasonId}`);
  const [name, emoji] = pick(rng, SEASON_NAMES);
  const [year, month] = seasonId.split('-').map(Number);
  // Season number counts months since the feature's first season (Nov 2026 = Season 1).
  const number = Math.max(1, (year - 2026) * 12 + month - 10);
  return { id: seasonId, name, emoji, number, endsAt: Date.UTC(year, month, 1) };
}

// ─── Board generation ──────────────────────────────────────────────────────────
const SLOTS = {
  daily: ['daily', 'daily', 'dailyHard'],
  weekly: ['easy', 'easy', 'medium', 'medium', 'hard', 'legendary'],
};

/** "{n}" → the target, with the counted noun made singular for 1 ("Open 1 pack", "Level up 1 time"). */
export function describe(template, target) {
  const text = template.replace('{n}', target.toLocaleString('en-US'));
  if (target !== 1) return text;
  // The counted noun is the first or second word after the number ("1 packs", "1 work shifts").
  return text.replace(/\b1 ((?:\S+ )?)(\w+?)s\b/, (m, lead, word) => (word.endsWith('s') ? m : `1 ${lead}${word}`));
}

function roundTo(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

function baseOrder(guildId, weekIndex, options) {
  return shuffle(seededRandom(`${guildId}:theme:${weekIndex}`), options);
}

const themeCache = new Map();
/**
 * The week's theme. Walking forward from a fixed anchor week means each week can avoid the two
 * themes that were ACTUALLY used before it, so a theme never repeats within three weeks while
 * staying deterministic (same answer on every restart).
 */
export function pickTheme(guildId, weekKey, features = {}) {
  const options = THEMES.filter((t) => !t.requires || features[t.requires]);
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || '');
  if (!m) return baseOrder(guildId, weekKey, options)[0];
  const target = (Number(m[1]) - 2026) * 53 + Number(m[2]);
  const cacheKey = `${guildId}:${options.map((o) => o.id).join(',')}`;
  let chain = themeCache.get(cacheKey);
  if (!chain) { chain = []; themeCache.set(cacheKey, chain); }
  for (let i = chain.length; i <= Math.max(0, target); i++) {
    const recent = [chain[i - 1], chain[i - 2]].filter(Boolean).map((t) => t.id);
    const ordered = baseOrder(guildId, i, options);
    chain.push(ordered.find((t) => !recent.includes(t.id)) || ordered[0]);
  }
  return chain[Math.max(0, target)];
}

/**
 * Builds the board for a period. Deterministic for (guild, kind, period, features); avoids the
 * previous period's quest types so consecutive days/weeks never look the same.
 */
export function generateBoard({ guildId, kind, periodKey, weekKey, features = {}, avoidMetrics = [] }) {
  const rng = seededRandom(`${guildId}:${kind}:${periodKey}`);
  const theme = pickTheme(guildId, weekKey || periodKey, features);
  const usedMetrics = new Set();
  const usedCategories = new Set();
  const quests = [];
  const luckyIndex = theme.luckyQuest && kind === 'weekly' ? Math.floor(rng() * SLOTS.weekly.length) : -1;

  SLOTS[kind].forEach((slot, index) => {
    const targetKey = slot === 'dailyHard' ? 'daily' : slot;
    let candidates = TEMPLATES.filter((t) =>
      t.targets[targetKey] && (!t.requires || features[t.requires]) && !usedMetrics.has(t.metric));
    if (theme.distinctCategories) {
      const fresh = candidates.filter((t) => !usedCategories.has(t.category));
      if (fresh.length) candidates = fresh;
    }
    if (!candidates.length) return;

    // Weighted pick: themed categories ×3, last period's quest types ×0.25.
    const weights = candidates.map((t) =>
      (theme.favor?.includes(t.category) ? 3 : 1) * (avoidMetrics.includes(t.metric) ? 0.25 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let template = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { template = candidates[i]; break; }
    }

    const [min, max] = template.targets[targetKey];
    let target = min + rng() * (max - min);
    if (slot === 'dailyHard') target *= 1.6;
    target *= theme.targetMult || 1;
    target = roundTo(target, template.step);
    if (template.metric === 'activeDays') target = Math.min(7, target);

    const diff = DIFFICULTY[slot];
    let coins = diff.coins[0] + rng() * (diff.coins[1] - diff.coins[0]);
    coins *= theme.coinMult || 1;
    coins *= theme.categoryCoinMult?.[template.category] || 1;
    const lucky = index === luckyIndex;
    if (lucky) coins *= 3;
    coins = Math.round(coins / 10) * 10;

    const stars = diff.stars
      + (theme.bonusStars?.[template.category] || 0)
      + (theme.allBonusStars || 0)
      + (theme.tierBonusStars?.[slot] || 0);

    usedMetrics.add(template.metric);
    usedCategories.add(template.category);
    quests.push({
      id: `${kind}-${index}-${template.id}`,
      templateId: template.id,
      metric: template.metric,
      category: template.category,
      difficulty: slot,
      emoji: template.emoji,
      title: pick(rng, template.titles),
      description: describe(template.desc, target),
      target,
      coins,
      stars,
      lucky,
    });
  });

  const chest = { ...CHESTS[kind] };
  if (kind === 'weekly' && theme.chestMult) {
    chest.coins *= theme.chestMult;
    chest.stars *= theme.chestMult;
  }
  return { kind, period: periodKey, theme: { id: theme.id, name: theme.name, emoji: theme.emoji, blurb: theme.blurb }, quests, chest };
}

// ─── Settings & features ───────────────────────────────────────────────────────
// Off until an admin runs /quests setup: nothing is tracked or posted before that.
export const DEFAULT_SETTINGS = { enabled: false, channelId: null, announceCompletions: true, multiplier: 1, tierRoles: {}, lastDailyPost: null };
const settingsKey = (g) => `quests:${g}:settings`;
const boardKey = (g, kind, key) => `quests:${g}:board:${kind}:${key}`;
const userKey = (g, u) => `quests:${g}:user:${u}`;
const seasonKey = (g, s) => `quests:${g}:season:${s}`;
const currentSeasonKey = (g) => `quests:${g}:season:current`;

export async function getQuestSettings(guildId) {
  const stored = await db.get(settingsKey(guildId));
  return { ...DEFAULT_SETTINGS, ...(stored || {}), tierRoles: { ...(stored?.tierRoles || {}) } };
}

export async function updateQuestSettings(guildId, patch) {
  return Mutex.runExclusive(settingsKey(guildId), async () => {
    const current = { ...DEFAULT_SETTINGS, ...((await db.getStrict(settingsKey(guildId))) || {}) };
    const next = { ...current, ...patch };
    await db.set(settingsKey(guildId), next);
    return next;
  });
}

// Which quest families make sense in this server (no XP quests when leveling is off, etc.).
const featureCache = new Map();
export async function getFeatures(client, guildId) {
  const cached = featureCache.get(guildId);
  if (cached && cached.at > Date.now() - 10 * 60 * 1000) return cached.value;
  const value = { economy: true, leveling: false, trivia: true, giveaways: true };
  try {
    const { getEconomyConfig } = await import('../economy.js');
    value.economy = (await getEconomyConfig(guildId))?.enabled !== false;
  } catch { /* keep default */ }
  try {
    const { getLevelingConfig } = await import('../leveling.js');
    // Background flushes have no Discord client; the database is all getLevelingConfig needs.
    value.leveling = Boolean((await getLevelingConfig(client?.db ? client : { db }, guildId))?.enabled);
  } catch { /* keep default */ }
  featureCache.set(guildId, { at: Date.now(), value });
  return value;
}

/** The board for the current (or given) period — generated once, then frozen in the database. */
export async function getBoard(client, guildId, kind, now = new Date()) {
  const keys = periodKeys(now);
  const periodKey = kind === 'daily' ? keys.day : keys.week;
  const key = boardKey(guildId, kind, periodKey);
  const stored = await db.get(key);
  if (stored?.quests) return stored;
  return Mutex.runExclusive(key, async () => {
    const again = await db.getStrict(key);
    if (again?.quests) return again;
    const features = await getFeatures(client, guildId);
    const prev = await db.get(boardKey(guildId, kind, previousKey(kind, now)));
    const board = generateBoard({
      guildId, kind, periodKey, weekKey: keys.week, features,
      avoidMetrics: (prev?.quests || []).map((q) => q.metric),
    });
    // The daily board inherits the week's theme coin multiplier and blurb, so a themed week
    // is felt every day.
    await db.set(key, board);
    return board;
  });
}

async function getStoredBoard(guildId, kind, periodKey) {
  return db.get(boardKey(guildId, kind, periodKey));
}

// ─── User state ────────────────────────────────────────────────────────────────
function emptyPeriod(period) {
  return { period, progress: {}, sets: {}, claimed: [], completedAt: {}, chestClaimed: false };
}

function emptyState(keys) {
  return { daily: emptyPeriod(keys.day), weekly: emptyPeriod(keys.week), season: { id: keys.season, stars: 0, tier: 0, completed: 0 }, pendingNotice: null };
}

export function progressFor(periodState, quest) {
  if (!periodState) return 0;
  const unique = METRICS[quest.metric]?.unique;
  const value = unique ? (periodState.sets?.[quest.metric]?.length || 0) : (periodState.progress?.[quest.metric] || 0);
  return Math.max(0, value);
}

// Once reached, a quest stays complete (withdrawing coins after a deposit quest must not undo it).
export const isComplete = (periodState, quest) =>
  Boolean(periodState?.completedAt?.[quest.id]) || progressFor(periodState, quest) >= quest.target;

/** Rewards still to claim for a board. */
export function claimable(periodState, board) {
  if (!board?.quests || !periodState) return { quests: [], chest: false };
  const quests = board.quests.filter((q) => isComplete(periodState, q) && !periodState.claimed.includes(q.id));
  const allDone = board.quests.length > 0 && board.quests.every((q) => isComplete(periodState, q));
  return { quests, chest: allDone && !periodState.chestClaimed };
}

// ─── Tracking (in memory, flushed periodically) ────────────────────────────────
const pending = new Map(); // `${guild}:${user}` → { guildId, userId, inc: {}, add: {} }

function bucket(guildId, userId) {
  const key = `${guildId}:${userId}`;
  let entry = pending.get(key);
  if (!entry) {
    entry = { guildId, userId, inc: {}, add: {} };
    pending.set(key, entry);
  }
  return entry;
}

/** Count activity for quests. Never throws, never touches the database. */
export function trackQuestEvent(guildId, userId, metric, amount = 1) {
  try {
    if (!guildId || !userId || !METRICS[metric] || !Number.isFinite(amount) || amount === 0) return;
    if (METRICS[metric].unique) return trackQuestUnique(guildId, userId, metric, String(amount));
    const entry = bucket(guildId, userId);
    entry.inc[metric] = (entry.inc[metric] || 0) + amount;
  } catch { /* tracking must never break the feature that called it */ }
}

/** Count a distinct thing (channel, day, member) for a `unique` metric. */
export function trackQuestUnique(guildId, userId, metric, value) {
  try {
    if (!guildId || !userId || !METRICS[metric]?.unique || !value) return;
    const entry = bucket(guildId, userId);
    (entry.add[metric] ||= new Set()).add(String(value));
  } catch { /* never break the caller */ }
}

const MAX_SET = 60;

function applyBucket(periodState, entry, metrics) {
  for (const [metric, amount] of Object.entries(entry.inc)) {
    if (!metrics.has(metric)) continue;
    periodState.progress[metric] = (periodState.progress[metric] || 0) + amount;
  }
  for (const [metric, values] of Object.entries(entry.add)) {
    if (!metrics.has(metric)) continue;
    const set = new Set(periodState.sets[metric] || []);
    for (const v of values) if (set.size < MAX_SET) set.add(v);
    periodState.sets[metric] = [...set];
  }
}

// ─── Rewards ───────────────────────────────────────────────────────────────────
async function payCoins(guildId, userId, amount, features) {
  if (!amount || !features.economy) return 0;
  const { addCoins } = await import('../economy.js');
  const result = await addCoins(guildId, userId, Math.round(amount));
  if (!result) throw new Error('coin payout failed');
  return Math.round(amount);
}

async function refundCoins(guildId, userId, amount) {
  if (!amount) return;
  const { removeCoins } = await import('../economy.js');
  await removeCoins(guildId, userId, amount).catch((err) =>
    logger.error(`[Quests] Could not undo a ${amount}-coin payout for ${userId} in ${guildId}:`, err));
}

/** Adds stars to the season standing; returns { tiersReached: number[] } and mutates state.season. */
function addStars(state, stars) {
  const before = tierForStars(state.season.stars);
  state.season.stars += stars;
  const after = tierForStars(state.season.stars);
  const reached = [];
  for (let t = Math.max(before, state.season.tier) + 1; t <= after; t++) reached.push(t);
  state.season.tier = Math.max(state.season.tier, after);
  return reached;
}

async function recordSeasonStanding(guildId, seasonId, userId, stars, completedDelta) {
  const key = seasonKey(guildId, seasonId);
  await Mutex.runExclusive(key, async () => {
    const data = (await db.getStrict(key)) || { stars: {}, completed: {} };
    data.stars ||= {};
    data.completed ||= {};
    data.stars[userId] = stars;
    data.completed[userId] = (data.completed[userId] || 0) + completedDelta;
    await db.set(key, data);
  });
}

/**
 * Collects rewards for completed quests on the given boards (all that are complete and
 * unclaimed), applies stars/tiers, pays coins (with refund if the save fails).
 * Mutates `state`; the caller saves it.
 */
async function collect(guildId, userId, state, boards, settings, features) {
  const mult = Number(settings.multiplier) > 0 ? Number(settings.multiplier) : 1;
  const summary = { quests: [], chests: [], coins: 0, stars: 0, tiersReached: [], completedCount: 0, multiplier: mult };
  for (const { kind, board } of boards) {
    const periodState = state[kind];
    const { quests, chest } = claimable(periodState, board);
    for (const q of quests) {
      periodState.claimed.push(q.id);
      summary.quests.push({ ...q, kind });
      summary.coins += q.coins * mult;
      summary.stars += q.stars;
      summary.completedCount++;
    }
    if (chest) {
      periodState.chestClaimed = true;
      summary.chests.push({ kind, ...board.chest });
      summary.coins += board.chest.coins * mult;
      summary.stars += board.chest.stars;
    }
  }
  if (!summary.quests.length && !summary.chests.length) return summary;

  summary.tiersReached = addStars(state, summary.stars);
  // Captured now: an automatic payout at a month boundary belongs to the season that just ended.
  summary.seasonId = state.season.id;
  summary.seasonStars = state.season.stars;
  for (const t of summary.tiersReached) summary.coins += tierReward(t) * mult;
  state.season.completed += summary.completedCount;
  summary.coins = Math.round(summary.coins);
  summary.paid = await payCoins(guildId, userId, summary.coins, features);
  return summary;
}

// Bring a stored state up to the current periods; finished periods are paid out automatically.
async function rollState(client, guildId, userId, state, keys, settings, features) {
  const autoBoards = [];
  for (const [kind, current] of [['daily', keys.day], ['weekly', keys.week]]) {
    if (state[kind]?.period !== current) {
      if (state[kind]?.period) {
        const oldBoard = await getStoredBoard(guildId, kind, state[kind].period);
        if (oldBoard) autoBoards.push({ kind, board: oldBoard });
      }
    }
  }
  let auto = null;
  if (autoBoards.length) {
    // Season stars earned at the end of last month still count for last month's season.
    auto = await collect(guildId, userId, state, autoBoards, settings, features);
    if (!auto.quests.length && !auto.chests.length) auto = null;
  }
  for (const [kind, current] of [['daily', keys.day], ['weekly', keys.week]]) {
    if (state[kind]?.period !== current) state[kind] = emptyPeriod(current);
  }
  if (state.season?.id !== keys.season) {
    state.season = { id: keys.season, stars: 0, tier: 0, completed: 0 };
  }
  if (auto) {
    state.pendingNotice = { coins: auto.coins, stars: auto.stars, quests: auto.quests.length + auto.chests.length };
  }
  return auto;
}

async function loadState(guildId, userId, keys) {
  const stored = await db.getStrict(userKey(guildId, userId));
  const state = stored && stored.daily ? stored : emptyState(keys);
  state.season ||= { id: keys.season, stars: 0, tier: 0, completed: 0 };
  return state;
}

/**
 * Full read for display: current boards, the member's state (rolled forward, auto-claims applied)
 * and a one-time notice about rewards collected automatically from a finished day/week.
 */
export async function getQuestOverview(client, guildId, userId, now = new Date()) {
  await flushQuestProgress({ only: `${guildId}:${userId}` });
  const keys = periodKeys(now);
  const [settings, features, daily, weekly] = await Promise.all([
    getQuestSettings(guildId), getFeatures(client, guildId), getBoard(client, guildId, 'daily', now), getBoard(client, guildId, 'weekly', now),
  ]);
  return Mutex.runExclusive(userKey(guildId, userId), async () => {
    const state = await loadState(guildId, userId, keys);
    const seasonBefore = state.season?.id;
    const auto = await rollState(client, guildId, userId, state, keys, settings, features);
    const notice = state.pendingNotice;
    if (auto || notice || seasonBefore !== state.season.id) {
      state.pendingNotice = null;
      await saveStateOrRefund(guildId, userId, state, auto);
    }
    return { keys, settings, features, boards: { daily, weekly }, state, notice };
  });
}

async function saveStateOrRefund(guildId, userId, state, summary) {
  try {
    await db.set(userKey(guildId, userId), state);
  } catch (error) {
    // The coins were already paid: take them back so a retry can't pay twice.
    await refundCoins(guildId, userId, summary?.paid || 0);
    throw error;
  }
  if (summary?.quests?.length || summary?.chests?.length) {
    await recordSeasonStanding(guildId, summary.seasonId || state.season.id, userId, summary.seasonStars ?? state.season.stars, summary.completedCount || 0)
      .catch((err) => logger.warn(`[Quests] Season standing update failed for ${userId}: ${err.message}`));
  }
}

/** Claims every completed quest + chest on the current boards. */
export async function claimQuestRewards(client, guildId, userId, now = new Date()) {
  await flushQuestProgress({ only: `${guildId}:${userId}` });
  const keys = periodKeys(now);
  const [settings, features, daily, weekly] = await Promise.all([
    getQuestSettings(guildId), getFeatures(client, guildId), getBoard(client, guildId, 'daily', now), getBoard(client, guildId, 'weekly', now),
  ]);
  return Mutex.runExclusive(userKey(guildId, userId), async () => {
    const state = await loadState(guildId, userId, keys);
    const auto = await rollState(client, guildId, userId, state, keys, settings, features);
    if (auto) await saveStateOrRefund(guildId, userId, state, auto);
    const summary = await collect(guildId, userId, state, [{ kind: 'daily', board: daily }, { kind: 'weekly', board: weekly }], settings, features);
    if (summary.quests.length || summary.chests.length) await saveStateOrRefund(guildId, userId, state, summary);
    summary.state = state;
    summary.boards = { daily, weekly };
    summary.roles = summary.tiersReached.map((t) => settings.tierRoles?.[t]).filter(Boolean);
    summary.economy = features.economy;
    return summary;
  });
}

/**
 * Marks every quest on today's DAILY board as complete for one member (owner tool, see
 * /quests complete-daily). Rewards are then collected with the normal Claim button, so coins,
 * stars, tiers and the leaderboard all go through the usual path. Returns { completed, board }.
 */
export async function forceCompleteDaily(client, guildId, userId, now = new Date()) {
  await flushQuestProgress({ only: `${guildId}:${userId}` });
  const keys = periodKeys(now);
  const [settings, features, daily] = await Promise.all([
    getQuestSettings(guildId), getFeatures(client, guildId), getBoard(client, guildId, 'daily', now),
  ]);
  return Mutex.runExclusive(userKey(guildId, userId), async () => {
    const state = await loadState(guildId, userId, keys);
    const auto = await rollState(client, guildId, userId, state, keys, settings, features);
    let completed = 0;
    for (const q of daily.quests) {
      if (isComplete(state.daily, q)) continue;
      state.daily.completedAt[q.id] = now.getTime();
      completed++;
    }
    if (completed || auto) await saveStateOrRefund(guildId, userId, state, auto);
    return { completed, board: daily };
  });
}

// ─── Flush: write buffered progress and detect newly completed quests ──────────
let flushing = null;

/**
 * Writes buffered progress. Returns [{ guildId, userId, quest }] for quests that became complete,
 * used for the optional announcement in the server's quest channel.
 * @param {{ only?: string, client?: object }} [opts]
 */
export async function flushQuestProgress({ only = null, client = null } = {}) {
  if (!only && flushing) return flushing;
  if (only && flushing) await flushing.catch(() => null); // let a running flush finish writing first
  const run = (async () => {
    const entries = [];
    for (const [key, entry] of pending) {
      if (only && key !== only) continue;
      pending.delete(key);
      entries.push(entry);
    }
    const completions = [];
    const keys = periodKeys();
    for (const entry of entries) {
      try {
        const settings = await getQuestSettings(entry.guildId);
        if (!settings.enabled) continue;
        const [daily, weekly] = await Promise.all([
          getBoard(client, entry.guildId, 'daily'), getBoard(client, entry.guildId, 'weekly'),
        ]);
        await Mutex.runExclusive(userKey(entry.guildId, entry.userId), async () => {
          const state = await loadState(entry.guildId, entry.userId, keys);
          const features = await getFeatures(client, entry.guildId);
          const auto = await rollState(client, entry.guildId, entry.userId, state, keys, settings, features);
          for (const [kind, board] of [['daily', daily], ['weekly', weekly]]) {
            const before = new Set(board.quests.filter((q) => isComplete(state[kind], q)).map((q) => q.id));
            applyBucket(state[kind], entry, new Set(board.quests.map((q) => q.metric)));
            for (const q of board.quests) {
              if (!before.has(q.id) && isComplete(state[kind], q)) {
                state[kind].completedAt[q.id] = Date.now();
                completions.push({ guildId: entry.guildId, userId: entry.userId, quest: q, kind });
              }
            }
          }
          await saveStateOrRefund(entry.guildId, entry.userId, state, auto);
        });
      } catch (error) {
        // Put the counts back so a transient database error doesn't lose progress.
        const back = bucket(entry.guildId, entry.userId);
        for (const [m, n] of Object.entries(entry.inc)) back.inc[m] = (back.inc[m] || 0) + n;
        for (const [m, set] of Object.entries(entry.add)) for (const v of set) (back.add[m] ||= new Set()).add(v);
        logger.warn(`[Quests] Progress flush failed for ${entry.userId} in ${entry.guildId}: ${error.message}`);
      }
    }
    return completions;
  })();
  if (!only) flushing = run.finally(() => { flushing = null; });
  return run;
}

// ─── Leaderboard & season rollover ─────────────────────────────────────────────
export async function getSeasonLeaderboard(guildId, seasonId, limit = 10) {
  const data = (await db.get(seasonKey(guildId, seasonId))) || { stars: {}, completed: {} };
  return Object.entries(data.stars || {})
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, stars]) => ({ userId, stars, tier: tierForStars(stars), completed: data.completed?.[userId] || 0 }));
}

export async function getSeasonStats(guildId, seasonId) {
  const data = (await db.get(seasonKey(guildId, seasonId))) || { stars: {}, completed: {} };
  const players = Object.values(data.stars || {}).filter((s) => s > 0).length;
  const quests = Object.values(data.completed || {}).reduce((a, b) => a + b, 0);
  return { players, quests };
}

/**
 * Called hourly. When the month changes, closes the previous season once: pays the podium and
 * returns what to announce. Returns null when nothing changed.
 */
export async function finalizeSeasonIfNeeded(guildId, now = new Date()) {
  const keys = periodKeys(now);
  const last = await db.getStrict(currentSeasonKey(guildId));
  if (!last) {
    await db.set(currentSeasonKey(guildId), keys.season);
    return null;
  }
  if (last === keys.season) return null;
  const key = seasonKey(guildId, last);
  const result = await Mutex.runExclusive(key, async () => {
    const data = (await db.getStrict(key)) || { stars: {}, completed: {} };
    if (data.finalized) return null;
    data.finalized = true; // marked before paying: a crash can skip a prize but never pay twice
    await db.set(key, data);
    const top = Object.entries(data.stars || {}).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const settings = await getQuestSettings(guildId);
    const mult = Number(settings.multiplier) > 0 ? Number(settings.multiplier) : 1;
    const podium = [];
    const { addCoins, getEconomyConfig } = await import('../economy.js');
    const economyOn = (await getEconomyConfig(guildId))?.enabled !== false;
    for (let i = 0; i < top.length; i++) {
      const prize = Math.round(PODIUM[i] * mult);
      if (economyOn) await addCoins(guildId, top[i][0], prize).catch(() => null);
      podium.push({ userId: top[i][0], stars: top[i][1], prize: economyOn ? prize : 0 });
    }
    return {
      season: seasonInfo(guildId, last),
      podium,
      players: Object.values(data.stars || {}).filter((s) => s > 0).length,
      quests: Object.values(data.completed || {}).reduce((a, b) => a + b, 0),
    };
  });
  await db.set(currentSeasonKey(guildId), keys.season);
  return result;
}

// ─── Test hooks ────────────────────────────────────────────────────────────────
export function _pendingForTests() { return pending; }
export function _resetQuestCachesForTests() { pending.clear(); featureCache.clear(); }
export { MAX_TIER };
