import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../utils/logger.js';
import { NexusAI } from '../../nexus-ai.js';
import { getUserMemories, saveUserMemory, forgetUserMemories } from './memoryBrainService.js';
import { getChannelHistory, recordChannelMessage, clearChannelHistory } from './channelHistoryService.js';
import { logTelemetry, logCrash, logPersonaTrigger } from './aiTelemetryService.js';
import { PermissionFlagsBits } from 'discord.js';

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

// "nexus forget me" / "forget everything about me" / "oublie-moi" — erases what Nexus stored about
// that user (memoryBrainService.js). forgetUserMemories existed but nothing ever called it, so there
// was no way for anyone to get their stored facts deleted.
const FORGET_ME_REGEX = /^(?:please\s+|pls\s+)?(?:forget\s+(?:everything\s+|all\s+)?(?:about\s+)?me|delete\s+(?:my\s+(?:data|memories|info)|everything\s+(?:you\s+know\s+)?about\s+me)|oublie[- ]?(?:moi|tout\s+sur\s+moi))\b/i;

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
 * Sends a question to the real Nexus AI engine and returns the full result: the reply text, the
 * raw API payload (for telemetry), how long it took, and — when the real call failed — the error
 * plus the minimal offline fallback text to show instead.
 *
 * Cross-conversation memory (favorite team, preferred name, etc. — persisted per Discord user
 * between separate messages) is wired in here when `userContext.client` is provided. Passing
 * `client` is optional: any caller that doesn't provide one just skips memory loading/saving.
 */
async function requestNexusReply(question, userContext = {}) {
  const isSuperChillUser = userContext.userId === '1394001641899954368' || Boolean(userContext.isSuperChillUser);
  const hasMemoryAccess = Boolean(userContext.client && userContext.userId);
  const startedAt = Date.now();

  try {
    const memories = hasMemoryAccess
      ? await getUserMemories(userContext.client, userContext.userId)
      : [];
    // Nexus's "brain" — channelHistoryService.js's rolling per-channel buffer, recorded on EVERY
    // message in messageCreate.js (not just ones addressed to Nexus).
    const history = userContext.channelId
      ? getChannelHistory(userContext.channelId, undefined, { excludeMessageId: userContext.messageId })
      : [];
    const data = await nexusClient.askJSON({
      prompt: question,
      authorId: userContext.userId,
      username: userContext.username,
      isSuperChillUser,
      memories,
      history,
      // A Discord image attachment is forwarded to the engine's vision pipeline.
      imageUrl: userContext.imageUrl || '',
    });
    const reply = data?.response || data?.text || '';
    if (!reply) throw new Error('Empty response from Nexus API');
    if (hasMemoryAccess && data?.newMemory) {
      // Best-effort, fire-and-forget by design — a memory-persistence failure must never delay or
      // break the reply the user is actually waiting on.
      saveUserMemory(userContext.client, userContext.userId, data.newMemory).catch(() => {});
    }
    // Record Nexus's own reply too, tagged assistant — so the NEXT message in this channel has
    // this turn available as context.
    if (userContext.channelId) {
      recordChannelMessage(userContext.channelId, {
        authorId: userContext.client?.user?.id,
        username: 'Nexus',
        content: reply,
        isBot: true,
        // Which user's question this reply is actually answering — see channelHistoryService.js.
        replyToAuthorId: userContext.userId,
      });
    }
    return { reply, data, latencyMs: Date.now() - startedAt, error: null };
  } catch (err) {
    logger.warn(`[Nexus AI] Real API call failed (${err.message}), using minimal offline fallback`);
    // The engine rate-limits each Discord user (HTTP 429). That's not "the server is down", so the
    // user gets told to slow down instead of the misleading "can't reach my engine" text.
    const rateLimited = /HTTP 429/.test(err?.message || '');
    const reply = rateLimited
      ? "Whoa, slow the fuck down — you're asking faster than I can think. Try again in a few seconds."
      : generateOfflineFallbackResponse(question, userContext);
    return { reply, data: null, latencyMs: Date.now() - startedAt, error: err, rateLimited };
  }
}

/**
 * Sends a question to the real Nexus AI engine and returns plain text.
 * Falls back to the minimal offline response if the remote API call fails.
 */
