import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder } from 'discord.js';

process.env.DB_CACHE_TTL_MS = '0';
const { db } = await import('../../src/utils/database.js');
const { MemoryStorage } = await import('../../src/utils/memoryStorage.js');
const { refreshGuildEmbeds, runEmbedRefresh, EMBED_STYLE_VERSION } = await import('../../src/services/embedRefreshService.js');

const BOT = 'bot';
function collection(entries) {
  const m = new Map(entries);
  m.find = (fn) => [...m.values()].find(fn);
  m.filter = (fn) => { const r = collection([...m].filter(([, v]) => fn(v))); return r; };
  m.last = () => [...m.values()].at(-1);
  return m;
}
function makeGuild() {
  const edits = [];
  const sent = [];
  const panel = {
    id: 'm-panel', author: { id: BOT },
    components: [{ components: [{ customId: 'create_ticket' }] }],
    embeds: [new EmbedBuilder().setTitle('🎫 Support Tickets').setColor(0x3498db)],
    edit: async (p) => { edits.push(['ticket', p]); },
  };
  const ticketChannel = {
    id: 'c-panel', toString: () => '#tickets',
    messages: { fetch: async (arg) => (typeof arg === 'string' ? (arg === 'm-panel' ? panel : null) : collection([['m-panel', panel]])) },
  };
  panel.channel = ticketChannel;
  const verifyChannel = { id: 'c-verify', toString: () => '#verify', messages: { fetch: async () => null } };
  const logChannel = { id: 'c-log', isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(p); } };
  const channels = new Map([['c-panel', ticketChannel], ['c-verify', verifyChannel], ['c-log', logChannel]]);
  const guild = {
    id: 'g-ref', name: 'Test', iconURL: () => null,
    members: { me: null },
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null },
    fetchOwner: async () => null,
  };
  return { guild, edits, sent };
}

test('embed refresh restyles the ticket panel and lists what it could not fix', async () => {
  db.db = new MemoryStorage(); db.initialized = true; db.useFallback = false; db.cache.clear();
  const { guild, edits, sent } = makeGuild();
  const client = { db, user: { id: BOT }, guilds: { cache: new Map([[guild.id, guild]]) } };
  await db.set('guild:g-ref:config', {
    ticketPanelChannelId: 'c-panel', ticketPanelMessage: 'Ask us anything', ticketButtonLabel: 'Open',
    verification: { enabled: true, channelId: 'c-verify', messageId: 'gone', message: 'hi', buttonText: 'Go' },
    logging: { enabled: true, channelId: 'c-log' },
  });

  const report = await refreshGuildEmbeds(client, guild);
  assert.equal(report.updated, 1);
  assert.equal(edits[0][0], 'ticket');
  assert.equal(edits[0][1].embeds[0].toJSON().title, '🎫 Need a hand?');
  assert.match(edits[0][1].embeds[0].toJSON().description, /Ask us anything/);
  assert.equal(report.todo.length, 1);
  assert.match(report.todo[0].what, /Verification/);
  assert.equal(sent.length, 1, 'one staff notice');
  assert.match(sent[0].embeds[0].toJSON().description, /verification setup/);
  const cfg = await db.get('guild:g-ref:config');
  assert.equal(cfg.ticketPanelMessageId, 'm-panel', 'panel message id remembered');
});

test('the refresh runs once per style version', async () => {
  db.db = new MemoryStorage(); db.initialized = true; db.useFallback = false; db.connectionType = 'firestore'; db.cache.clear();
  const { guild, edits } = makeGuild();
  const client = { db, user: { id: BOT }, guilds: { cache: new Map([[guild.id, guild]]) } };
  await db.set('guild:g-ref:config', { ticketPanelChannelId: 'c-panel' });
  await runEmbedRefresh(client);
  await runEmbedRefresh(client);
  assert.equal(edits.length, 1);
  assert.equal(await db.get('nexus:embedstyle:g-ref'), EMBED_STYLE_VERSION);
});
