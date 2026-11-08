import test from 'node:test';
import assert from 'node:assert/strict';

// Nothing listens on port 1: every RaidShield engine call fails like an engine outage.
process.env.NEXUS_API_URL = 'http://127.0.0.1:1/api/v1';
delete process.env.NEXUS_RAIDSHIELD_KEY;

const { db } = await import('../../src/utils/database.js');
const { MemoryStorage } = await import('../../src/utils/memoryStorage.js');
const { AiModerationService, getRaidShieldEngineStatus, _resetEngineStatusForTests } =
  await import('../../src/services/aiModerationService.js');

function fakeMessage({ sent, deleted, timeouts }) {
  const member = {
    id: 'u1',
    permissions: { has: () => false },
    roles: { cache: new Map() },
    moderatable: true,
    kickable: true,
    bannable: true,
    timeout: async () => { timeouts.push(1); },
  };
  const alertChannel = { isTextBased: () => true, send: async (payload) => { sent.push(payload); } };
  return {
    id: 'm1',
    content: 'free nitro claim here https://discord-gift.ru/claim now',
    author: { id: 'u1', bot: false, username: 'u1', createdTimestamp: Date.now() - 86400000 },
    member,
    webhookId: null,
    attachments: new Map(),
    client: { user: { id: 'bot' } },
    mentions: {},
    channel: { id: 'c1', name: 'general' },
    deletable: true,
    delete: async () => { deleted.push(1); },
    guild: {
      id: 'g-raid',
      ownerId: 'owner',
      members: { fetch: async () => member },
      channels: { cache: new Map([['alerts', alertChannel]]) },
    },
  };
}

test('an unreachable engine never yields a "safe" verdict, takes no action, and tells staff', async () => {
  const store = new MemoryStorage();
  db.db = store;
  db.initialized = true;
  db.useFallback = false;
  db.cache.clear();
  const client = { db };
  await db.set('guild:g-raid:config', {
    raidShield: { enabled: true, aiModeration: { enabled: true, alertChannelId: 'alerts' } },
  });
  _resetEngineStatusForTests();

  const sent = [];
  const deleted = [];
  const timeouts = [];
  await AiModerationService.processMessage(fakeMessage({ sent, deleted, timeouts }), client);

  assert.equal(deleted.length, 0, 'an unscanned message must not be deleted');
  assert.equal(timeouts.length, 0, 'an unscanned member must not be punished');
  assert.equal(sent.length, 1, 'staff get one "scanning unavailable" notice');
  assert.match(sent[0].embeds[0].data.title, /unavailable/i);

  const status = getRaidShieldEngineStatus();
  assert.equal(status.state, 'unavailable');
  assert.ok(status.consecutiveFailures >= 1);

  // A second message within the notice interval does not spam the channel.
  await AiModerationService.processMessage(fakeMessage({ sent, deleted, timeouts }), client);
  assert.equal(sent.length, 1);
});

test('local scam filter: duplicates and everyday words no longer reach the threshold', async () => {
  const { detectScamMessage } = await import('../../src/services/scamDetectionService.js');
  const msg = (content) => ({ content, attachments: new Map() });
  assert.equal(detectScamMessage(msg('honestly, use my promo code at the store, bonus code inside')).isScam, false);
  assert.equal(detectScamMessage(msg('what is at stake here honestly')).isScam, false);
  assert.equal(detectScamMessage(msg('guaranteed profit! double your sol, just enter your seed phrase')).isScam, true);
});

test('cross-channel spam: established one-time posters are not suspects, raiders are', async () => {
  const { isCrossChannelSuspect } = await import('../../src/services/raidDetectionService.js');
  const now = Date.now();
  const day = 86400000;
  const entries = [
    { userId: 'old', channelId: 'a' },
    { userId: 'new', channelId: 'b' },
    { userId: 'spammer', channelId: 'a' },
    { userId: 'spammer', channelId: 'c' },
  ];
  const veteran = (id) => ({ id, joinedTimestamp: now - 400 * day, user: { createdTimestamp: now - 900 * day } });
  assert.equal(isCrossChannelSuspect(veteran('old'), entries, now), false);
  assert.equal(isCrossChannelSuspect(veteran('spammer'), entries, now), true);
  assert.equal(isCrossChannelSuspect({ id: 'new', joinedTimestamp: now - 1000, user: { createdTimestamp: now - 2 * day } }, entries, now), true);
});

test('server snapshot validation refuses incomplete saves before anything is touched', async () => {
  const { validateSnapshot } = await import('../../src/services/serverBackupService.js');
  assert.equal(validateSnapshot(null).ok, false);
  assert.equal(validateSnapshot({ roles: [] }).ok, false);
  assert.equal(validateSnapshot({ categories: [{ id: '1', name: 'x', channels: [{}] }] }).ok, false);
  const good = validateSnapshot({
    roles: [{ name: 'Mod', permissions: '8' }],
    categories: [{ id: null, channels: [{ name: 'general' }] }, { id: '2', name: 'Info', channels: [{ name: 'rules' }] }],
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.summary, { roles: 1, categories: 1, channels: 2, hasSettings: false });
});
