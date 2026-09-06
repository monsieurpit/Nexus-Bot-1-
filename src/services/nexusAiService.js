import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../utils/logger.js';
import { NexusAI } from '../../nexus-ai.js';
import { getUserMemories, saveUserMemory } from './memoryBrainService.js';
import { getChannelHistory, recordChannelMessage } from './channelHistoryService.js';

// Talks to your real, deployed Nexus AI engine — the same custom engine that lives in the
// Nexus-AI- repo (footballIntelligence.ts, bm25Engine.ts, reasoningEngine.ts, etc.), instead of
// calling Gemini directly. Calling an external LLM here defeated the entire point of that custom
// engine: none of its knowledge, personas, RaidShield checks, or fixes could ever reach a message
// answered this way, no matter how much work went into the engine itself.
// Exported so other services (e.g. the dashboard's API router) can reuse this single client
// instance instead of constructing their own — one place to configure, one source of truth for
// which deployment "the custom AI" actually means.
export const nexusClient = new NexusAI({
  apiKey: process.env.NEXUS_API_KEY,
  baseUrl: process.env.NEXUS_API_URL,
});

const disabledGuilds = new Set(); // targetId (guildId or channelId) -> boolean

// Only requires the command word to START the message (after "Nexus" is already stripped by
// parseNexusTrigger) — it used to also require the message to END right after one specific
// whitelisted trailing word (yourself/ai/nexus/mode/...) or nothing at all, so ANY unexpected
// trailing word ("Nexus deactive <anything not on that list>") silently failed to match and fell
// through to being answered as a normal question instead of actually deactivating. Since this
// only ever runs on a message already directly addressing the bot by name, "deactivate" as the
// lead word is unambiguous — nothing legitimate needs to say "deactivate ..." to the bot except
// meaning the bot itself.
// "deactiv(?:e|ate)" also covers the common informal/typo'd short form "deactive" (missing
// "-ate") — the exact phrasing that originally triggered this whole investigation ("Nexus
// deactive ...") went unmatched not just because of the old trailing-word restriction above, but
// because "deactive" itself was never one of the recognized alternatives at all.
const DEACTIVATE_REGEX = /^(?:please\s+)?(?:desactiv(?:e|ate)|deactiv(?:e|ate)|d[ée]sactiv(?:e|er|é|ée|és|ées)?|disable|turn\s*off|shut\s*(?:down|up)|[ée]teins?)\b/i;
// Same fix as DEACTIVATE_REGEX above — only require the command word to lead the message.
const ACTIVATE_REGEX = /^(?:please\s+)?(?:reactivate|activate|r[ée]activ(?:e|er|é|ée|és|ées)?|activ(?:e|er|é|ée|és|ées)?|enable|turn\s*on|allume?|rallume?)\b/i;

const disabledAiResponses = [
  "Dude, y'all desactivated me, I ain't answering!",
  "Bro, y'all literally turned my ass off, I ain't answering shit.",
  "Dude, you guys desactivated me, leave me the fuck alone.",
  "Bro, I'm literally desactivated right now, I ain't answering a single thing.",
  "Dude, y'all shut me down, remember? Reactivate my ass first if you want an answer!"
];

/**
 * Checks if Nexus AI is disabled for the given guild or scope.
 */
export async function isNexusAiDisabled(targetId, client) {
  if (!targetId) return false;
  if (disabledGuilds.has(targetId)) return true;
  if (client?.db?.get) {
    try {
      const dbVal = await client.db.get(`nexus:ai:disabled:${targetId}`);
      if (dbVal === true) {
        disabledGuilds.add(targetId);
        return true;
      }
    } catch {
      // Ignore db errors
    }
  }
  return false;
}

/**
 * Sets disabled state for a guild or scope.
 */
export async function setNexusAiDisabled(targetId, client, disabled = true) {
  if (!targetId) return;
  if (disabled) {
    disabledGuilds.add(targetId);
    if (client?.db?.set) {
      await client.db.set(`nexus:ai:disabled:${targetId}`, true).catch(() => {});
    }
  } else {
    disabledGuilds.delete(targetId);
    if (client?.db?.delete) {
      await client.db.delete(`nexus:ai:disabled:${targetId}`).catch(() => {});
    } else if (client?.db?.set) {
      await client.db.set(`nexus:ai:disabled:${targetId}`, false).catch(() => {});
    }
  }
}

/**
 * Minimal, genuinely last-resort local fallback — used only when the real Nexus API call itself
 * throws (network error, server down, timeout).
 */
function generateOfflineFallbackResponse(question, userContext) {
  const isSuperChillUser = userContext?.userId === '1394001641899954368' || Boolean(userContext?.isSuperChillUser);
  if (isSuperChillUser) {
    return `Damn bro, I can't reach my neural engine right now, but I'm still here for you my favorite homie! Try that again in a sec.`;
  }
  return `Bro, I can't reach my AI engine right now — the server might be redeploying or down for a sec. Try again shortly.`;
}

