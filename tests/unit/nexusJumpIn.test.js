import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_API_URL = process.env.NEXUS_API_URL || 'http://127.0.0.1:9/api/v1';
const { __test } = await import('../../src/services/nexusJumpInService.js');
const { candidateMoment, budgetOk, spend, lastInChannel, guildLog } = __test;
const msg = (content, channel = 'general', id = 'c1') => ({ content, channel: { id, name: channel }, guild: { id: 'g1' }, author: { id: 'u1', bot: false } });

test('jump-in moments: talked about in the 3rd person, his things; never when called, never serious', () => {
  assert.equal(candidateMoment(msg('honestly nexus is trash fr'), 'bot')?.kind, 'about-him');
  assert.equal(candidateMoment(msg('barca are cooking this season'), 'bot')?.kind, 'his-thing');
  assert.equal(candidateMoment(msg('nexus what is 2+2'), 'bot'), null); // called → normal path
  assert.equal(candidateMoment(msg('my grandma died yesterday, barca was her team'), 'bot'), null);
  assert.equal(candidateMoment(msg('what are we eating tonight'), 'bot'), null);
});

test('jump-in budget: 1 per channel per 25 min, never in staff / ticket channels', () => {
  lastInChannel.clear(); guildLog.clear();
  assert.equal(budgetOk(msg('x', 'general', 'c9')), true);
  spend(msg('x', 'general', 'c9'));
  assert.equal(budgetOk(msg('x', 'general', 'c9')), false);
  assert.equal(budgetOk(msg('x', 'staff-chat', 'c8')), false);
  assert.equal(budgetOk(msg('x', 'ticket-0042', 'c7')), false);
});
