import test from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseWrapper } from '../../src/utils/database.js';
import { MemoryStorage } from '../../src/utils/memoryStorage.js';

function makeWrapper() {
  const wrapper = new DatabaseWrapper();
  const store = new MemoryStorage();
  let reads = 0;
  const originalGet = store.get.bind(store);
  store.get = async (...args) => {
    reads++;
    return originalGet(...args);
  };
  wrapper.db = store;
  wrapper.initialized = true;
  return { wrapper, store, reads: () => reads };
}

test('cached reads hit the backend only once', async () => {
  const { wrapper, reads } = makeWrapper();
  await wrapper.set('k', { a: 1 });
  assert.deepEqual(await wrapper.get('k'), { a: 1 });
  assert.deepEqual(await wrapper.get('k'), { a: 1 });
  assert.equal(reads(), 1);
});

test('missing keys are cached and still return the caller default', async () => {
  const { wrapper, reads } = makeWrapper();
  assert.equal(await wrapper.get('nope', 'fallback'), 'fallback');
  assert.deepEqual(await wrapper.get('nope', {}), {});
  assert.equal(await wrapper.get('nope'), null);
  assert.equal(reads(), 1);
});

test('writes and deletes invalidate the cache', async () => {
  const { wrapper } = makeWrapper();
  await wrapper.set('k', 1);
  assert.equal(await wrapper.get('k'), 1);
  await wrapper.set('k', 2);
  assert.equal(await wrapper.get('k'), 2);
  await wrapper.delete('k');
  assert.equal(await wrapper.get('k'), null);
});

test('mutating a returned object does not corrupt the cache', async () => {
  const { wrapper } = makeWrapper();
  await wrapper.set('k', { list: [1] });
  const first = await wrapper.get('k');
  first.list.push(2);
  assert.deepEqual(await wrapper.get('k'), { list: [1] });
});

test('keys written with a TTL are never cached', async () => {
  const { wrapper, reads } = makeWrapper();
  await wrapper.set('ttl-key', 'v', 60);
  await wrapper.get('ttl-key');
  await wrapper.get('ttl-key');
  assert.equal(reads(), 2);
});

test('invalidateCache supports prefixes', async () => {
  const { wrapper, store, reads } = makeWrapper();
  await wrapper.set('guild:1:ticket:a', 1);
  await wrapper.get('guild:1:ticket:a');
  await store.set('guild:1:ticket:a', 5); // raw write that bypasses the wrapper
  wrapper.invalidateCache('guild:1:ticket*');
  assert.equal(await wrapper.get('guild:1:ticket:a'), 5);
  assert.equal(reads(), 2);
});

test('a failed backend read is not cached as "missing"', async () => {
  const { wrapper, store } = makeWrapper();
  await store.set('k', 'real');
  let fail = true;
  const realGet = store.get.bind(store);
  store.get = async (key, def, opts) => {
    if (fail) {
      if (opts?.throwOnError) throw new Error('network blip');
      return def;
    }
    return realGet(key, def);
  };
  assert.equal(await wrapper.get('k', 'default'), 'default');
  fail = false;
  assert.equal(await wrapper.get('k', 'default'), 'real');
});
