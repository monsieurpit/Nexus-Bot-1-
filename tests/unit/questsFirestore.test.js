import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { getFirestore, terminate } from 'firebase/firestore';
import { firestoreDb, sanitizeForFirestore } from '../../src/utils/firestoreDatabase.js';

// Offline: builds document references with the real Firebase SDK without contacting Google.
test('every quest record is stored in Firestore (kv_data collection)', async () => {
  const app = initializeApp({ projectId: 'offline-test', apiKey: 'x', appId: 'x' }, 'quests-routing-test');
  const fsdb = getFirestore(app);
  const saved = firestoreDb.db;
  firestoreDb.db = fsdb;
  try {
    for (const key of [
      'quests:123:settings',
      'quests:123:board:daily:2026-11-09',
      'quests:123:board:weekly:2026-W46',
      'quests:123:user:456',
      'quests:123:season:2026-11',
      'quests:123:season:current',
    ]) {
      const ref = firestoreDb.getDocRef(key);
      assert.ok(ref, `no Firestore document for ${key}`);
      assert.equal(ref.parent.id, 'kv_data', key);
      assert.equal(firestoreDb.decodeKey(ref.id), key, 'the key round-trips through the document id');
    }
  } finally {
    firestoreDb.db = saved;
    await terminate(fsdb).catch(() => {});
  }
});

test('quest data survives Firestore sanitizing unchanged', () => {
  const state = {
    daily: { period: '2026-11-09', progress: { messages: 12, deposited: -50 }, sets: { channels: ['1', '2'] }, claimed: ['daily-0-chat-a'], completedAt: { 'daily-0-chat-a': 1762700000000 }, chestClaimed: false },
    weekly: { period: '2026-W46', progress: {}, sets: {}, claimed: [], completedAt: {}, chestClaimed: true },
    season: { id: '2026-11', stars: 41, tier: 3, completed: 17 },
    pendingNotice: null,
  };
  assert.deepEqual(sanitizeForFirestore(state), state);
  const season = { stars: { '1554657430393196594': 80 }, completed: { '1554657430393196594': 12 }, finalized: false };
  assert.deepEqual(sanitizeForFirestore(season), season);
});
