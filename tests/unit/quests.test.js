import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_CACHE_TTL_MS = '0';
const { db } = await import('../../src/utils/database.js');
const { MemoryStorage } = await import('../../src/utils/memoryStorage.js');
const Q = await import('../../src/services/quests/questService.js');
const { trackMessageForQuests, _resetTrackerForTests } = await import('../../src/services/quests/questTracker.js');
const { buildQuestBoardEmbed, buildDailyPostEmbed } = await import('../../src/services/quests/questEmbeds.js');
const { postDailyBoard } = await import('../../src/services/quests/questAnnouncer.js');
const { tierForStars, STARS_PER_TIER, TEMPLATES } = await import('../../src/services/quests/catalog.js');
const economy = await import('../../src/services/economy.js');

const ALL = { economy: true, leveling: true, trivia: true, giveaways: true };
const client = { db };

function freshDb() {
  db.db = new MemoryStorage();
  db.initialized = true;
  db.useFallback = false;
  db.connectionType = 'firestore';
  db.cache.clear();
  Q._resetQuestCachesForTests();
  _resetTrackerForTests();
}

test('periods: ISO weeks and UTC day/month boundaries', () => {
  assert.equal(Q.periodKeys(new Date('2026-11-09T10:00:00Z')).week, '2026-W46'); // Monday
  assert.equal(Q.periodKeys(new Date('2026-11-15T23:59:00Z')).week, '2026-W46'); // Sunday
  assert.equal(Q.periodKeys(new Date('2027-01-01T12:00:00Z')).week, '2026-W53');
  const k = Q.periodKeys(new Date('2026-11-30T23:00:00Z'));
  assert.equal(k.day, '2026-11-30');
  assert.equal(k.season, '2026-11');
  assert.equal(k.seasonEndsAt, Date.UTC(2026, 11, 1));
  assert.equal(k.dayEndsAt, Date.UTC(2026, 10, 30) + 86400000);
});

test('boards are deterministic, varied, and never repeat a quest type on one board', () => {
  const make = (g, w) => Q.generateBoard({ guildId: g, kind: 'weekly', periodKey: w, weekKey: w, features: ALL });
  assert.deepEqual(make('1', '2026-W46'), make('1', '2026-W46'));
  const signatures = new Set();
  for (let w = 1; w <= 30; w++) {
    const key = `2027-W${String(w).padStart(2, '0')}`;
    const b = make('42', key);
    assert.equal(b.quests.length, 6);
    assert.equal(new Set(b.quests.map((q) => q.metric)).size, 6, 'no duplicate metric');
    for (const q of b.quests) {
      assert.ok(q.target >= 1 && Number.isInteger(q.target));
      assert.ok(q.coins > 0 && q.stars > 0);
    }
    signatures.add(b.quests.map((q) => `${q.templateId}:${q.target}`).join('|'));
  }
  assert.equal(signatures.size, 30, 'every week is different');
  assert.notDeepEqual(make('1', '2026-W46').quests, make('2', '2026-W46').quests, 'servers get different boards');
});

test('quests that cannot be completed are never offered', () => {
  for (let d = 1; d <= 40; d++) {
    const b = Q.generateBoard({ guildId: 'x', kind: 'daily', periodKey: `2026-12-${String(d % 28 + 1).padStart(2, '0')}-${d}`, weekKey: '2026-W50', features: { economy: false, leveling: false, trivia: true, giveaways: true } });
    for (const q of b.quests) {
      const t = TEMPLATES.find((x) => x.id === q.templateId);
      assert.ok(!['economy', 'leveling'].includes(t.requires), `${q.templateId} needs ${t.requires}`);
    }
  }
});

test('themes never repeat within three weeks', () => {
  for (const g of ['a', 'b', 'c', 'd']) {
    const ids = Array.from({ length: 40 }, (_, i) => Q.pickTheme(g, `2027-W${String(i + 1).padStart(2, '0')}`, ALL).id);
    for (let i = 2; i < ids.length; i++) {
      assert.notEqual(ids[i], ids[i - 1]);
      assert.notEqual(ids[i], ids[i - 2]);
    }
  }
});

