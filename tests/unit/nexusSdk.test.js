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
