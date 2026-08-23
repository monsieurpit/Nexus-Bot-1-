import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askNexusAi,
  parseNexusTrigger,
  isNexusAiDisabled,
  setNexusAiDisabled
} from '../../src/services/nexusAiService.js';

test('parseNexusTrigger detects bot mention and prefixes', () => {
  const t1 = parseNexusTrigger('hey nexus what is 2+2');
  assert.equal(t1.matched, true);
  assert.equal(t1.question, 'what is 2+2');

  const t2 = parseNexusTrigger('<@123456789> hello world', '123456789');
  assert.equal(t2.matched, true);
  assert.equal(t2.question, 'world');

  const t3 = parseNexusTrigger('just regular chat message');
  assert.equal(t3, null);
});

test('askNexusAi short-circuits Casseurt roast triggers without calling the API', async () => {
  const casseurtResp = await askNexusAi('do you like casseurt', { userId: '1394001641899954368' });
  assert.ok(/fuck no/i.test(casseurtResp));

  const casseurtResp2 = await askNexusAi('what do you think about casseurt', { userId: '111' });
  assert.ok(/fuck no/i.test(casseurtResp2));
});

test('setNexusAiDisabled and isNexusAiDisabled manage toggle states', async () => {
  const dummyGuild = 'guild_test_toggle_123';
  await setNexusAiDisabled(dummyGuild, null, true);
  assert.equal(await isNexusAiDisabled(dummyGuild, null), true);

  await setNexusAiDisabled(dummyGuild, null, false);
  assert.equal(await isNexusAiDisabled(dummyGuild, null), false);
});
