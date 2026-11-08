import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackup, validateBackup, encodeValue, decodeValue, stableStringify,
} from '../../scripts/lib/firestoreBackupFormat.js';

const sample = () => ({
  kv_data: [{ id: 'economy:1:user:2', data: { key: 'economy:1:user:2', value: { coins: 5 } } }],
  'guilds/1/user_levels': [{ id: '2', data: { xp: 10 } }],
});

test('a fresh backup validates', () => {
  const b = buildBackup({ projectId: 'p', databaseId: 'd', collections: sample() });
  assert.equal(b.totalDocuments, 2);
  assert.equal(validateBackup(b, { projectId: 'p', databaseId: 'd' }), true);
});

test('a modified or truncated backup is refused', () => {
  const b = buildBackup({ projectId: 'p', databaseId: 'd', collections: sample() });
  b.collections.kv_data[0].data.value.coins = 999999;
  assert.throws(() => validateBackup(b), /Checksum mismatch/);
  const c = buildBackup({ projectId: 'p', databaseId: 'd', collections: sample() });
  c.collections.kv_data.pop();
  assert.throws(() => validateBackup(c), /Checksum mismatch/);
});

test('backups from another project, unknown versions or bad paths are refused', () => {
  const b = buildBackup({ projectId: 'p', databaseId: 'd', collections: sample() });
  assert.throws(() => validateBackup(b, { projectId: 'other' }), /project/);
  assert.throws(() => validateBackup({ ...b, version: 99 }), /version/);
  const bad = buildBackup({ projectId: 'p', databaseId: 'd', collections: { 'guilds/1': [{ id: 'x', data: {} }] } });
  assert.throws(() => validateBackup(bad), /Invalid collection path/);
});

test('timestamps round-trip and checksums ignore key order', () => {
  class FakeTs { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
  const enc = encodeValue({ at: new FakeTs(5, 6), list: [new FakeTs(1, 2)] }, (v) => v instanceof FakeTs);
  assert.deepEqual(enc.at, { __nexusType: 'timestamp', seconds: 5, nanoseconds: 6 });
  const dec = decodeValue(enc, (s, n) => new FakeTs(s, n));
  assert.ok(dec.at instanceof FakeTs && dec.list[0] instanceof FakeTs);
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
});