test('embeds fit Discord limits on hundreds of generated boards', () => {
  const member = { id: 'u', displayName: 'A very long display name here', displayAvatarURL: () => null };
  const guild = { id: 'g', name: 'Guild', iconURL: () => null };
  for (let i = 0; i < 300; i++) {
    const keys = Q.periodKeys(new Date(Date.UTC(2027, 0, 1) + i * 86400000));
    const boards = {
      daily: Q.generateBoard({ guildId: `g${i}`, kind: 'daily', periodKey: keys.day, weekKey: keys.week, features: ALL }),
      weekly: Q.generateBoard({ guildId: `g${i}`, kind: 'weekly', periodKey: keys.week, weekKey: keys.week, features: ALL }),
    };
    const half = (b) => ({ period: 'p', progress: Object.fromEntries(b.quests.map((q) => [q.metric, Math.floor(q.target / 2)])), sets: {}, claimed: [], completedAt: {}, chestClaimed: false });
    const overview = {
      keys, boards, settings: { multiplier: 5 }, features: ALL, notice: { quests: 9, coins: 123456, stars: 40 },
      state: { daily: half(boards.daily), weekly: half(boards.weekly), season: { id: keys.season, stars: 150, tier: 12 } },
    };
    const json = buildQuestBoardEmbed({ member, guild, overview }).toJSON();
    const post = buildDailyPostEmbed({ guild, boards, keys, settings: { multiplier: 5 }, features: ALL, leaders: [] }).toJSON();
    for (const e of [json, post]) {
      for (const f of e.fields) {
        assert.ok(f.value.length < 1024, `field "${f.name}" is ${f.value.length} chars`);
        assert.ok(!f.value.endsWith('…'), 'nothing truncated');
      }
      const total = (e.title || '').length + (e.description || '').length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
      assert.ok(total < 6000);
    }
  }
});

async function enable(guildId) {
  await Q.updateQuestSettings(guildId, { enabled: true });
}

test('quests are OFF until set up: nothing is tracked', async () => {
  freshDb();
  Q.trackQuestEvent('off', 'u1', 'messages', 50);
  await Q.flushQuestProgress({ client });
  assert.equal(await db.get('quests:off:user:u1'), null);
});

test('track → flush → complete → claim pays once, with stars', async () => {
  freshDb();
  const G = 'gq';
  await enable(G);
  const board = await Q.getBoard(client, G, 'daily');
  const quest = board.quests[0];
  const isUnique = ['channels', 'activeDays', 'welcomes', 'payRecipients'].includes(quest.metric);
  if (isUnique) for (let i = 0; i < quest.target; i++) Q.trackQuestUnique(G, 'u1', quest.metric, `v${i}`);
  else Q.trackQuestEvent(G, 'u1', quest.metric, quest.target);
  const completions = await Q.flushQuestProgress({ client });
  assert.ok(completions.some((c) => c.quest.id === quest.id), 'completion detected');

  const before = (await economy.getUserBalance(G, 'u1')).coins || 0;
  const summary = await Q.claimQuestRewards(client, G, 'u1');
  assert.ok(summary.quests.some((q) => q.id === quest.id));
  assert.equal(summary.stars >= quest.stars, true);
  const after = (await economy.getUserBalance(G, 'u1')).coins || 0;
  assert.equal(after - before, summary.coins);
  const again = await Q.claimQuestRewards(client, G, 'u1');
  assert.equal(again.quests.length, 0, 'cannot claim twice');
});

test('a completed quest stays complete (withdrawing after a deposit quest)', async () => {
  const quest = { id: 'x', metric: 'deposited', target: 100 };
  const state = { progress: { deposited: 40 }, completedAt: { x: Date.now() } };
  assert.equal(Q.isComplete(state, quest), true);
});

test('unclaimed rewards from yesterday are paid automatically', async () => {
  freshDb();
  const G = 'roll';
  await enable(G);
  const day1 = new Date('2026-11-10T12:00:00Z');
  const day2 = new Date('2026-11-11T12:00:00Z');
  const board = await Q.getBoard(client, G, 'daily', day1);
  const quest = board.quests.find((q) => !['channels', 'activeDays', 'welcomes', 'payRecipients'].includes(q.metric)) || board.quests[0];
  // Write day-1 state directly (as a flush on day 1 would have).
  await db.set(`quests:${G}:user:u1`, {
    daily: { period: '2026-11-10', progress: { [quest.metric]: quest.target }, sets: {}, claimed: [], completedAt: { [quest.id]: day1.getTime() }, chestClaimed: false },
    weekly: { period: Q.periodKeys(day1).week, progress: {}, sets: {}, claimed: [], completedAt: {}, chestClaimed: false },
    season: { id: '2026-11', stars: 0, tier: 0, completed: 0 },
  });
  const overview = await Q.getQuestOverview(client, G, 'u1', day2);
  assert.ok(overview.notice, 'notice shown');
  assert.ok(overview.notice.stars >= quest.stars);
  assert.equal(overview.state.daily.period, '2026-11-11');
  assert.ok(overview.state.season.stars >= quest.stars);
});

