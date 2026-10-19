import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_API_URL = process.env.NEXUS_API_URL || 'http://127.0.0.1:9/api/v1';
const { __test } = await import('../../src/services/nexusJumpInService.js');
const { candidateMoment, budgetOk, spend, lastInChannel, guildLog, isJumpInChannel } = __test;
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

test('jump-ins only in channels with "chat" or "general" in the name, whatever the emojis / symbols / fancy letters', () => {
  for (const n of ['general', 'chat', '💬┃general', '『chat』', 'General_Chat_2', '🌍・GENERAL', 'ɢᴇɴᴇʀᴀʟ-ᴄʜᴀᴛ', 'ｇｅｎｅｒａｌ', 'main-chat✨', '✧･ﾟ: *chat*:･ﾟ✧', 'g.e.n.e.r.a.l']) {
    assert.equal(isJumpInChannel(n), true, n);
  }
  for (const n of ['memes', 'gaming', '📸┃pics', 'bot-commands', 'welcome', 'sports', '', null, undefined]) {
    assert.equal(isJumpInChannel(n), false, String(n));
  }
});

test('budget: allowed in chat / general, blocked everywhere else and in staff / ticket chats', () => {
  lastInChannel.clear(); guildLog.clear();
  assert.equal(budgetOk(msg('x', '💬┃general', 'a1')), true);
  assert.equal(budgetOk(msg('x', 'chat', 'a2')), true);
  assert.equal(budgetOk(msg('x', 'memes', 'a3')), false);
  assert.equal(budgetOk(msg('x', 'staff-chat', 'a4')), false);
  assert.equal(budgetOk(msg('x', 'ticket-chat', 'a5')), false);
});
