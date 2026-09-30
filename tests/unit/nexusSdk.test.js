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

  // Plain reassignment instead of node:test's t.mock.method — that API throws
  // NotImplementedError under Bun (see https://github.com/oven-sh/bun/issues/5090), and this
  // machine only has Bun installed (no `node` binary at all), so every test in this file using
  // t.mock.method silently failed here regardless of what the actual client code did. A direct
  // `global.fetch = fn` achieves the identical stubbing effect and is valid under real
  // `node --test` too, so this stays runnable under either runtime.
  global.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ response: 'hi there' }) };
  };

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

  global.fetch = async () => ({ ok: true, json: async () => ({ text: 'sup bro' }) });
  assert.equal(await client.ask('yo'), 'sup bro');

  global.fetch = async () => ({ ok: false, status: 500, statusText: 'Server Error', text: async () => '' });
  await assert.rejects(() => client.ask('yo'), /Nexus API HTTP 500/);
});

test('NexusAI checkSecurity forwards the RaidShield response and throws on failure', async (t) => {
  const client = new NexusAI();

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ classification: 'safe', confidence: 0.95, reason: 'looks fine' })
  });
  const safeRes = await client.checkSecurity({ messageText: 'Hello world' });
  assert.equal(safeRes.classification, 'safe');
  assert.equal(await client.isSafe('Hello world'), true);

  global.fetch = async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => '' });
  await assert.rejects(() => client.checkSecurity({ messageText: 'test' }), /RaidShield API HTTP 503/);
});

test('NexusAI stateful chat session creation and history', async (t) => {
  const client = new NexusAI();
  const session = client.createChatSession({ authorId: '123', username: 'TestUser', persona: 'nexus-homie' });
  assert.ok(session instanceof NexusChatSession);
  assert.equal(session.authorId, '123');
  assert.equal(session.username, 'TestUser');
  assert.equal(session.persona, 'nexus-homie');
  assert.deepEqual(session.getHistory(), []);

  global.fetch = async () => ({ ok: true, json: async () => ({ response: 'yo' }) });
  await session.sendMessage('hey nexus');
  assert.equal(session.getHistory().length, 2);

  session.clearHistory();
  assert.deepEqual(session.getHistory(), []);
});

test('NexusAI retries and recovers from transient HTTP 502 error', async (t) => {
  const client = new NexusAI();
  let callCount = 0;

  global.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => JSON.stringify({ status: 'error', code: 502, message: 'Application failed to respond' }),
      };
    }
    return {
      ok: true,
      json: async () => ({ response: 'recovered after retry!' }),
    };
  };

  const res = await client.askJSON({ prompt: 'test 502 recovery' });
  assert.equal(callCount, 2);
  assert.equal(res.response, 'recovered after retry!');
});

test('NexusAI never re-sends a POST after a gateway timeout (504/524) or rate limit (429)', async (t) => {
  // A 504/524 means the engine may still be working on the request — a retry would queue a second
  // copy of the same answer behind it.
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const client = new NexusAI({ apiKey: 'k', baseUrl: 'http://example.test/api/v1' });
  for (const status of [504, 524, 429, 500]) {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: false, status, statusText: 'x', text: async () => '' };
    };
    await assert.rejects(() => client.ask('yo'), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1, `POST retried after HTTP ${status}`);
  }
});

test('NexusAI still retries a POST when the request never reached the engine (502/503)', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const client = new NexusAI({ apiKey: 'k', baseUrl: 'http://example.test/api/v1' });
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503, statusText: 'x', text: async () => '' };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ response: 'ok' }) };
  };
  const res = await client.askJSON({ prompt: 'yo' });
  assert.equal(res.response, 'ok');
  assert.equal(calls, 2);
});
