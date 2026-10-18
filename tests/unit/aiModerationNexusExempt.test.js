import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_API_URL = process.env.NEXUS_API_URL || 'http://127.0.0.1:1/api/v1';
const { isDirectedAtNexus, skipsReviewAsNexusChat } = await import('../../src/services/aiModerationService.js');

const BOT_ID = '999999999999999999';
const msg = (content, extra = {}) => ({ content, client: { user: { id: BOT_ID } }, mentions: {}, ...extra });

test('RaidShield: messages talking to Nexus are not reviewed', () => {
  for (const c of ['Nexus, what do you think?', 'What do you think, Nexus?', 'NEXUS', 'nexus!!!', 'yo nexus u good', 'hey Nexus roast him', `<@${BOT_ID}> fuck you lol`, 'Nexus I\'ll ban him for nothing lol']) {
    assert.equal(skipsReviewAsNexusChat(msg(c)), true, c);
  }
});

test('RaidShield: a reply to one of Nexus\'s messages is not reviewed', () => {
  const m = msg('lmao true', { reference: { messageId: '1' }, mentions: { repliedUser: { id: BOT_ID } } });
  assert.equal(isDirectedAtNexus(m), true);
  assert.equal(skipsReviewAsNexusChat(m), true);
});

test('RaidShield: a reply to someone else, or talking ABOUT nexus mid-sentence, is still reviewed', () => {
  assert.equal(skipsReviewAsNexusChat(msg('lmao true', { reference: { messageId: '1' }, mentions: { repliedUser: { id: '123' } } })), false);
  assert.equal(skipsReviewAsNexusChat(msg('i think the nexus bot is down today')), false);
  assert.equal(skipsReviewAsNexusChat(msg('free nitro for everyone join now')), false);
});

test('RaidShield: "nexus" in front of a link does NOT bypass the scan', () => {
  for (const c of ['nexus check this https://discord-gift.ru/claim', 'nexus join discord.gg/abc123', 'free nitro steam-wallet.ru/redeem nexus']) {
    assert.equal(isDirectedAtNexus(msg(c)), true, c);
    assert.equal(skipsReviewAsNexusChat(msg(c)), false, c);
  }
});
