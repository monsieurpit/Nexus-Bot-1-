// Quest catalog: every quest type, its title variants and target ranges, the weekly themes,
// season names and the season tier track. Pure data + deterministic helpers (no Discord, no DB),
// so board generation can be unit-tested.

// ─── Deterministic randomness ──────────────────────────────────────────────────
// Boards must be identical for everyone in a server (and across restarts) for a given day/week,
// yet different between servers and between periods. A string seed → 32-bit PRNG does that.
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRandom(seedText) {
  let a = hashSeed(seedText) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Metrics ───────────────────────────────────────────────────────────────────
// What a quest can count. `unique: true` metrics count distinct things (channels, days, people).
export const METRICS = {
  messages:        { label: 'messages sent' },
  channels:        { label: 'channels chatted in', unique: true },
  activeDays:      { label: 'days active', unique: true },
  replies:         { label: 'replies to members' },
  reactions:       { label: 'reactions added' },
  images:          { label: 'images shared' },
  longMessages:    { label: 'long messages' },
  questions:       { label: 'questions asked' },
  emojiMessages:   { label: 'messages with emoji' },
  welcomes:        { label: 'newcomers greeted', unique: true },
  coinsEarned:     { label: 'coins earned' },
  coinsSpent:      { label: 'coins spent' },
  dailyClaims:     { label: 'daily rewards claimed' },
  workShifts:      { label: 'work shifts' },
  coinflipPlays:   { label: 'coinflips' },
  coinflipWins:    { label: 'coinflips won' },
  slotsSpins:      { label: 'slot spins' },
  slotsWins:       { label: 'slot wins' },
  gamesWon:        { label: 'games won' },
  gameWinnings:    { label: 'coins won at games' },
  paySent:         { label: 'coins gifted' },
  payRecipients:   { label: 'members paid', unique: true },
  deposited:       { label: 'coins deposited' },
  packsBought:     { label: 'packs bought' },
  packsOpened:     { label: 'packs opened' },
  xpGained:        { label: 'XP earned' },
  levelUps:        { label: 'level-ups' },
  triviaCorrect:   { label: 'trivia answers' },
  giveawaysEntered:{ label: 'giveaways entered' },
};

// ─── Quest templates ───────────────────────────────────────────────────────────
// targets: [min, max] per tier. A tier missing from `targets` means the template isn't offered
// at that tier (e.g. "be active on 5 days" can't be a daily quest).
// requires: a feature that must be on in the server for the quest to be completable.
// {n} in a description is replaced by the target.
const T = (o) => o;
export const TEMPLATES = [
  // ── Chat ──
  T({ id: 'chat-a', metric: 'messages', category: 'chat', emoji: '💬', titles: ['Chatterbox', 'Keep the Chat Alive', 'Talk of the Town', 'Social Spark'], desc: 'Send {n} messages', step: 5,
      targets: { daily: [15, 35], easy: [60, 100], medium: [120, 200], hard: [250, 350], legendary: [450, 600] } }),
  T({ id: 'chat-b', metric: 'messages', category: 'chat', emoji: '🗣️', titles: ['Voice of the Server', 'Conversation Starter', 'Never Silent'], desc: 'Send {n} messages in the server', step: 5,
      targets: { daily: [20, 40], medium: [140, 220], hard: [280, 380] } }),
  T({ id: 'explorer', metric: 'channels', category: 'chat', emoji: '🧭', titles: ['Explorer', 'Channel Hopper', 'Grand Tour', 'Wanderer'], desc: 'Chat in {n} different channels', step: 1,
      targets: { daily: [2, 3], easy: [3, 4], medium: [5, 6], hard: [7, 9] } }),
  T({ id: 'regular', metric: 'activeDays', category: 'chat', emoji: '📅', titles: ['Regular', 'Daily Visitor', 'Familiar Face', 'Part of the Furniture'], desc: 'Chat on {n} different days this week', step: 1,
      targets: { easy: [3, 3], medium: [4, 5], hard: [6, 6], legendary: [7, 7] } }),
  T({ id: 'storyteller', metric: 'longMessages', category: 'chat', emoji: '📖', titles: ['Storyteller', 'Wordsmith', 'Essayist', 'Deep Thinker'], desc: 'Send {n} messages of 80+ characters', step: 1,
      targets: { daily: [3, 6], easy: [8, 12], medium: [15, 25], hard: [30, 45] } }),
  T({ id: 'curious', metric: 'questions', category: 'chat', emoji: '❓', titles: ['Curious Mind', 'Question Everything', 'Ask Away'], desc: 'Ask {n} questions (messages ending with "?")', step: 1,
      targets: { daily: [3, 5], easy: [8, 12], medium: [15, 22] } }),
  T({ id: 'emoji', metric: 'emojiMessages', category: 'chat', emoji: '😄', titles: ['Emoji Artist', 'Expressive', 'Mood Setter'], desc: 'Send {n} messages containing an emoji', step: 1,
      targets: { daily: [5, 10], easy: [15, 25], medium: [30, 45] } }),

  // ── Social ──
  T({ id: 'replies', metric: 'replies', category: 'social', emoji: '↩️', titles: ['Good Listener', 'Back and Forth', 'Conversation Keeper', 'Reply Guy'], desc: 'Reply to {n} messages from other members', step: 1,
      targets: { daily: [4, 8], easy: [15, 25], medium: [30, 45], hard: [60, 90] } }),
  T({ id: 'reactions', metric: 'reactions', category: 'social', emoji: '✨', titles: ['Hype Squad', 'Reaction Machine', 'Appreciator', 'Spread the Love'], desc: 'Add {n} reactions to messages', step: 5,
      targets: { daily: [10, 20], easy: [25, 40], medium: [50, 80], hard: [100, 150] } }),
  T({ id: 'images', metric: 'images', category: 'social', emoji: '📸', titles: ['Photographer', 'Show and Tell', 'Meme Lord', 'Gallery Curator'], desc: 'Share {n} images', step: 1,
      targets: { daily: [2, 4], easy: [5, 8], medium: [10, 15], hard: [20, 30] } }),
  T({ id: 'welcomer', metric: 'welcomes', category: 'social', emoji: '👋', titles: ['Welcome Committee', 'Friendly Face', 'Greeter'], desc: 'Mention and greet {n} members who joined in the last 2 days', step: 1,
      targets: { easy: [1, 2], medium: [3, 4], hard: [5, 7] } }),
  T({ id: 'generous', metric: 'payRecipients', category: 'social', emoji: '🎁', requires: 'economy', titles: ['Generous Soul', 'Philanthropist', 'Spread the Wealth'], desc: 'Send coins (50+) to {n} different members', step: 1,
      targets: { easy: [2, 2], medium: [3, 4], hard: [5, 6] } }),
  T({ id: 'gifter', metric: 'paySent', category: 'social', emoji: '💝', requires: 'economy', titles: ['Big Heart', 'Patron', 'Gift Giver'], desc: 'Gift a total of {n} coins with /pay', step: 50,
      targets: { medium: [500, 1000], hard: [1500, 2500] } }),
  T({ id: 'giveaways', metric: 'giveawaysEntered', category: 'social', emoji: '🎉', requires: 'giveaways', titles: ['Feeling Lucky', 'Prize Hunter', 'Ticket Collector'], desc: 'Enter {n} giveaways', step: 1,
      targets: { easy: [1, 1], medium: [2, 3] } }),

  // ── Economy ──
  T({ id: 'earner', metric: 'coinsEarned', category: 'economy', emoji: '🪙', requires: 'economy', titles: ['Money Maker', 'Gold Rush', 'Fortune Seeker', 'Coin Collector', 'Cash Flow'], desc: 'Earn {n} coins', step: 50,
      targets: { daily: [300, 600], easy: [1000, 1500], medium: [2000, 3500], hard: [5000, 7500], legendary: [10000, 15000] } }),
  T({ id: 'spender', metric: 'coinsSpent', category: 'economy', emoji: '🛍️', requires: 'economy', titles: ['Big Spender', 'Shopaholic', 'Retail Therapy'], desc: 'Spend {n} coins in the shop or on packs', step: 50,
      targets: { easy: [300, 500], medium: [800, 1500], hard: [2500, 4000] } }),
  T({ id: 'daily', metric: 'dailyClaims', category: 'economy', emoji: '📅', requires: 'economy', titles: ['Creature of Habit', 'Never Miss a Day', 'Daily Devotion'], desc: 'Claim /daily {n} times', step: 1,
      targets: { daily: [1, 1], easy: [3, 4], medium: [5, 6], hard: [7, 7] } }),
  T({ id: 'worker', metric: 'workShifts', category: 'economy', emoji: '💼', requires: 'economy', titles: ['Hard Worker', 'Overtime', 'Employee of the Week', 'Nine to Five'], desc: 'Complete {n} work shifts with /work', step: 1,
      targets: { daily: [1, 2], easy: [4, 6], medium: [8, 12], hard: [15, 20] } }),
  T({ id: 'saver', metric: 'deposited', category: 'economy', emoji: '🏦', requires: 'economy', titles: ['Saver', 'Piggy Bank', 'Safe Keeper', 'Rainy Day Fund'], desc: 'Deposit {n} coins into your bank', step: 50,
      targets: { daily: [200, 400], easy: [500, 1000], medium: [1500, 2500], hard: [4000, 6000] } }),
  T({ id: 'packs-buy', metric: 'packsBought', category: 'economy', emoji: '📦', requires: 'economy', titles: ['Collector', 'Pack Rat', 'Unboxer'], desc: 'Buy {n} packs', step: 1,
      targets: { easy: [1, 2], medium: [3, 4], hard: [5, 7] } }),
  T({ id: 'packs-open', metric: 'packsOpened', category: 'economy', emoji: '🎁', requires: 'economy', titles: ['Surprise Inside', 'Unwrapper', 'Mystery Box'], desc: 'Open {n} packs', step: 1,
      targets: { easy: [1, 2], medium: [3, 4], hard: [5, 7] } }),

  // ── Games ──
  T({ id: 'flipper', metric: 'coinflipPlays', category: 'games', emoji: '🪙', requires: 'economy', titles: ['Coin Flipper', 'Heads or Tails', 'Fifty-Fifty'], desc: 'Play /coinflip {n} times', step: 1,
      targets: { daily: [3, 5], easy: [8, 12], medium: [15, 25] } }),
  T({ id: 'flip-wins', metric: 'coinflipWins', category: 'games', emoji: '🍀', requires: 'economy', titles: ['Lucky Streak', 'Called It', 'Fortune Favors'], desc: 'Win {n} coinflips', step: 1,
      targets: { daily: [2, 3], easy: [4, 6], medium: [8, 12], hard: [15, 20] } }),
  T({ id: 'spinner', metric: 'slotsSpins', category: 'games', emoji: '🎰', requires: 'economy', titles: ['Slot Spinner', 'One More Spin', 'Reel Deal'], desc: 'Spin /slots {n} times', step: 1,
      targets: { daily: [3, 6], easy: [10, 15], medium: [20, 30] } }),
  T({ id: 'slot-wins', metric: 'slotsWins', category: 'games', emoji: '🍒', requires: 'economy', titles: ['Jackpot Chaser', 'Cherry Picker', 'Matching Reels'], desc: 'Win {n} slot spins', step: 1,
      targets: { daily: [1, 2], easy: [3, 5], medium: [6, 10], hard: [12, 18] } }),
  T({ id: 'winner', metric: 'gamesWon', category: 'games', emoji: '🏅', requires: 'economy', titles: ['Winner Winner', 'Champion', 'Unstoppable'], desc: 'Win {n} games (coinflip, slots, ultragamble)', step: 1,
      targets: { daily: [2, 4], easy: [5, 8], medium: [10, 15], hard: [20, 30], legendary: [40, 55] } }),
  T({ id: 'high-roller', metric: 'gameWinnings', category: 'games', emoji: '💎', requires: 'economy', titles: ['High Roller', 'House Breaker', 'Card Shark', 'Beat the Odds'], desc: 'Win {n} coins (profit) at games', step: 50,
      targets: { daily: [200, 400], easy: [500, 1000], medium: [1500, 2500], hard: [4000, 6000], legendary: [8000, 12000] } }),

  // ── Leveling & trivia ──
  T({ id: 'xp', metric: 'xpGained', category: 'leveling', emoji: '📈', requires: 'leveling', titles: ['XP Hunter', 'Level Grinder', 'Rising Star', 'On the Rise'], desc: 'Earn {n} XP', step: 25,
      targets: { daily: [150, 300], easy: [500, 800], medium: [1000, 1600], hard: [2000, 3000], legendary: [4000, 5500] } }),
  T({ id: 'levels', metric: 'levelUps', category: 'leveling', emoji: '🆙', requires: 'leveling', titles: ['Level Up', 'Next Rank', 'Ascension'], desc: 'Level up {n} times', step: 1,
      targets: { medium: [1, 1], hard: [2, 2], legendary: [3, 4] } }),
  T({ id: 'trivia', metric: 'triviaCorrect', category: 'leveling', emoji: '🧠', requires: 'trivia', titles: ['Big Brain', 'Quiz Master', 'Know-It-All', 'Smarty Pants'], desc: 'Answer {n} /question trivia correctly', step: 1,
      targets: { daily: [1, 2], easy: [3, 5], medium: [6, 10], hard: [12, 18] } }),
];

export const CATEGORIES = {
  chat: { name: 'Chat', emoji: '💬' },
  social: { name: 'Social', emoji: '🤝' },
  economy: { name: 'Economy', emoji: '🪙' },
  games: { name: 'Games', emoji: '🎲' },
  leveling: { name: 'Leveling', emoji: '📈' },
};

// ─── Difficulty & rewards ──────────────────────────────────────────────────────
export const DIFFICULTY = {
  daily:     { name: 'Daily',     emoji: '☀️', stars: 1, coins: [80, 140] },
  dailyHard: { name: 'Daily',     emoji: '☀️', stars: 2, coins: [160, 240] },
  easy:      { name: 'Easy',      emoji: '🟢', stars: 2, coins: [250, 350] },
  medium:    { name: 'Medium',    emoji: '🟡', stars: 3, coins: [450, 650] },
  hard:      { name: 'Hard',      emoji: '🔴', stars: 5, coins: [900, 1300] },
  legendary: { name: 'Legendary', emoji: '🟣', stars: 8, coins: [1800, 2600] },
};

// Bonus for finishing a whole board.
export const CHESTS = {
  daily: { stars: 1, coins: 150, name: 'Daily chest', emoji: '🧰' },
  weekly: { stars: 5, coins: 1500, name: 'Weekly chest', emoji: '🗝️' },
};

// ─── Weekly themes ─────────────────────────────────────────────────────────────
// Each week's board has a theme that changes which quests appear and how they pay.
// favor: categories that get two extra slots of weight. Effects are applied in generateBoard.
export const THEMES = [
  { id: 'golden', name: 'Golden Week', emoji: '🪙', blurb: 'Every quest pays **1.5×** coins.', coinMult: 1.5 },
  { id: 'chatter', name: 'Chatterbox Week', emoji: '💬', blurb: 'Chat quests take over and give **+1 ⭐**.', favor: ['chat'], bonusStars: { chat: 1 } },
  { id: 'rollers', name: 'High Rollers', emoji: '🎰', blurb: 'Game quests are everywhere and pay **1.5×** coins.', favor: ['games'], requires: 'economy', categoryCoinMult: { games: 1.5 } },
  { id: 'community', name: 'Community Week', emoji: '🤝', blurb: 'Social quests give **+1 ⭐** — go make someone\'s day.', favor: ['social'], bonusStars: { social: 1 } },
  { id: 'grind', name: 'Grind Week', emoji: '⚒️', blurb: 'Economy quests galore, all coins **1.25×**.', favor: ['economy'], requires: 'economy', coinMult: 1.25 },
  { id: 'starrush', name: 'Star Rush', emoji: '⭐', blurb: 'Every quest gives **+1 ⭐**. Climb those tiers!', allBonusStars: 1 },
  { id: 'treasure', name: 'Treasure Hunt', emoji: '🗝️', blurb: 'The weekly chest is **doubled**.', chestMult: 2 },
  { id: 'levelup', name: 'Level-Up Week', emoji: '📈', blurb: 'Leveling quests give **+1 ⭐**.', favor: ['leveling'], requires: 'leveling', bonusStars: { leveling: 1 } },
  { id: 'calm', name: 'Calm Week', emoji: '🍃', blurb: 'Targets are **20% lower** — a relaxed week.', targetMult: 0.8 },
  { id: 'marathon', name: 'Marathon Week', emoji: '🏃', blurb: 'Targets **30% higher**, coins **1.6×**, hard quests **+2 ⭐**.', targetMult: 1.3, coinMult: 1.6, tierBonusStars: { hard: 2, legendary: 2 } },
  { id: 'lucky', name: 'Lucky Week', emoji: '🍀', blurb: 'One random quest is **lucky** and pays **3×** coins.', luckyQuest: true },
  { id: 'mixed', name: 'Grab Bag', emoji: '🎲', blurb: 'A bit of everything — no category twice.', distinctCategories: true },
];

// ─── Seasons ───────────────────────────────────────────────────────────────────
export const SEASON_NAMES = [
  ['Ember', '🔥'], ['Tidecall', '🌊'], ['Frostbite', '❄️'], ['Neon Nights', '🌃'], ['Thunderstrike', '⚡'], ['Bloom', '🌸'],
  ['Starfall', '🌠'], ['Midnight Bloom', '🌙'], ['Wildfire', '🏕️'], ['Aurora', '🌌'], ['Gold Rush', '🏆'], ['Stormbreak', '⛈️'],
  ['Crystal Peak', '💎'], ['Solar Flare', '☀️'], ['Deep Space', '🚀'], ['Harvest Moon', '🌕'], ['Iron Will', '🛡️'], ['Phoenix', '🐦‍🔥'],
  ['Wanderlust', '🧭'], ['Royal Court', '👑'], ['Echoes', '🎧'], ['Sakura', '🌸'], ['Arcade', '🕹️'], ['Kingdom Come', '🏰'],
];

export const STARS_PER_TIER = 12;
export const MAX_TIER = 20;

// Coins paid when reaching a tier; milestone tiers pay extra and carry a badge.
export const MILESTONES = {
  5: { bonus: 500, badge: '🥉', name: 'Bronze' },
  10: { bonus: 1000, badge: '🥈', name: 'Silver' },
  15: { bonus: 2000, badge: '🥇', name: 'Gold' },
  20: { bonus: 5000, badge: '💠', name: 'Legend' },
};

export function tierReward(tier) {
  return 75 + 25 * tier + (MILESTONES[tier]?.bonus || 0);
}

export function tierForStars(stars) {
  return Math.min(MAX_TIER, Math.floor(Math.max(0, stars) / STARS_PER_TIER));
}

/** Badge for a tier (highest milestone reached), or null. */
export function badgeForTier(tier) {
  let badge = null;
  for (const [t, m] of Object.entries(MILESTONES)) if (tier >= Number(t)) badge = m;
  return badge;
}

// End-of-season prizes for the top 3.
export const PODIUM = [2500, 1500, 800];
