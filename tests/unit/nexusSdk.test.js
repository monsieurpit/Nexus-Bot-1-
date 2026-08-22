import test from 'node:test';
import assert from 'node:assert/strict';
import { NexusAI } from '../../nexus-ai.js';

test('NexusAI SDK constructor and default configurations', () => {
  const client = new NexusAI({ apiKey: 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194' });
  assert.equal(client.apiKey, 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194');
  assert.equal(client.getPersona(), 'nexus-homie');
  assert.ok(client.baseUrl.endsWith('/api/v1'));
  assert.ok(client.getClientRules().some(r => r.includes('MANDATORY_SWEARING_ISSUE')));
});

test('NexusAI persona and rules builder pattern', () => {
  const client = new NexusAI();
  client.clearRules();
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

test('NexusAI math solver and unit conversions', async () => {
  const client = new NexusAI();
  const res1 = await client.solveMath('sqrt(144) + 12');
  assert.equal(res1.isMath, true);
  assert.equal(res1.result, '24');

  const res2 = await client.solveMath('100 C to F');
  assert.equal(res2.isMath, true);
  assert.equal(res2.result, '212 °F');

  const res3 = await client.solveMath('10 km to miles');
  assert.equal(res3.isMath, true);
  assert.ok(res3.result.includes('miles'));
});

test('NexusAI RaidShield security classification', async () => {
  const client = new NexusAI();
  const safeRes = await client.checkSecurity({ messageText: 'Hello world how is everyone doing?' });
  assert.equal(safeRes.classification, 'safe');
  assert.equal(safeRes.actionRecommended, 'NONE');

  const phishingRes = await client.checkSecurity({ messageText: 'Free nitro gift claim now at http://steamcommunity-gift-nitro.xyz/claim' });
  assert.equal(phishingRes.classification, 'scam');
  assert.equal(phishingRes.actionRecommended, 'DELETE_AND_TIMEOUT');
});

test('NexusAI stateful chat session creation and history', () => {
  const client = new NexusAI();
  const session = client.createChatSession({ authorId: '123', username: 'TestUser', persona: 'nexus-homie' });
  assert.equal(session.authorId, '123');
  assert.equal(session.username, 'TestUser');
  assert.equal(session.persona, 'nexus-homie');
  assert.deepEqual(session.getHistory(), []);

  session.clearHistory();
  assert.deepEqual(session.getHistory(), []);
});

