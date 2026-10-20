// Nexus's "brain" — a rolling per-channel window of recent messages so it has ambient awareness
// of what's actually been happening in a channel, not just the single message someone addressed
// it with. Before this existed, EVERY question to Nexus was answered with zero conversation
// history at all: nexusAiService.js's askNexusAi() never populated the `history` field the AI
// engine's API already accepts, so its own conversation-memory/follow-up-tracking logic
// (reasoningEngine.ts's buildConversationMemory) had nothing to work with regardless of how good
// it was — "what about South Korea" right after "what's the capital of Japan" would have had no
// idea a prior turn existed. This is purely in-memory, on the BOT's own process (not Nexus-AI's
// memory-constrained Railway deployment) — cheap here, and capped hard so it can never grow
// unbounded across many active channels.

const MAX_MESSAGES_PER_CHANNEL = 50;
// A channel nobody's touched in a while shouldn't hold memory forever — same reasoning as
// moodEngine.ts's decay on the AI side, just applied to eviction instead of a numeric value.
// Cleared lazily (checked on next touch) rather than a running timer, so an inactive bot process
// isn't doing background work for channels nobody's posting in.
const CHANNEL_IDLE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** @type {Map<string, { messages: Array<{role: 'user'|'assistant', content: string, authorId: string, username: string, timestamp: number}>, lastTouchedAt: number }>} */
const channelBuffers = new Map();

// Buffers are only replaced lazily when their channel is touched again, so a channel that goes
// quiet forever would otherwise keep its buffer for the life of the process. A cheap hourly sweep
// drops idle ones; unref() so this timer never keeps the process alive on its own.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [channelId, buffer] of channelBuffers) {
    if (now - buffer.lastTouchedAt >= CHANNEL_IDLE_TTL_MS) channelBuffers.delete(channelId);
  }
}, 60 * 60 * 1000);
sweepTimer.unref?.();

function getOrCreateBuffer(channelId) {
  const existing = channelBuffers.get(channelId);
  if (existing && Date.now() - existing.lastTouchedAt < CHANNEL_IDLE_TTL_MS) {
    return existing;
  }
  const fresh = { messages: [], lastTouchedAt: Date.now() };
  channelBuffers.set(channelId, fresh);
  return fresh;
}

/**
 * Record a message into its channel's rolling buffer. Called for EVERY real message in
 * messageCreate.js (not just ones addressed to Nexus) — that's the whole point, ambient
 * awareness of the channel, not just its own Q&A turns.
 * @param {string} channelId
 * @param {{ authorId: string, username: string, content: string, isBot: boolean, replyToAuthorId?: string }} entry
 */
export function recordChannelMessage(channelId, entry) {
  if (!channelId || !entry?.content?.trim()) return;
  const buffer = getOrCreateBuffer(channelId);
  buffer.messages.push({
    role: entry.isBot ? 'assistant' : 'user',
    messageId: entry.messageId,
    content: entry.content.trim().slice(0, 1000), // a single message being absurdly long shouldn't blow out the buffer
    authorId: entry.authorId,
    username: entry.username,
    // Only meaningful on the bot's own (isBot) entries — which user's question this specific
    // reply was actually answering. See ChatMessage.replyToAuthorId (types.ts, Nexus-AI- repo) for
    // why this exists: positional adjacency in a busy multi-speaker channel can't reliably tell
    // who a reply was for once other people's messages land in between.
    replyToAuthorId: entry.replyToAuthorId,
    // who a member's message was aimed at (2026-10-20, the engine's room summary): the person they replied to, the people
    // they @mentioned
    replyToUsername: entry.replyToUsername,
    mentions: Array.isArray(entry.mentions) ? entry.mentions.slice(0, 5) : undefined,
    timestamp: Date.now(),
  });
  if (buffer.messages.length > MAX_MESSAGES_PER_CHANNEL) {
    buffer.messages.shift();
  }
  buffer.lastTouchedAt = Date.now();
}

/**
 * Get the channel's recent history, shaped for the Nexus AI SDK's `history` field (askJSON /
 * NexusChatSession both accept `{ role, content }` entries — see nexus-ai.js's own JSDoc).
 * Sends `authorId`/`username` as real structured fields now (ChatMessage widened for this in
 * types.ts) instead of the old "PatrickH: ..." string-prefix workaround — a channel can have many
 * different speakers, and reasoningEngine.ts's buildConversationMemory can now actually reason
 * about who said what instead of guessing from text it could only partially pattern-match back
 * out. Every message still carries `content` on its own (unprefixed) so a caller that ignores the
 * new fields entirely (or an older cached message shape) still gets a sane transcript.
 * @param {string} channelId
 * @param {number} [limit] defaults to the full buffer (50)
 */
export function getChannelHistory(channelId, limit = MAX_MESSAGES_PER_CHANNEL, { excludeMessageId } = {}) {
  const buffer = channelBuffers.get(channelId);
  if (!buffer) return [];
  return buffer.messages
    .filter((m) => !excludeMessageId || m.messageId !== excludeMessageId)
    .slice(-limit)
    .map((m) => ({
    role: m.role,
    content: m.content,
    authorId: m.authorId,
    username: m.username,
    replyToAuthorId: m.replyToAuthorId,
    replyToUsername: m.replyToUsername,
    mentions: m.mentions,
    timestamp: m.timestamp,
  }));
}

/**
 * Drop a channel's buffer entirely — used when Nexus is deactivated in a channel/guild
 * (setNexusAiDisabled), so re-enabling it later starts fresh instead of resurfacing stale context
 * from before it was turned off.
 * @param {string} channelId
 */
export function clearChannelHistory(channelId) {
  channelBuffers.delete(channelId);
}