/**
 * Sends a question to the real Nexus AI engine and returns plain text.
 * Falls back to the minimal offline response if the remote API call fails.
 *
 * Cross-conversation memory (favorite team, preferred name, etc. — persisted per Discord user
 * between separate messages) is wired in here when `userContext.client` is provided: this was
 * previously a completely dead feature — the engine's /api/v1/nexus endpoint has real logic to
 * recall stored facts (a "what do you remember about me" path) and already returns a `newMemory`
 * field whenever it extracts something new to remember, and memoryBrainService.js already had
 * working get/save functions for exactly this — but nothing on this side ever actually called
 * either of them, so the engine's own memory recall logic could never fire for any Discord user.
 * Passing `client` is optional and backward compatible: any other caller of askNexusAi that
 * doesn't provide one just skips memory loading/saving, same as before this change.
 */
export async function askNexusAi(question, userContext = {}) {
  const isSuperChillUser = userContext.userId === '1394001641899954368' || Boolean(userContext.isSuperChillUser);
  const hasMemoryAccess = Boolean(userContext.client && userContext.userId);

  try {
    const memories = hasMemoryAccess
      ? await getUserMemories(userContext.client, userContext.userId)
      : [];
    // Nexus's "brain" — channelHistoryService.js's rolling per-channel buffer, recorded on EVERY
    // message in messageCreate.js (not just ones addressed to Nexus). Before this, `history` was
    // never populated at all: every question got answered with zero conversation context, no
    // matter how good the AI engine's own follow-up/entity-tracking logic was on the other end —
    // it simply never received anything to work with.
    const history = userContext.channelId ? getChannelHistory(userContext.channelId) : [];
    const data = await nexusClient.askJSON({
      prompt: question,
      authorId: userContext.userId,
      username: userContext.username,
      isSuperChillUser,
      memories,
      history,
    });
    const reply = data?.response || data?.text || '';
    if (!reply) throw new Error('Empty response from Nexus API');
    if (hasMemoryAccess && data?.newMemory) {
      // Best-effort, fire-and-forget by design (see saveUserMemory's own comment) — never lets a
      // memory-persistence failure delay or break the reply the user is actually waiting on.
      saveUserMemory(userContext.client, userContext.userId, data.newMemory).catch(() => {});
    }
    // Record Nexus's own reply too, tagged assistant — so the NEXT message in this channel
    // (whether it's a follow-up to Nexus or just ambient chatter) has this turn available too.
    if (userContext.channelId) {
      recordChannelMessage(userContext.channelId, {
        authorId: userContext.client?.user?.id,
        username: 'Nexus',
        content: reply,
        isBot: true,
        // Which user's question this reply is actually answering — see channelHistoryService.js's
        // own comment on replyToAuthorId for why this matters more than positional adjacency.
        replyToAuthorId: userContext.userId,
      });
    }
    return reply;
  } catch (err) {
    logger.warn(`[Nexus AI] Real API call failed (${err.message}), using minimal offline fallback`);
    return generateOfflineFallbackResponse(question, userContext);
  }
}

/**
 * Same as askNexusAi above, but streams the reply back via onToken as the engine generates it
 * (only the casual/small-talk conversational path actually streams anything server-side — a
 * grounded factual question just produces zero onToken calls and goes straight to the final
 * result, exactly like askNexusAi would have). Mirrors askNexusAi's memory-fetch/save and
 * channel-history recording so callers get identical side effects either way.
 *
 * Falls back to the plain non-streaming askNexusAi (which has its own retrying HTTP client and
 * offline-fallback text) on ANY failure — a network hiccup, a malformed stream, whatever — rather
 * than duplicating that error handling here. Returns `{ reply, streamed }` so the caller (the
 * Discord message-editing logic) knows whether anything was actually streamed or whether the
 * fallback text just needs to be sent as one normal reply.
 *
 * @param {string} question
 * @param {Object} userContext
 * @param {(chunk: string) => void} onToken
 * @returns {Promise<{ reply: string, streamed: boolean }>}
 */
