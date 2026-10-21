import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_API_URL = 'http://127.0.0.1:9/api/v1';
const { humanParts } = await import('../../src/services/nexusAiService.js');

test('humanParts sends the engine parts only when they are the whole answer', () => {
  assert.deepEqual(humanParts(['nah mate', 'ur absolutely cooked lol'], 'nah mate, ur absolutely cooked lol'), ['nah mate', 'ur absolutely cooked lol']);
  // a part missing words → never drop text, send it as one message
  assert.equal(humanParts(['nah mate', 'ur cooked'], 'nah mate, ur absolutely cooked lol'), null);
  // one part, not an emoji → normal sending
  assert.equal(humanParts(['nah mate ur cooked'], 'nah mate ur cooked'), null);
  // an emoji back for "lol" is a whole answer
  assert.deepEqual(humanParts(['💀'], 'galah fr lmao'), ['💀']);
  // too many parts, empty parts, or nothing at all → normal sending
  assert.equal(humanParts(['a', 'b', 'c', 'd'], 'abcd'), null);
  assert.equal(humanParts(['hi', ''], 'hi'), null);
  assert.equal(humanParts(undefined, 'hi'), null);
  // @everyone inside a part is defused like the rest of the reply
  assert.ok(!/(^|[^​])@everyone/.test(humanParts(['ok', '@everyone go eat shit'], 'ok @everyone go eat shit')?.[1] ?? '@everyone'));
});

test('analyzeThreat refuses to run without the RaidShield key (callers fall back to checkSecurity)', async () => {
  const { NexusAI } = await import('../../nexus-ai.js');
  const prev = process.env.NEXUS_RAIDSHIELD_KEY;
  delete process.env.NEXUS_RAIDSHIELD_KEY;
  const c = new NexusAI({ baseUrl: 'http://127.0.0.1:9/api/v1' });
  await assert.rejects(() => c.analyzeThreat({ messageText: 'hi' }), /RaidShield key not configured/);
  if (prev !== undefined) process.env.NEXUS_RAIDSHIELD_KEY = prev;
});

test('humanParts lets a slip + its "*fix" through (typo / name slip), nothing that changes the answer', () => {
  assert.deepEqual(humanParts(['nah bro Olmi was cooking tonight', '*Olmo'], 'nah bro Olmo was cooking tonight'), ['nah bro Olmi was cooking tonight', '*Olmo']);
  assert.deepEqual(humanParts(['that was seriosuly good', '*seriously'], 'that was seriously good'), ['that was seriosuly good', '*seriously']);
  assert.equal(humanParts(['that was', '*bad'], 'that was seriously good'), null);
  assert.equal(humanParts(['that was terrible', '*good'], 'that was terrific'), null);
  assert.deepEqual(humanParts(['lmao u actually did that', '💀'], 'lmao u actually did that'), ['lmao u actually did that', '💀']);
});
