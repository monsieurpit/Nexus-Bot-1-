import test from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseWrapper } from '../../src/utils/database.js';
import { MemoryStorage } from '../../src/utils/memoryStorage.js';
import { getGiveawayEndMs, isGiveawayEnded, saveGiveaway, getGuildGiveaways } from '../../src/utils/giveaways.js';
import { checkGiveaways, createGiveawayEmbed } from '../../src/services/giveawayService.js';

function makeClient() {
  const db = new DatabaseWrapper();
  db.db = new MemoryStorage();
  db.initialized = true;
  db.connectionType = 'memory';
  const sent = [];
  const edits = [];
  const message = { edit: async (payload) => { edits.push(payload); return message; } };
  const channel = {
    id: 'c1',
    messages: { fetch: async () => message },
    send: async (payload) => { sent.push(payload); return { id: 'ping1' }; },
  };
  const guild = { id: 'g1', channels: { fetch: async () => channel } };
  const client = {
    db,
    guilds: { cache: new Map([['g1', guild]]), fetch: async () => guild },
  };
  return { client, sent, edits };
}

test('ISO end times are parsed (no more NaN / never-ending giveaways)', () => {
  const past = { endsAt: new Date(Date.now() - 1000).toISOString() };
  const future = { endsAt: new Date(Date.now() + 60000).toISOString() };
  assert.ok(Number.isFinite(getGiveawayEndMs(past)));
  assert.equal(isGiveawayEnded(past), true);
  assert.equal(isGiveawayEnded(future), false);
  assert.equal(isGiveawayEnded({ endTime: Date.now() - 5 }), true);
});

test('embed shows a real timestamp for ISO end times', () => {
  const embed = createGiveawayEmbed({
    prize: 'Nitro', hostId: '1', winnerCount: 1, participants: [],
    endsAt: new Date(Date.now() + 60000).toISOString(),
  }, 'active').toJSON();
  assert.match(embed.description, /<t:\d+:R>/);
  assert.doesNotMatch(embed.description, /NaN/);
});

test('checkGiveaways ends due giveaways on key-value backends and picks winners', async () => {
  const { client, sent, edits } = makeClient();
  await saveGiveaway(client, 'g1', {
    messageId: 'm1', channelId: 'c1', hostId: 'h1', prize: 'Nitro', winnerCount: 1,
    participants: ['u1', 'u2'], ended: false, endsAt: new Date(Date.now() - 1000).toISOString(),
  });
  await saveGiveaway(client, 'g1', {
    messageId: 'm2', channelId: 'c1', hostId: 'h1', prize: 'Later', winnerCount: 1,
    participants: ['u3'], ended: false, endsAt: new Date(Date.now() + 3600000).toISOString(),
  });

  await checkGiveaways(client);

  const giveaways = await getGuildGiveaways(client, 'g1');
  const ended = giveaways.find(g => g.messageId === 'm1');
  const running = giveaways.find(g => g.messageId === 'm2');
  assert.equal(ended.ended, true);
  assert.equal(ended.winnerIds.length, 1);
  assert.ok(['u1', 'u2'].includes(ended.winnerIds[0]));
  assert.equal(running.ended, false);
  assert.equal(edits.length, 1);
  assert.equal(sent.length, 1);

  // Running again must not re-announce an already-ended giveaway.
  await checkGiveaways(client);
  assert.equal(sent.length, 1);
});

test('concurrent saves of different giveaways in one guild keep both', async () => {
  const { client } = makeClient();
  await Promise.all([
    saveGiveaway(client, 'g1', { messageId: 'a', participants: ['x'] }),
    saveGiveaway(client, 'g1', { messageId: 'b', participants: ['y'] }),
  ]);
  const ids = (await getGuildGiveaways(client, 'g1')).map(g => g.messageId).sort();
  assert.deepEqual(ids, ['a', 'b']);
});
