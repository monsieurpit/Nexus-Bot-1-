import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_API_URL = process.env.NEXUS_API_URL || 'http://127.0.0.1:9/api/v1';
const { recordChannelMessage, clearChannelHistory } = await import('../../src/services/channelHistoryService.js');
const { __test } = await import('../../src/services/nexusOpenModeService.js');
const { shouldAnswerOpen, talksToSomeoneElse, takeSlot, channelAllowed, inFlightChannels, guildMinute } = __test;

const BOT = 'bot1';
const ON = { enabled: true, scope: 'chat' };
let n = 0;
function msg(content, { channel = 'general', ch = 'c1', author = 'me', mentions = [], repliedUser = null, reference = null } = {}) {
  return {
    id: `m${++n}`, content, author: { id: author, bot: false, username: author },
    channel: { id: ch, name: channel }, guild: { id: 'g1', members: { cache: new Map() } },
    client: { user: { id: BOT } }, attachments: { some: () => false },
    reference, mentions: { users: new Map(mentions.map((id) => [id, { id }])), roles: { size: 0 }, everyone: false, repliedUser: repliedUser ? { id: repliedUser } : null },
  };
}
const said = (ch, author, content, role = 'user') => recordChannelMessage(ch, { messageId: `h${++n}`, authorId: author, username: author, content, isBot: role === 'assistant' });

test('open mode answers the room rarely (25% dice + 3-min channel cooldown), never "lol" / no-context lines unless he is in the conversation, off = never', () => {
  clearChannelHistory('c1'); __test.lastOpenReply.clear();
  assert.equal(shouldAnswerOpen(msg('anyone watching the barca game tonight'), ON, 0.2).answer, true);
  assert.equal(shouldAnswerOpen(msg('anyone watching the barca game tonight'), ON, 0.5).answer, false); // was yes at 75%
  assert.equal(shouldAnswerOpen(msg('lol'), ON, 0.01).why, 'tiny');
  assert.equal(shouldAnswerOpen(msg('that was so funny'), ON, 0.01).why, 'no-context');
  assert.equal(shouldAnswerOpen(msg('he really did that'), ON, 0.01).why, 'no-context');
  assert.equal(shouldAnswerOpen(msg('lmao same'), ON, 0.01).why, 'tiny');
  assert.equal(shouldAnswerOpen(msg('cooked fr'), ON, 0.01).why, 'too-short');
  assert.equal(shouldAnswerOpen(msg('anyone watching the game'), { enabled: false }, 0.1).answer, false);
  // cooldown after he answered in this channel
  __test.lastOpenReply.set('c1', Date.now());
  assert.equal(shouldAnswerOpen(msg('who thinks messi is better than ronaldo'), ON, 0.01).why, 'cooldown');
  __test.lastOpenReply.clear();
  // he's IN the conversation (spoke just now): small lines are fine and the chance is high
  clearChannelHistory('c5');
  said('c5', BOT, 'barca are winning it this year', 'assistant');
  assert.equal(shouldAnswerOpen(msg('lol true', { ch: 'c5' }), ON, 0.8).answer, true);
  // other people mid-conversation without him: stays out
  clearChannelHistory('c6');
  said('c6', 'josh', 'did u see the match'); said('c6', 'sam', 'ye pedri was insane'); said('c6', 'josh', 'that pass in the 80th'); said('c6', 'sam', 'goated');
  assert.equal(shouldAnswerOpen(msg('honestly best game this season', { ch: 'c6', author: 'kai' }), ON, 0.01).why, 'others-talking');
});

test('he stays out when people talk to each other: a ping, a reply to someone, their name, a back-and-forth', () => {
  clearChannelHistory('c2');
  said('c2', 'josh', 'yo anyone up');
  assert.equal(shouldAnswerOpen(msg('wanna play later', { ch: 'c2', mentions: ['josh'] }), ON, 0.1).why, 'someone-else');
  assert.equal(shouldAnswerOpen(msg('fr', { ch: 'c2', reference: { messageId: 'x' }, repliedUser: 'josh' }), ON, 0.1).why, 'someone-else');
  assert.equal(shouldAnswerOpen(msg('josh u coming tonight?', { ch: 'c2' }), ON, 0.1).why, 'someone-else');
  assert.equal(shouldAnswerOpen(msg('u coming tonight, josh?', { ch: 'c2' }), ON, 0.1).why, 'someone-else');
  clearChannelHistory('c3');
  said('c3', 'me', 'did u finish the homework');
  said('c3', 'sam', 'nah not yet');
  said('c3', 'me', 'same lol');
  said('c3', 'sam', 'we are cooked');
  assert.equal(talksToSomeoneElse(msg('ok ill start it now', { ch: 'c3' })), true);
});

test('a reply to Nexus always gets an answer; never in ticket / staff channels; only chat/general unless "all"', () => {
  clearChannelHistory('c4');
  assert.equal(shouldAnswerOpen(msg('lol true', { ch: 'c4', reference: { messageId: 'x' }, repliedUser: BOT }), ON, 0.99).answer, true);
  assert.equal(channelAllowed('💬┃general', 'chat'), true);
  assert.equal(channelAllowed('memes', 'chat'), false);
  assert.equal(channelAllowed('memes', 'all'), true);
  assert.equal(channelAllowed('staff-chat', 'all'), false);
  assert.equal(channelAllowed('ticket-0042', 'all'), false);
});

test('budget: one reply in progress per channel, a per-server cap per minute', () => {
  inFlightChannels.clear(); guildMinute.clear();
  const release = takeSlot(msg('a', { ch: 'c9' }));
  assert.ok(release);
  assert.equal(takeSlot(msg('b', { ch: 'c9' })), null);
  release();
  assert.ok(takeSlot(msg('c', { ch: 'c9' })));
});
