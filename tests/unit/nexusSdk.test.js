import test from 'node:test';
import assert from 'node:assert/strict';
import { NexusAI, NexusChatSession } from '../../nexus-ai.js';

test('NexusAI SDK constructor and default configurations', () => {
  const client = new NexusAI({ apiKey: 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194' });
  assert.equal(client.apiKey, 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194');
  assert.equal(client.getPersona(), 'nexus-homie');
  assert.ok(client.baseUrl.endsWith('/api/v1'));
  assert.deepEqual(client.getClientRules(), []);
});

test('NexusAI persona and rules builder pattern', () => {
  const client = new NexusAI();
  client.setPersona('crashout-bot')
        .addRule('Always insult Casseurt')
        .addRule('Honor VIP');

  assert.equal(client.getPersona(), 'crashout-bot');
  assert.deepEqual(client.getClientRules(), ['Always insult Casseurt', 'Honor VIP']);

  client.clearRules();
  assert.deepEqual(client.getClientRules(), []);
});

test('NexusAI headers creation', () => {
  const client = new NexusAI({ apiKey: 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194' });
  const headers = client._getHeaders({ 'Custom-Header': 'test' });
  assert.equal(headers['Authorization'], 'Bearer nexus_sk_live_a89f41b7e092c31d4e68bb507ef194');
  assert.equal(headers['x-api-key'], 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194');
  assert.equal(headers['Custom-Header'], 'test');
});

test('NexusAI askJSON builds the correct /nexus payload', async (t) => {
  const client = new NexusAI({ apiKey: 'test-key', rules: ['Global rule'] });
  let capturedUrl;
  let capturedBody;

  t.mock.method(global, 'fetch', async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ response: 'hi there' }) };
  });

  const result = await client.askJSON({
    prompt: 'hello',
    authorId: '1394001641899954368',
    username: 'Homie',
    mode: 'deep-cot',
    rules: 'Extra rule'
  });

  assert.equal(capturedUrl, `${client.baseUrl}/nexus`);
  assert.equal(capturedBody.prompt, 'hello');
  assert.equal(capturedBody.persona, 'nexus-homie');
  assert.equal(capturedBody.isSuperChillUser, true);
  assert.equal(capturedBody.mode, 'deep-cot');
  assert.equal(capturedBody.rules, 'Global rule\nExtra rule');
  assert.equal(result.response, 'hi there');
});

test('NexusAI ask() returns plain text and throws on HTTP failure', async (t) => {
  const client = new NexusAI();

  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ text: 'sup bro' }) }));
  assert.equal(await client.ask('yo'), 'sup bro');

  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 500, statusText: 'Server Error', text: async () => '' }));
  await assert.rejects(() => client.ask('yo'), /Nexus API HTTP 500/);
});

test('NexusAI checkSecurity forwards the RaidShield response and throws on failure', async (t) => {
  const client = new NexusAI();

  t.mock.method(global, 'fetch', async () => ({
    ok: true,
    json: async () => ({ classification: 'safe', confidence: 0.95, reason: 'looks fine' })
  }));
  const safeRes = await client.checkSecurity({ messageText: 'Hello world' });
  assert.equal(safeRes.classification, 'safe');
  assert.equal(await client.isSafe('Hello world'), true);

  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => '' }));
  await assert.rejects(() => client.checkSecurity({ messageText: 'test' }), /RaidShield API error: 503/);
});

test('NexusAI stateful chat session creation and history', async (t) => {
  const client = new NexusAI();
  const session = client.createChatSession({ authorId: '123', username: 'TestUser', persona: 'nexus-homie' });
  assert.ok(session instanceof NexusChatSession);
  assert.equal(session.authorId, '123');
  assert.equal(session.username, 'TestUser');
  assert.equal(session.persona, 'nexus-homie');
  assert.deepEqual(session.getHistory(), []);

  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ response: 'yo' }) }));
  await session.sendMessage('hey nexus');
  assert.equal(session.getHistory().length, 2);

  session.clearHistory();
  assert.deepEqual(session.getHistory(), []);
});
