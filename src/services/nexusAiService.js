import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../utils/logger.js';
import { NexusAI } from '../../nexus-ai.js';
import { logTelemetry, logCrash, logPersonaTrigger } from './aiTelemetryService.js';
import { getUserMemories, saveUserMemory } from './memoryBrainService.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

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

// Per-channel short-term conversation history — in-memory only (not persisted, unlike the
// cross-session fact memory in memoryBrainService.js, since this is meant to work like a chat
// UI's session history, naturally reset when the bot process restarts, not a durable fact store).
// Existed as dead capability before this: nexus-ai.js's SDK already supports a `history` field end
// to end (NexusSession tracks it, askJSON forwards it, the engine's generateReasoningPath reads it
// for conversational continuity — e.g. falling back to the last assistant message's language when
// a short reply like "ok ciekawe" has no language signal of its own), but askNexusAi below never
// populated it, so every real Discord message hit the engine with an empty history regardless of
// how much actual conversation had happened. Observed live: a Polish conversation's short "Nexus
// ok ciekawe" follow-up got answered in English — the exact case the engine's own context-fallback
// exists to catch, silently defeated because there was no history for it to fall back to.
// Keyed by channel (not user) since that's the natural "conversation" unit for a bot mentioned in
// a shared channel; bounded per-channel (last 6 turns, matching the engine's own history.slice(-6)
// usage) and bounded in total channel count (simple insertion-order eviction) so a long-running
// bot across many servers doesn't grow this unboundedly over weeks of uptime.
const CHANNEL_HISTORY = new Map(); // channelId -> {id, role, content, timestamp}[]
const CHANNEL_HISTORY_MAX_CHANNELS = 500;
const CHANNEL_HISTORY_MAX_TURNS = 6; // user+assistant pairs

function getChannelHistory(channelId) {
  if (!channelId) return [];
  return CHANNEL_HISTORY.get(channelId) || [];
}

function appendChannelHistory(channelId, role, content) {
  if (!channelId || !content) return;
  if (!CHANNEL_HISTORY.has(channelId) && CHANNEL_HISTORY.size >= CHANNEL_HISTORY_MAX_CHANNELS) {
    const oldestKey = CHANNEL_HISTORY.keys().next().value;
    if (oldestKey !== undefined) CHANNEL_HISTORY.delete(oldestKey);
  }
  const existing = CHANNEL_HISTORY.get(channelId) || [];
  existing.push({ id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, content, timestamp: Date.now() });
  // Keep the last N turns (2 messages per turn: user + assistant)
  const trimmed = existing.slice(-CHANNEL_HISTORY_MAX_TURNS * 2);
  CHANNEL_HISTORY.set(channelId, trimmed);
}

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
 * throws (network error, server down, timeout). This is deliberately simple: it exists so the bot
 * never goes fully silent, not to duplicate the real engine's knowledge or personality.
 */
function generateOfflineFallbackResponse(question, userContext) {
  const isSuperChillUser = userContext?.userId === '1394001641899954368';
  if (isSuperChillUser) {
    return `Damn bro, I can't reach my neural engine right now, but I'm still here for you my favorite homie! Try that again in a sec.`;
  }
  return `Bro, I can't reach my AI engine right now — the server might be redeploying or down for a sec. Try again shortly.`;
}

/**
 * Sends a question to the real Nexus AI engine and returns plain text.
 * Falls back to a minimal local response only if the actual API call fails outright.
 *
 * userContext.client/userContext.guildId are optional — when present (passed from
 * handleNexusAiMessage below, which has a live Discord message to pull them from), a successful
 * call fires telemetry logging (#bot-logs, and #jailbreak-stress-test when the engine reports
 * meltdown/CAPS mode or the swear floor actually fired) and a failed call logs the crash to
 * #prompt-workbench. Logging is always best-effort and never affects the returned reply — every
 * function in aiTelemetryService.js already swallows its own errors.
 */
export async function askNexusAi(question, userContext = {}) {
  const isSuperChillUser = userContext.userId === '1394001641899954368';
  const { client, guildId, channelId } = userContext;

  // Cross-conversation memory — load whatever's stored about this user (favorite team, which
  // football game they play, etc. from past conversations) and send it along so the engine can
  // actually use it. See memoryBrainService.js for why this used to be a permanently-dead no-op.
  const memories = await getUserMemories(client, userContext.userId);
  const history = getChannelHistory(channelId);

  try {
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

    appendChannelHistory(channelId, 'user', question);
    appendChannelHistory(channelId, 'assistant', reply);

    // The engine extracts at most one new fact per message and tells us via `newMemory` — persist
    // it now that we know the call succeeded. Best-effort: memoryBrainService already swallows its
    // own errors, so this never risks delaying or breaking the reply the user is waiting on.
    if (data.newMemory && client) {
      saveUserMemory(client, userContext.userId, data.newMemory).catch(() => {});
    }

    if (client && guildId) {
      const telemetry = data.telemetry;
      if (telemetry) {
        logTelemetry(client, guildId, {
          latencyMs: telemetry.latencyMs,
          language: telemetry.language,
          temperature: telemetry.temperature,
          swearFloorTriggered: telemetry.swearFloorTriggered,
          promptSnippet: question,
        }).catch(() => {});

        if (telemetry.triggered) {
          logPersonaTrigger(client, guildId, { type: 'meltdown', promptSnippet: question }).catch(() => {});
        } else if (telemetry.swearFloorTriggered) {
          logPersonaTrigger(client, guildId, { type: 'swear_floor', promptSnippet: question }).catch(() => {});
        }
      }
    }

    return reply;
  } catch (err) {
    logger.warn(`[Nexus AI] Real API call failed (${err.message}), using minimal offline fallback`);
    if (client && guildId) {
      logCrash(client, guildId, { input: question, error: err, source: 'askNexusAi' }).catch(() => {});
    }
    return generateOfflineFallbackResponse(question, userContext);
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

  // Per-user cooldown, applied right before the backend call and BEFORE the typing indicator so a
  // rate-limited message never touches the AI backend at all. This never existed before — every
  // Discord message reaching this point went straight to askNexusAi() unconditionally. On a
  // 12.2k-member server, all of the bot's traffic funnels through one Railway process into a
  // single local Ollama instance (only 2 real concurrent generations possible on the host
  // hardware) — without a per-user floor, one person spamming the bot could starve everyone else
  // waiting in the shared queue. 1 request per 6 seconds is generous for genuine back-and-forth
  // conversation but blocks rapid-fire spam.
  const rateLimitKey = `nexus-ai:${userId}`;
  const allowed = await checkRateLimit(rateLimitKey, 1, 6000);
  if (!allowed) {
    await message.reply({
      content: "Whoa, slow down — give me a few seconds between messages so everyone else gets a turn too."
    }).catch(() => {});
    return true;
  }

  // Send typing indicator while waiting for the Nexus API
  message.channel.sendTyping().catch(() => {});

  try {
    const answer = await askNexusAi(question, {
      userId,
      username: message.author.username,
      client: message.client,
      guildId: message.guild?.id,
      channelId: message.channel?.id
    });

    // Check if answer is missing or consists entirely of invisible blank characters
    if (!answer || cleanInvisibleCharacters(answer).length === 0) {
      await message.reply({
        content: "Nah bro, I ran into a fucking error, Try again when I want to work..."
      }).catch(() => {});
      return true;
    }

    const chunks = splitIntoChunks(answer);
    if (chunks.length === 1) {
      await message.reply({
        content: chunks[0]
      });
    } else {
      await message.reply({
        content: chunks[0]
      });
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
  }
}