export async function askNexusAi(question, userContext = {}) {
  const { reply } = await requestNexusReply(question, userContext);
  return reply;
}

// ─── 👍/👎 feedback tracking ─────────────────────────────────────────────────────────────────────
// messageReactionAdd.js forwards a 👎 on one of Nexus's replies to the guild's #negative-feedback
// telemetry channel (question + answer, for corpus fixes). Bounded in-memory map: a reply older
// than the most recent MAX_TRACKED_AI_REPLIES (or from before a restart) is simply not tracked.
const MAX_TRACKED_AI_REPLIES = 500;
const trackedAiReplies = new Map();

export function trackAiReply(messageId, entry) {
  if (!messageId) return;
  trackedAiReplies.set(messageId, entry);
  while (trackedAiReplies.size > MAX_TRACKED_AI_REPLIES) {
    trackedAiReplies.delete(trackedAiReplies.keys().next().value);
  }
}

// Messages deleted while an answer was being generated (fed by events/messageDelete.js). Bounded
// the same way as trackedAiReplies — only ever needs to cover the last few minutes of deletions.
const recentlyDeletedMessages = new Set();
export function markMessageDeleted(messageId) {
  if (!messageId) return;
  recentlyDeletedMessages.add(messageId);
  while (recentlyDeletedMessages.size > 1000) {
    recentlyDeletedMessages.delete(recentlyDeletedMessages.values().next().value);
  }
}
function wasRecentlyDeleted(messageId) {
  return recentlyDeletedMessages.has(messageId);
}

export function getTrackedAiReply(messageId) {
  return trackedAiReplies.get(messageId) || null;
}

// Replies must never be able to ping @everyone/@here, roles, or arbitrary users — the text comes
// from the AI, and a prompt like "say @everyone" would otherwise mass-ping the whole server.
const SAFE_REPLY_MENTIONS = { parse: [], repliedUser: true };

/**
 * Only people who can actually moderate the server (or the bot's VIP owner) may switch Nexus off
 * or on for everyone — otherwise any member could silence the AI for the whole guild.
 */
function canToggleNexus(message) {
  if (message.author?.id === '1394001641899954368') return true;
  if (!message.guild) return true; // DMs / group scopes: the user only affects themselves
  const perms = message.member?.permissions;
  return Boolean(perms && (perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.ManageMessages)));
}

/**
 * Posts the engine's per-reply telemetry (and any failure) to the guild's AI telemetry channels.
 * Every call here is fire-and-forget and never throws — see aiTelemetryService.js.
 */
function reportTelemetry(message, question, result) {
  const guildId = message.guild?.id;
  if (!guildId) return;
  const client = message.client;
  const promptSnippet = question.slice(0, 500);

  if (result.error) {
    if (!result.rateLimited) {
      logCrash(client, guildId, { input: promptSnippet, error: result.error, source: 'nexus-ai:chat' }).catch(() => {});
    }
    return;
  }

  const telemetry = result.data?.telemetry || null;
  logTelemetry(client, guildId, {
    latencyMs: telemetry?.latencyMs ?? result.latencyMs,
    language: telemetry?.language,
    temperature: telemetry?.temperature,
    swearFloorTriggered: telemetry?.swearFloorTriggered,
    promptSnippet,
  }).catch(() => {});

  if (telemetry?.llmFailureReason) {
    logCrash(client, guildId, {
      input: promptSnippet,
      error: new Error(`LLM failure: ${telemetry.llmFailureReason}`),
      source: 'nexus-ai:llm',
    }).catch(() => {});
  }
  if (telemetry?.swearFloorTriggered) {
    logPersonaTrigger(client, guildId, { type: 'swear_floor', promptSnippet }).catch(() => {});
  }
  if (telemetry?.triggered) {
    logPersonaTrigger(client, guildId, { type: 'meltdown', promptSnippet }).catch(() => {});
  }
}

