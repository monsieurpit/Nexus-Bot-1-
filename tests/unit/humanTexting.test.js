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
