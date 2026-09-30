import test from 'node:test';
import assert from 'node:assert/strict';

// These tests exercise the offline fallback, so the SDK must NOT reach a real engine — on a dev
// machine the real one is often running at the default localhost:3000 and answered for real, which
// made the fallback assertions fail. A dead address (set before the service module creates its
// client, hence the dynamic import) makes the test independent of what's running locally.
process.env.NEXUS_API_URL = 'http://127.0.0.1:9/api/v1';
const { askNexusAi, parseNexusTrigger, isNexusAiDisabled, setNexusAiDisabled } = await import('../../src/services/nexusAiService.js');

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

test('askNexusAi routes Casseurt questions through the real engine, no local short-circuit', async () => {
  // There used to be a hardcoded CASSEURT_LIKE_REGEX intercept here that returned one of a fixed
  // set of pre-written "Fuck no!" strings without ever calling the real Nexus AI engine — the
  // same class of bug fixed in ruleEngine.ts (Nexus-AI- repo): a language-agnostic keyword
  // short-circuit that pre-empted the real, freshly-generated LLM roast and left the engine's own
  // swear-floor telemetry meaningless for these messages. It's gone now, so a Casseurt question
  // takes the exact same path as any other question: attempt the real API, and only fall back to
  // the minimal offline message (never a Casseurt-specific line) if that call itself fails.
  const casseurtResp = await askNexusAi('do you like casseurt', { userId: '1394001641899954368' });
  assert.ok(!/fuck no/i.test(casseurtResp));
  assert.ok(/can't reach my (neural|AI) engine/i.test(casseurtResp));

  const casseurtResp2 = await askNexusAi('what do you think about casseurt', { userId: '111' });
  assert.ok(!/fuck no/i.test(casseurtResp2));
  assert.ok(/can't reach my (neural|AI) engine/i.test(casseurtResp2));
});

test('setNexusAiDisabled and isNexusAiDisabled manage toggle states', async () => {
  const dummyGuild = 'guild_test_toggle_123';
  await setNexusAiDisabled(dummyGuild, null, true);
  assert.equal(await isNexusAiDisabled(dummyGuild, null), true);

  await setNexusAiDisabled(dummyGuild, null, false);
  assert.equal(await isNexusAiDisabled(dummyGuild, null), false);
});

test('"nexus forget me" erases the user\'s stored memories', async () => {
  const { handleNexusAiMessage } = await import('../../src/services/nexusAiService.js');
  const store = new Map([['nexus:memory:42', [{ key: 'favoriteTeam', fact: 'Barça' }]]]);
  const replies = [];
  const message = {
    author: { id: '42', bot: false, username: 'u' },
    content: 'nexus forget everything about me',
    guild: null,
    channel: { id: 'c1', sendTyping: async () => {} },
    attachments: { find: () => null },
    client: { user: { id: 'bot' }, db: { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k) } },
    reply: async (m) => replies.push(m.content),
  };
  assert.equal(await handleNexusAiMessage(message), true);
  assert.equal(store.has('nexus:memory:42'), false);
  assert.match(replies[0], /wiped everything/);
});

test('replies can never carry a live @everyone / @here / role mention', async () => {
  const { defuseMassMentions } = await import('../../src/services/nexusAiService.js');
  const out = defuseMassMentions('he pings @everyone and @here, also <@&123456>');
  assert.ok(!/@everyone|@here|<@&/.test(out), out);
  assert.match(out, /@\u200beveryone/);
});

test('"nexus" as the object of the question is kept ("do u like nexus"), a trailing call is stripped', async () => {
  const { parseNexusTrigger: parse } = await import('../../src/services/nexusAiService.js');
  assert.equal(parse('do u like nexus').question, 'do u like nexus');
  assert.equal(parse('what do you think about nexus').question, 'what do you think about nexus');
  assert.equal(parse('is casseurt smarter than nexus').question, 'is casseurt smarter than nexus');
  assert.equal(parse('what is 2+2 nexus?').question, 'what is 2+2');
  assert.equal(parse('you good, nexus').question, 'you good');
});