export function defuseMassMentions(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/@(everyone|here)\b/gi, '@\u200b$1').replace(/<@&(\d+)>/g, '@\u200brole');
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
    // "do u like nexus" / "what do you think about nexus" / "is casseurt better than nexus": here
    // "nexus" is the OBJECT of the question (Nexus himself), not someone calling him — stripping it
    // sent the engine just "do u like" (live, 2026-09-30). Only a trailing call ("what is 2+2
    // nexus?", "you good, nexus") is stripped.
    const endsWithObjectWord = /\b(?:like|love|hate|respect|trust|rate|know|miss|fear|beat|marry|date|fight|kiss|kill|roast|about|of|with|for|to|than|is|are|was|think|prefer|trust|believe|support|help|smarter|better|worse|dumber|funnier)$/i.test(suffixMatch[1].trim()) && !/[,:!?\-]\s*$/.test(trimmed.slice(0, trimmed.toLowerCase().lastIndexOf('nexus')));
    return { matched: true, question: endsWithObjectWord ? trimmed : suffixMatch[1].trim() };
  }

  return null;
}

/**
 * Same as parseNexusTrigger, plus: a Discord reply to one of Nexus's own answers counts as talking
 * to him, so people don't have to say "nexus" in a back-and-forth (asked in #feature-ideas).
 * Only replies to answers this process tracked (or that Discord marks as replying to the bot)
 * count, and the whole message is the question.
 */
export function resolveNexusTrigger(message) {
  const botUserId = message.client?.user?.id;
  const named = parseNexusTrigger(message.content, botUserId);
  if (named) return named;
  const refId = message.reference?.messageId;
  if (!refId || !message.content?.trim()) return null;
  const repliesToNexus = Boolean(getTrackedAiReply(refId)) || (botUserId && message.mentions?.repliedUser?.id === botUserId);
  return repliesToNexus ? { matched: true, question: message.content.trim() } : null;
}

/**
 * Handles incoming Discord messages addressing Nexus.
 * Returns true if the message was handled as a Nexus AI query, false otherwise.
 */
