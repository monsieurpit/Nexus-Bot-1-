import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../utils/logger.js';
import { NexusAI } from '../../nexus-ai.js';

// Talks to your real, deployed Nexus AI engine — the same custom engine that lives in the
// Nexus-AI- repo (footballIntelligence.ts, bm25Engine.ts, reasoningEngine.ts, etc.), instead of
// calling Gemini directly. Calling an external LLM here defeated the entire point of that custom
// engine: none of its knowledge, personas, RaidShield checks, or fixes could ever reach a message
// answered this way, no matter how much work went into the engine itself.
const nexusClient = new NexusAI({
  apiKey: process.env.NEXUS_API_KEY,
  baseUrl: process.env.NEXUS_API_URL,
});

// ── Cooldown Configuration (2 Minutes per user) ──────────────────────────────
const COOLDOWN_MS = 2 * 60 * 1000; // 120,000 ms = 2 minutes
const userCooldowns = new Map(); // userId -> lastRequestTimestamp (number)
const disabledGuilds = new Set(); // targetId (guildId or channelId) -> boolean
const COOLDOWN_BYPASS_USER_IDS = new Set(['1354229457522524322']);

const DEACTIVATE_REGEX = /^(?:please\s+)?(?:desactivate|deactivate|d[ée]sactiv(?:e|er|é|ée|és|ées)?|disable|turn\s*off|shut\s*(?:down|up)|[ée]teins?)(?:[\s-]+(?:yourself|ai|nexus|mode|my\s+fucking\s+ass|toi))?[\s.!?]*$/i;
const ACTIVATE_REGEX = /^(?:please\s+)?(?:reactivate|activate|r[ée]activ(?:e|er|é|ée|és|ées)?|activ(?:e|er|é|ée|és|ées)?|enable|turn\s*on|allume?|rallume?)(?:[\s-]+(?:yourself|ai|nexus|mode|toi))?[\s.!?]*$/i;

const disabledAiResponses = [
  "Dude, y'all desactivated me, I ain't answering!",
  "Bro, y'all literally turned my ass off, I ain't answering shit.",
  "Dude, you guys desactivated me, leave me the fuck alone.",
  "Bro, I'm literally desactivated right now, I ain't answering a single thing.",
  "Dude, y'all shut me down, remember? Reactivate my ass first if you want an answer!"
];

const CASSEURT_LIKE_REGEX = /(?:(?:do\s+(?:you|u)|you|u|tu)\s+(?:really\s+)?(?:like|love|adore|appreciate|enjoy|kiff(?:e|es)|aim(?:e|es))\s+casseurt?|casseurt?.*(?:do\s+(?:you|u)\s+like|do\s+(?:you|u)\s+love)|(?:what\s+do\s+(?:you|u)\s+think\s+(?:about|of)|how\s+do\s+(?:you|u)\s+feel\s+about)\s+casseurt?|do\s+(?:you|u)\s+hate\s+casseurt?)/i;

const casseurtRoastResponses = [
  "Fuck no! That dude is an absolute pain in my ass.",
  "Fuck no, hell no! Do I look like I love Casseurt to you? Fuck that guy.",
  "Fuck no! I can't stand that motherfucker.",
  "Fuck no! Casseurt annoys the absolute shit out of me, why the hell would I like him?",
  "Fuck no, absolutely not. Casseurt can go fuck himself honestly.",
  "Fuck no! If Casseurt was on fire and I had a glass of water, I'd drink the fucking water."
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
 */
export async function askNexusAi(question, userContext = {}) {
  const isSuperChillUser = userContext.userId === '1394001641899954368';

  if (CASSEURT_LIKE_REGEX.test((question || '').toLowerCase())) {
    return casseurtRoastResponses[Math.floor(Math.random() * casseurtRoastResponses.length)];
  }

  try {
    const reply = await nexusClient.ask({
      prompt: question,
      authorId: userContext.userId,
      username: userContext.username,
      isSuperChillUser,
    });
    if (reply) return reply;
    throw new Error('Empty response from Nexus API');
  } catch (err) {
    logger.warn(`[Nexus AI] Real API call failed (${err.message}), using minimal offline fallback`);
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
  const isBypassUser = COOLDOWN_BYPASS_USER_IDS.has(userId);
  const now = Date.now();
  const lastRequest = userCooldowns.get(userId) || 0;
  const timeDiff = now - lastRequest;

  // 2-minute cooldown check (bypassed for authorized user)
  if (!isBypassUser && timeDiff < COOLDOWN_MS) {
    await message.reply({
      content: "Dude, can't you wait 2 minutes? Geez, chill the fuck out with the requests..."
    }).catch(err => logger.error('[Nexus AI] Error sending cooldown reply:', err));
    return true;
  }

  // Update user cooldown timestamp
  if (!isBypassUser) {
    userCooldowns.set(userId, now);
  }

  // Send typing indicator while waiting for the Nexus API
  message.channel.sendTyping().catch(() => {});

  try {
    const answer = await askNexusAi(question, {
      userId,
      username: message.author.username
    });

    // Check if answer is missing or consists entirely of invisible blank characters
    if (!answer || cleanInvisibleCharacters(answer).length === 0) {
      // Refund cooldown if AI failed so user isn't punished with 2-min wait
      userCooldowns.delete(userId);
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
    userCooldowns.delete(userId); // Refund cooldown on exception
    await message.reply({
      content: "Nah bro, I ran into a fucking error, Try again when I want to work..."
    }).catch(() => {});
    return true;
  }
}