export async function askNexusAiStream(question, userContext = {}, onToken) {
  const isSuperChillUser = userContext.userId === '1394001641899954368' || Boolean(userContext.isSuperChillUser);
  const hasMemoryAccess = Boolean(userContext.client && userContext.userId);
  let streamedAny = false;

  try {
    const memories = hasMemoryAccess
      ? await getUserMemories(userContext.client, userContext.userId)
      : [];
    const history = userContext.channelId ? getChannelHistory(userContext.channelId) : [];
    const data = await nexusClient.askStream(
      {
        prompt: question,
        authorId: userContext.userId,
        username: userContext.username,
        isSuperChillUser,
        memories,
        history,
      },
      (chunk) => {
        streamedAny = true;
        onToken(chunk);
      }
    );
    const reply = data?.response || data?.text || '';
    if (!reply) throw new Error('Empty response from Nexus stream API');
    if (hasMemoryAccess && data?.newMemory) {
      saveUserMemory(userContext.client, userContext.userId, data.newMemory).catch(() => {});
    }
    if (userContext.channelId) {
      recordChannelMessage(userContext.channelId, {
        authorId: userContext.client?.user?.id,
        username: 'Nexus',
        content: reply,
        isBot: true,
        // Which user's question this reply is actually answering — see channelHistoryService.js's
        // own comment on replyToAuthorId for why this matters more than positional adjacency.
        replyToAuthorId: userContext.userId,
      });
    }
    return { reply, streamed: streamedAny };
  } catch (err) {
    logger.warn(`[Nexus AI] Stream API call failed (${err.message}), falling back to non-streaming askNexusAi`);
    const reply = await askNexusAi(question, userContext);
    return { reply, streamed: false };
  }
}

/**
 * Strips all invisible Unicode whitespace, braille blanks, hangul fillers, and zero-width characters.
 */
function cleanInvisibleCharacters(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[\s\u115f\u1160\u2800\u3164\uffa0\u200b-\u200f\ufeff\u00a0\u2000-\u200a\u202f\u205f\u3000\u00ad]/g, '');
}

/**
 * Splits text into safe chunks under the Discord 2000 character limit.
 */
function splitIntoChunks(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.substring(0, splitIdx).trim());
    remaining = remaining.substring(splitIdx).trim();
  }

  return chunks;
}

/**
 * Parses a message to check if it's addressing Nexus via name, greeting prefixes, or pings.
 */