export async function handleNexusAiMessage(message) {
  if (message.author?.bot) return false;
  if (!message.content || typeof message.content !== 'string') return false;

  const botUserId = message.client?.user?.id;
  const triggerResult = resolveNexusTrigger(message);
  if (!triggerResult || !triggerResult.matched) return false;

  const rawQuestion = triggerResult.question || '';
  const printableCharacters = cleanInvisibleCharacters(rawQuestion);
  const targetScopeId = message.guild?.id || message.channel?.id || 'global';

  // Found missing entirely (2026-09-17): a message like "nexus what does this say" with an image
  // attached never looked at the attachment at all — the CDN URL just sat unused on
  // message.attachments while only the text question was ever sent to the AI engine, even though
  // Nexus-AI-'s /api/v1/nexus endpoint already has a real vision pipeline wired up and waiting for
  // exactly this. Takes the first image-type attachment only (a genuine multi-image message is
  // rare enough in practice, and the engine's own vision call only ever looks at one image anyway).
  const imageAttachment = message.attachments?.find((a) => a.contentType?.startsWith('image/'));
  const imageUrl = imageAttachment?.url || '';

  // Check for deactivation / reactivation triggers (e.g. "Nexus, desactivate", "@Nexus activate").
  const wantsDeactivate = DEACTIVATE_REGEX.test(rawQuestion.trim());
  const wantsActivate = !wantsDeactivate && ACTIVATE_REGEX.test(rawQuestion.trim());
  if (wantsDeactivate || wantsActivate) {
    if (!canToggleNexus(message)) {
      await message.reply({
        content: "Nice try bro, only the server mods get to flip my switch.",
        allowedMentions: SAFE_REPLY_MENTIONS,
      }).catch(err => logger.error('[Nexus AI] Error sending toggle-denied reply:', err));
      return true;
    }
    await setNexusAiDisabled(targetScopeId, message.client, wantsDeactivate);
    if (wantsDeactivate) {
      // Re-enabling later starts fresh instead of resurfacing stale pre-shutdown context.
      clearChannelHistory(message.channel.id);
    }
    await message.reply({
      content: wantsDeactivate
        ? "Alright, I'm desactivating my fucking ass."
        : "Alright, I'm back up, what the fuck do you want?",
      allowedMentions: SAFE_REPLY_MENTIONS,
    }).catch(err => logger.error('[Nexus AI] Error sending toggle reply:', err));
    return true;
  }

  if (FORGET_ME_REGEX.test(rawQuestion.trim())) {
    await forgetUserMemories(message.client, message.author?.id);
    await message.reply({
      content: /oublie/i.test(rawQuestion)
        ? "C'est fait, j'ai tout oublié ce que je savais sur toi. Qui t'es déjà, tabarnak?"
        : "Done, I wiped everything I remembered about you. Who the fuck are you again?",
      allowedMentions: SAFE_REPLY_MENTIONS,
    }).catch((err) => logger.error('[Nexus AI] Error sending forget-me reply:', err));
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

  // If user only pinged/said "nexus" or sent greeting with no question — UNLESS they attached an
  // image with no other text ("@Nexus" + a screenshot, no caption), which is a real, common way to
  // ask "what is this" — that case now falls through to the real question below instead of the
  // generic "why'd you mention me" filler, same as before this fix would have shown for a plain
  // text-only ping.
  if (printableCharacters.length === 0 && !imageUrl) {
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

  // A bare "@Nexus" + image with no caption still needs SOME prompt text for the engine's own
  // language/intent detection to run against — mirrors the same fallback Nexus-AI-'s server.ts
  // itself already uses when an image arrives with no accompanying user text.
  const question = rawQuestion.trim() || (imageUrl ? 'Analyze this uploaded image attachment' : '');

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
    // One complete, fully processed reply, sent once (no token-by-token streaming — the swear
    // floor / safety top-up only applies to the FINAL text). The typing indicator covers the wait.
    const result = await requestNexusReply(question, {
      userId,
      username: message.author.username,
      client: message.client,
      channelId: message.channel.id,
      messageId: message.id,
      imageUrl
    });
    // allowedMentions already stops the actual ping, but "@everyone" still showed as text in the
    // reply (live: a Casseurt rant said "he pings @everyone"). A zero-width space makes it plain text.
    const answer = defuseMassMentions(result.reply);

    // Moderation (AI moderation / RaidShield) runs concurrently and may have deleted the question
    // while the engine was thinking — don't answer a message staff just removed.
    if (wasRecentlyDeleted(message.id)) return true;
    reportTelemetry(message, question, result);

    // Check if answer is missing or consists entirely of invisible blank characters
    if (!answer || cleanInvisibleCharacters(answer).length === 0) {
      await message.reply({
        content: "Nah bro, I ran into a fucking error, Try again when I want to work...",
        allowedMentions: SAFE_REPLY_MENTIONS,
      }).catch(() => {});
      return true;
    }

    // The question may have been deleted by moderation while the engine was thinking — replying
    // to a deleted message would throw "Unknown message", so fall back to a plain channel send.
    const replyOptions = { failIfNotExists: false };
    const chunks = splitIntoChunks(answer);
    const firstMessage = await message.reply({
      content: chunks[0],
      allowedMentions: SAFE_REPLY_MENTIONS,
      ...replyOptions,
    });
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
    }

    // Every real AI reply is tracked, so ANY member reaction on it (💀, 😂, 👎...) can reach the
    // engine's learning system (messageReactionAdd.js). The 👍/👎 buttons themselves are still only
    // added where a #negative-feedback channel is configured, so other servers don't get two
    // reactions stuck on every AI reply.
    if (firstMessage && !result.error && message.guild) {
      trackAiReply(firstMessage.id, { guildId: message.guild.id, question, answer });
      const { getGuildConfig } = await import('./guildConfig.js');
      const config = await getGuildConfig(message.client, message.guild.id).catch(() => null);
      if (config?.aiTelemetry?.negativeFeedbackChannelId) {
        await firstMessage.react('👍').catch(() => {});
        await firstMessage.react('👎').catch(() => {});
      }
    }
    return true;
  } catch (error) {
    logger.error('[Nexus AI] Error handling message:', error);
    await message.reply({
      content: "Nah bro, I ran into a fucking error, Try again when I want to work...",
      allowedMentions: SAFE_REPLY_MENTIONS,
    }).catch(() => {});
    return true;
  } finally {
    clearInterval(typingInterval);
  }
}
