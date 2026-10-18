import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReactRequest, performReactRequest } from '../../src/services/nexusReactService.js';

test('react requests are understood (emoji, names, custom emojis, target)', () => {
  assert.deepEqual(parseReactRequest('react 💀 to that'), { emoji: '💀', customName: null, target: 'other' });
  assert.equal(parseReactRequest('react with a skull to his message').emoji, '💀');
  assert.equal(parseReactRequest('can you react fire on that').emoji, '🔥');
  assert.equal(parseReactRequest('react clown to this one').target, 'own');
  assert.equal(parseReactRequest('react to my message with 😭').target, 'own');
  assert.equal(parseReactRequest('react :kekw:').customName, 'kekw');
  assert.equal(parseReactRequest('add a 🔥 reaction').emoji, '🔥');
});

test('talking ABOUT reacting is not a request', () => {
  for (const t of ['how would u react if i said i love you', 'how do i react to messages', 'dont react to that', 'he reacted with a skull lol', 'i will react later']) {
    assert.equal(parseReactRequest(t), null, t);
  }
});

test('the reaction goes on the replied-to message, and failures are reported honestly', async () => {
  const reacted = [];
  const ref = { id: 'r1', author: { id: 'other' }, react: async (e) => reacted.push(['r1', e]) };
  const msg = { id: 'm1', author: { id: 'me' }, client: { user: { id: 'bot' } }, reference: { messageId: 'r1' }, fetchReference: async () => ref, react: async (e) => reacted.push(['m1', e]) };
  const ok = await performReactRequest(msg, { emoji: '💀', target: 'other' });
  assert.equal(ok.ok, true);
  assert.deepEqual(reacted, [['r1', '💀']]);
  const noPerm = { ...ref, react: async () => { const e = new Error('Missing Permissions'); e.code = 50013; throw e; } };
  const r2 = await performReactRequest({ ...msg, fetchReference: async () => noPerm }, { emoji: '💀', target: 'other' });
  assert.deepEqual([r2.ok, r2.reason], [false, 'no-permission']);
  const gone = await performReactRequest({ ...msg, fetchReference: async () => null }, { emoji: '💀', target: 'other' });
  assert.deepEqual([gone.ok, gone.reason], [false, 'no-target']);
});
