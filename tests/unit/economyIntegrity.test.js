import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_CACHE_TTL_MS = '0';

const { db, DatabaseReadError, DatabaseWriteError } = await import('../../src/utils/database.js');
const { MemoryStorage } = await import('../../src/utils/memoryStorage.js');
const economy = await import('../../src/services/economy.js');

// A store whose reads/writes can be made to fail on demand, like Firestore during an outage.
function installStore() {
  const store = new MemoryStorage();
  const flags = { failReads: false, failWritesFor: null };
  const get = store.get.bind(store);
  const set = store.set.bind(store);
  store.get = async (key, def, opts) => {
    if (flags.failReads) {
      if (opts?.throwOnError) throw new Error('UNAVAILABLE');
      return def;
    }
    return get(key, def);
  };
  store.set = async (key, value, ttl) => {
    if (flags.failWritesFor && key.includes(flags.failWritesFor)) return false; // backend-style failure
    return set(key, value, ttl);
  };
  db.db = store;
  db.initialized = true;
  db.useFallback = false;
  db.cache.clear();
  return { store, flags };
}

const G = 'g1';

test('a failed balance read aborts /daily instead of overwriting the balance', async () => {
  const { flags } = installStore();
  await economy.setUserBalance(G, 'u1', { coins: 10000 });
  flags.failReads = true;
  await assert.rejects(() => economy.claimDaily(G, 'u1'), DatabaseReadError);
  flags.failReads = false;
  const bal = await economy.getUserBalance(G, 'u1');
  assert.equal(bal.coins, 10000);
});

test('db.get still reports a failed read as missing, getStrict throws', async () => {
  const { flags } = installStore();
  flags.failReads = true;
  assert.equal(await db.get('x', 'def'), 'def');
  await assert.rejects(() => db.getStrict('x'), DatabaseReadError);
});

test('a backend write returning false surfaces as DatabaseWriteError', async () => {
  const { flags } = installStore();
  flags.failWritesFor = 'boom';
  await assert.rejects(() => db.set('boom:key', 1), DatabaseWriteError);
});

test('transfer refunds the sender when crediting the receiver fails', async () => {
  const { flags } = installStore();
  await economy.setUserBalance(G, 'a', { coins: 500 });
  await economy.setUserBalance(G, 'b', { coins: 0 });
  flags.failWritesFor = ':user:b';
  await assert.rejects(() => economy.transferCoins(G, 'a', 'b', 200), DatabaseWriteError);
  flags.failWritesFor = null;
  assert.equal((await economy.getUserBalance(G, 'a')).coins, 500);
  assert.equal((await economy.getUserBalance(G, 'b')).coins, 0);
});

test('transfers and bank moves reject fractional or non-positive amounts', async () => {
  installStore();
  await economy.setUserBalance(G, 'a', { coins: 500 });
  assert.equal((await economy.transferCoins(G, 'a', 'b', 1.5)).reason, 'amount');
  assert.equal((await economy.transferCoins(G, 'a', 'b', 0)).reason, 'amount');
  assert.equal((await economy.depositCoins(G, 'a', 2.5)).reason, 'amount');
  assert.equal((await economy.withdrawCoins(G, 'a', NaN)).reason, 'amount');
});

test('buyPack refunds the coins when the inventory write fails', async () => {
  const { flags } = installStore();
  await economy.setUserBalance(G, 'p', { coins: 1000 });
  flags.failWritesFor = ':inventory:';
  await assert.rejects(() => economy.buyPack(G, 'p', 'starter'), DatabaseWriteError);
  flags.failWritesFor = null;
  assert.equal((await economy.getUserBalance(G, 'p')).coins, 1000);
});

test('saveEconomyConfig refuses to save when the current config cannot be read', async () => {
  const { flags } = installStore();
  await economy.saveEconomyConfig(G, { shopItems: [{ id: 'vip', price: 5 }] });
  flags.failReads = true;
  await assert.rejects(() => economy.saveEconomyConfig(G, { dailyAmount: 1 }));
  flags.failReads = false;
  const cfg = await economy.getEconomyConfig(G);
  assert.equal(cfg.shopItems.length, 1);
});

test('concurrent daily claims only pay once', async () => {
  installStore();
  const results = await Promise.all([economy.claimDaily(G, 'c'), economy.claimDaily(G, 'c'), economy.claimDaily(G, 'c')]);
  assert.equal(results.filter((r) => r.success).length, 1);
});

test('refundShopPurchase credits the price back', async () => {
  installStore();
  await economy.setUserBalance(G, 'r', { coins: 10 });
  await economy.refundShopPurchase(G, 'r', 90);
  assert.equal((await economy.getUserBalance(G, 'r')).coins, 100);
});

test('warnings: a failed read refuses to add instead of wiping the history', async () => {
  const { WarningService } = await import('../../src/services/warningService.js');
  const { flags } = installStore();
  await WarningService.addWarning({ guildId: G, userId: 'w', moderatorId: 'm', reason: 'one' });
  flags.failReads = true;
  const res = await WarningService.addWarning({ guildId: G, userId: 'w', moderatorId: 'm', reason: 'two' });
  flags.failReads = false;
  assert.equal(res.success, false);
  const stored = await db.get(`moderation:warnings:${G}:w`);
  assert.equal(stored.length, 1);
});

test('welcome config: update throws when the save fails instead of reporting success', async () => {
  const { updateWelcomeConfig, saveWelcomeConfig } = await import('../../src/utils/database.js');
  const { flags } = installStore();
  const client = { db };
  await saveWelcomeConfig(client, G, { welcomeMessage: 'hi' });
  flags.failWritesFor = 'welcome';
  await assert.rejects(() => updateWelcomeConfig(client, G, { welcomeMessage: 'changed' }));
});
