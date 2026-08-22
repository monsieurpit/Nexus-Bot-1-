import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askNexusAi,
  parseNexusTrigger,
  evaluateRaidShieldDirect,
  isNexusAiDisabled,
  setNexusAiDisabled,
  resolveImagePart,
  analyzeVision,
  getCasseurtCrashoutRant
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

test('evaluateRaidShieldDirect classifies phishing, scams, and safe content', () => {
  const phishing = evaluateRaidShieldDirect('Free discord nitro! https://fake-discord-gift.com/claim');
  assert.equal(phishing.classification, 'scam');

  const safe = evaluateRaidShieldDirect('Hey friends, what game are we playing tonight?');
  assert.equal(safe.classification, 'safe');
});

test('askNexusAi integrates Casseurt crash-out roasts, swearing rules and Nexus Brain fallback', async () => {
  // Casseurt trigger
  const casseurtResp = await askNexusAi('do you like casseurt', { userId: '1394001641899954368' });
  assert.ok(casseurtResp.toLowerCase().includes('casseurt'));

  // Physical How-To Action: apple from bowl
  const appleResp = await askNexusAi('how to remove an apple from a bowl', { userId: '1394001641899954368' });
  assert.ok(appleResp.includes('apple') && appleResp.includes('bowl'));
  assert.ok(appleResp.includes('Approach & Locate') || appleResp.includes('Grip Firmly') || appleResp.includes('Lift Upward'));
  assert.ok(/fuck|shit|damn|ass|goddamn|bullshit/i.test(appleResp));

  // Math question - accurate result + swearing
  const mathResp = await askNexusAi('what is 10 + 25', { userId: '1394001641899954368' });
  assert.ok(mathResp.includes('35'));
  assert.ok(/fuck|shit|damn|ass|goddamn|bullshit/i.test(mathResp));

  // Deductive Logic Engine
  const logicResp = await askNexusAi('all dogs are animals and all animals are living', { userId: '1394001641899954368' });
  assert.ok(logicResp.includes('dogs') && logicResp.includes('living'));

  // General conversational query
  const identityResp = await askNexusAi('who are you', { userId: '1394001641899954368' });
  assert.ok(identityResp.includes('Nexus'));
  assert.ok(/fuck|shit|damn|ass|goddamn|bullshit/i.test(identityResp));
});

test('setNexusAiDisabled and isNexusAiDisabled manage toggle states', async () => {
  const dummyGuild = 'guild_test_toggle_123';
  await setNexusAiDisabled(dummyGuild, null, true);
  assert.equal(await isNexusAiDisabled(dummyGuild, null), true);

  await setNexusAiDisabled(dummyGuild, null, false);
  assert.equal(await isNexusAiDisabled(dummyGuild, null), false);
});