export function parseNexusTrigger(content, botUserId = null) {
  if (!content || typeof content !== 'string') return null;

  const trimmed = content.trim();
  if (!trimmed) return null;

  // 1. Direct bot mention regex if bot user ID is available (e.g. <@BOT_ID> or <@!BOT_ID>)
  if (botUserId) {
    const botMentionPattern = new RegExp(`<@!?${botUserId}>`, 'i');
    if (botMentionPattern.test(trimmed)) {
      const cleanContent = trimmed.replace(new RegExp(`<@!?${botUserId}>`, 'gi'), '').trim();
      const strippedGreetings = cleanContent.replace(/^(?:hey+|hello|hi+|yo+|sup|what(?:'?s|\s+is)\s+up|salut|bonjour|coucou|good\s+(?:morning|evening|afternoon|day)|ok(?:ay)?|ay+)[\s,:!?-]*/is, '').trim();
      return { matched: true, question: strippedGreetings };
    }
  }

  // 2. Starts with greeting + "nexus" or just "nexus" as a distinct word
  // e.g., "hey nexus...", "hello nexus...", "hi nexus...", "nexus..."
  const prefixRegex = /^\s*(?:(?:hey+|hello|hi+|yo+|sup|what(?:'?s|\s+is)\s+up|salut|bonjour|coucou|good\s+(?:morning|evening|afternoon|day)|ok(?:ay)?|ay+)\s+)?\bnexus\b[\s,:!?\-]*(.*)$/is;
  const prefixMatch = trimmed.match(prefixRegex);
  if (prefixMatch) {
    return { matched: true, question: prefixMatch[1] || '' };
  }

  // 3. Ends with "nexus" as a distinct word (e.g. "what is 2+2 nexus?")
  const suffixMatch = trimmed.match(/^(.*?)(?:[\s,:!?\-]+\bnexus\b[\s,:!?\-]*)$/is);
  if (suffixMatch && suffixMatch[1].trim().length > 0) {
    return { matched: true, question: suffixMatch[1].trim() };
  }

  return null;
}

/**
 * Handles incoming Discord messages addressing Nexus.
 * Returns true if the message was handled as a Nexus AI query, false otherwise.
 */
export async function handleNexusAiMessage(message) {
  if (message.author?.bot) return false;
  if (!message.content || typeof message.content !== 'string') return false;

  const botUserId = message.client?.user?.id;
  const triggerResult = parseNexusTrigger(message.content, botUserId);
  if (!triggerResult || !triggerResult.matched) return false;

  const rawQuestion = triggerResult.question || '';
  const printableCharacters = cleanInvisibleCharacters(rawQuestion);
  const targetScopeId = message.guild?.id || message.channel?.id || 'global';

  // Check for deactivation trigger (e.g. "Nexus, desactivate", "hey nexus deactivate", "@Nexus desactivate")
  if (DEACTIVATE_REGEX.test(rawQuestion.trim())) {
    await setNexusAiDisabled(targetScopeId, message.client, true);
    await message.reply({
      content: "Alright, I'm desactivating my fucking ass."
    }).catch(err => logger.error('[Nexus AI] Error sending deactivate reply:', err));
    return true;
  }

  // Check for reactivation trigger (e.g. "Nexus, activate", "hey nexus activate", "@Nexus activate")
  if (ACTIVATE_REGEX.test(rawQuestion.trim())) {
    await setNexusAiDisabled(targetScopeId, message.client, false);
    await message.reply({
      content: "Alright, I'm back up, what the fuck do you want?"
    }).catch(err => logger.error('[Nexus AI] Error sending activate reply:', err));
    return true;
  }

  // If AI is currently disabled in this guild/channel, do not process regular prompts and notify the user
  const isDisabled = await isNexusAiDisabled(targetScopeId, message.client);
  if (isDisabled) {
    const randomDisabledMsg = disabledAiResponses[Math.floor(Math.random() * disabledAiResponses.length)];
    await message.reply({
      content: randomDisabledMsg
    }).catch(err => logger.error('[Nexus AI] Error sending disabled reply:', err));
    return true;
  }

  const userId = message.author?.id;

  // If user only pinged/said "nexus" or sent greeting with no question
  if (printableCharacters.length === 0) {
    if (userId === '1394001641899954368') {
      await message.reply({
        content: "What's good my fucking bro! How can I help your awesome ass today?"
      }).catch(err => logger.error('[Nexus AI] Error sending chill prompt hint:', err));
      return true;
    }
    await message.reply({
      content: 'Hello buddy, why the fuck did you mention my name? You want me to answer your fucking question again?'
    }).catch(err => logger.error('[Nexus AI] Error sending prompt hint:', err));
    return true;
  }

  const question = rawQuestion.trim();

  // Send typing indicator while waiting for the Nexus API. Discord only displays the typing
  // indicator for ~10s before it silently expires — a single one-shot call here used to mean a
  // reply taking longer than that (a broad factual question, or the thorough/deep-cot reasoning
  // escalation) would look like the bot had stalled or ignored the message for the back half of
  // the wait, even though it was still genuinely working. Re-firing it on an interval keeps the
  // indicator alive for the whole real wait; cleared in `finally` below the moment a reply (or an
  // error) is actually sent, so it never keeps "typing" after the bot has gone quiet.
  message.channel.sendTyping().catch(() => {});
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {});
  }, 8000);

  try {
    // Progressive token-by-token streaming was removed on purpose: it made the Discord message
    // visibly rebuild itself through half-formed, under-sworn intermediate states (the swear
    // floor / safety top-up only applies to the FINAL text, so the streamed preview and the
    // settled message always differed and it "edited" in front of you). One complete, fully
    // processed reply, sent once, is what Patrick wants. The persistent typing indicator above
    // covers the wait.
    const sentMessage = null;
    const streamed = false;

    const answer = await askNexusAi(question, {
      userId,
      username: message.author.username,
      client: message.client,
      channelId: message.channel.id
    });

    // Check if answer is missing or consists entirely of invisible blank characters
    if (!answer || cleanInvisibleCharacters(answer).length === 0) {
      await message.reply({
        content: "Nah bro, I ran into a fucking error, Try again when I want to work..."
      }).catch(() => {});
      return true;
    }

    const chunks = splitIntoChunks(answer);
    if (streamed && sentMessage && chunks.length === 1) {
      // Final edit with the verified, possibly-slightly-different-from-streamed text (a safety
      // block, swear-floor top-up, or phone-number correction can tweak the tail end after the
      // raw stream already showed something close to it) — this edit is the source of truth for
      // what the message ends up reading, not whatever was last streamed.
      await sentMessage.edit({ content: chunks[0] }).catch(async () => {
        // If the edit itself fails for some reason, still get the real answer to the user.
        await message.reply({ content: chunks[0] }).catch(() => {});
      });
    } else if (chunks.length === 1) {
      await message.reply({
        content: chunks[0]
      });
    } else {
      // Multi-chunk answers (rare for the streaming-eligible casual path, normal for longer
      // grounded answers) — if a streamed reply message already exists, its first edit becomes
      // chunk 1 instead of sending a duplicate message.
      if (streamed && sentMessage) {
        await sentMessage.edit({ content: chunks[0] }).catch(() => {});
      } else {
        await message.reply({ content: chunks[0] });
      }
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send({
          content: chunks[i]
        });
      }
    }
    return true;
  } catch (error) {
    logger.error('[Nexus AI] Error handling message:', error);
    await message.reply({
      content: "Nah bro, I ran into a fucking error, Try again when I want to work..."
    }).catch(() => {});
    return true;
  } finally {
    clearInterval(typingInterval);
  }
}
