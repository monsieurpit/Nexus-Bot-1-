import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';

process.env.DB_CACHE_TTL_MS = '0';
const { db } = await import('../../src/utils/database.js');
const { MemoryStorage } = await import('../../src/utils/memoryStorage.js');
const { sweepOrphanedTemporaryChannels } = await import('../../src/services/joinToCreateService.js');

test('startup sweep deletes empty registered temp channels and forgets missing ones only', async () => {
  db.db = new MemoryStorage();
  db.initialized = true;
  db.useFallback = false;
  const client = { db };
  const deleted = [];
  const vc = (id, members) => ({ id, type: ChannelType.GuildVoice, members: { size: members }, deletable: true, delete: async () => deleted.push(id) });
  const channels = new Map([['empty', vc('empty', 0)], ['busy', vc('busy', 2)], ['unregistered', vc('unregistered', 0)]]);
  const guild = { id: 'g', channels: { cache: channels, fetch: async () => null } };
  client.guilds = { cache: new Map([['g', guild]]) };

  const { getJoinToCreateConfigKey } = await import('../../src/utils/database.js');
  await db.set(getJoinToCreateConfigKey('g'), {
    triggerChannels: ['trigger'],
    temporaryChannels: { empty: { ownerId: 'a' }, busy: { ownerId: 'b' }, gone: { ownerId: 'c' } },
  });

  const summary = await sweepOrphanedTemporaryChannels(client);
  assert.deepEqual(summary, { deleted: 1, forgotten: 1, errors: 0 });
  assert.deepEqual(deleted, ['empty']);
  const after = await db.get(getJoinToCreateConfigKey('g'));
  assert.deepEqual(Object.keys(after.temporaryChannels), ['busy']);
  assert.deepEqual(after.triggerChannels, ['trigger'], 'trigger channels are untouched');
});
