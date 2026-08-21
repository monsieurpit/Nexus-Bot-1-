import test from 'node:test';
import assert from 'node:assert/strict';
import { NexusAI } from '../../nexus-ai.js';

test('NexusAI SDK constructor and default configurations', () => {
  const client = new NexusAI({ apiKey: 'nexus_sk_discord_bot_26jhs6ku' });
  assert.equal(client.apiKey, 'nexus_sk_discord_bot_26jhs6ku');
  assert.equal(client.getPersona(), 'nexus-homie');
  assert.ok(client.baseUrl.endsWith('/api/v1'));
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
  const client = new NexusAI({ apiKey: 'nexus_sk_discord_bot_26jhs6ku' });
  const headers = client._getHeaders({ 'Custom-Header': 'test' });
  assert.equal(headers['Authorization'], 'Bearer nexus_sk_discord_bot_26jhs6ku');
  assert.equal(headers['x-api-key'], 'nexus_sk_discord_bot_26jhs6ku');
  assert.equal(headers['Custom-Header'], 'test');
});