test('message tracking ignores spam bursts and counts rich activity', async () => {
  freshDb();
  const msg = (content, extra = {}) => ({
    guild: { id: 'g' }, author: { id: 'u', bot: false }, content, channel: { id: 'c1' },
    attachments: new Map(), mentions: { members: new Map() }, ...extra,
  });
  const t0 = 1_800_000_000_000;
  trackMessageForQuests(msg('hello there friends'), t0);
  trackMessageForQuests(msg('spam spam spam spam'), t0 + 1000);   // inside cooldown
  trackMessageForQuests(msg('what are we doing tonight?'), t0 + 6000);
  trackMessageForQuests(msg('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), t0 + 12000);
  const entry = Q._pendingForTests().get('g:u');
  assert.equal(entry.inc.messages, 3);
  assert.equal(entry.inc.questions, 1);
  assert.equal(entry.inc.longMessages, undefined, 'a wall of one letter is not a long message');
});

test('bank deposits count net of withdrawals', async () => {
  freshDb();
  await economy.setUserBalance('gb', 'u', { coins: 1000 });
  await economy.depositCoins('gb', 'u', 500);
  await economy.withdrawCoins('gb', 'u', 500);
  await economy.depositCoins('gb', 'u', 500);
  assert.equal(Q._pendingForTests().get('gb:u').inc.deposited, 500);
});

test('tier math', () => {
  assert.equal(tierForStars(0), 0);
  assert.equal(tierForStars(STARS_PER_TIER - 1), 0);
  assert.equal(tierForStars(STARS_PER_TIER * 3), 3);
  assert.equal(tierForStars(99999), 20);
});

test('season close pays the podium exactly once', async () => {
  freshDb();
  const G = 'sz';
  await enable(G);
  await db.set(`quests:${G}:season:current`, '2026-11');
  await db.set(`quests:${G}:season:2026-11`, { stars: { a: 50, b: 80, c: 10, d: 5 }, completed: { a: 10, b: 15, c: 2, d: 1 } });
  const dec = new Date('2026-12-01T00:30:00Z');
  const r = await Q.finalizeSeasonIfNeeded(G, dec);
  assert.deepEqual(r.podium.map((p) => p.userId), ['b', 'a', 'c']);
  assert.equal((await economy.getUserBalance(G, 'b')).coins, 2500);
  assert.equal(await Q.finalizeSeasonIfNeeded(G, dec), null);
  assert.equal((await economy.getUserBalance(G, 'b')).coins, 2500, 'not paid twice');
});

test('the daily board is posted once per day (setup can force it)', async () => {
  freshDb();
  const sent = [];
  const channel = { isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(p); } };
  const guild = { id: 'gp', name: 'G', iconURL: () => null, members: { me: null }, channels: { cache: new Map([['ch', channel]]) } };
  const bot = { db, guilds: { cache: new Map([['gp', guild]]) } };
  await Q.updateQuestSettings('gp', { enabled: true, channelId: 'ch' });
  assert.equal(await postDailyBoard(bot, guild), true);
  assert.equal(await postDailyBoard(bot, guild), false);
  assert.equal(await postDailyBoard(bot, guild, { force: true }), true);
  assert.equal(sent.length, 2);
  assert.match(sent[0].embeds[0].toJSON().title, /Today's quests/);
  assert.equal(sent[0].components[0].components[0].toJSON().custom_id, 'quests:mine');
});

test('descriptions are grammatical for a target of 1', () => {
  assert.equal(Q.describe('Level up {n} times', 1), 'Level up 1 time');
  assert.equal(Q.describe('Complete {n} work shifts with /work', 1), 'Complete 1 work shift with /work');
  assert.equal(Q.describe('Answer {n} /question trivia correctly', 1), 'Answer 1 /question trivia correctly');
  assert.equal(Q.describe('Earn {n} coins', 2500), 'Earn 2,500 coins');
});

test('owner tool: complete-daily marks every daily quest done; Claim pays them + the chest', async () => {
  freshDb();
  const G = 'own';
  await enable(G);
  const { completed, board } = await Q.forceCompleteDaily(client, G, '1554657430393196594');
  assert.equal(completed, board.quests.length);
  const summary = await Q.claimQuestRewards(client, G, '1554657430393196594');
  assert.equal(summary.quests.filter((q) => q.kind === 'daily').length, board.quests.length);
  assert.ok(summary.chests.some((c) => c.kind === 'daily'), 'daily chest unlocked');
  const again = await Q.forceCompleteDaily(client, G, '1554657430393196594');
  assert.equal(again.completed, 0, 'nothing left to complete');
});

test('owner tool: /quests complete-daily refuses everyone else', async () => {
  freshDb();
  const cmd = (await import('../../src/commands/Quests/quests.js')).default;
  const replies = [];
  const interaction = {
    id: 'i1', createdTimestamp: Date.now(), user: { id: '999' }, guildId: 'own', guild: { id: 'own' },
    deferred: false, replied: false, isRepliable: () => true,
    options: { getSubcommandGroup: () => null, getSubcommand: () => 'complete-daily' },
    async deferReply() { this.deferred = true; },
    async editReply(p) { replies.push(p); }, async reply(p) { replies.push(p); }, async followUp(p) { replies.push(p); },
  };
  await cmd.execute(interaction, {}, client);
  const embed = replies.at(-1).embeds[0].toJSON();
  assert.match(embed.description, /reserved for the bot owner/);
  assert.equal(await db.get('quests:own:user:999'), null, 'nothing was changed');
});
