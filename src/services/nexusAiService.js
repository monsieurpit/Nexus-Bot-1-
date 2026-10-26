import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../utils/logger.js';
import { NexusAI } from '../../nexus-ai.js';
import { getUserMemories, saveUserMemory, forgetUserMemories } from './memoryBrainService.js';
import { getChannelHistory, recordChannelMessage, clearChannelHistory } from './channelHistoryService.js';
import { logTelemetry, logCrash, logPersonaTrigger } from './aiTelemetryService.js';
import { PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
import { parseReactRequest, performReactRequest, REACT_FAIL_LINES } from './nexusReactService.js';

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

// Nexus's own words for the bot's system moments, written by the engine; the fixed lines below are only the fallback
// when the engine can't answer within a few seconds (Patrick, 2026-10-04: "make sure there are no hardcoded answers").
export async function voiced(situation, fallback) {
  const line = await nexusClient.voiceLine(situation).catch(() => null);
  return line || fallback;
}

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

// Server context for the engine's helper specialist (Patrick, 2026-10-05: translations, staff applications, server
// management — "prioritize server context, staff hierarchy"). Built from Discord's own data, nothing to configure:
// server name, member count, channel, the asker's roles + staff permissions, and the staff role ladder (roles with
// moderation permissions, highest first). Never throws; null outside a server.
const STAFF_PERMISSIONS = ['Administrator', 'ManageGuild', 'ManageRoles', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages', 'ManageChannels'];
export function buildServerContext(message) {
  try {
    const guild = message?.guild;
    if (!guild) return null;
    const perms = (holder) => STAFF_PERMISSIONS.filter((p) => holder?.permissions?.has?.(PermissionFlagsBits[p]));
    const staffRoles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && !r.managed && perms(r).length)
      .sort((a, b) => b.position - a.position)
      .slice(0, 12)
      .map((r) => ({ name: r.name, members: r.members?.size ?? null, permissions: perms(r) }));
    const member = message.member;
    return {
      serverName: guild.name,
      memberCount: guild.memberCount ?? null,
      channel: message.channel?.name || null,
      askerIsOwner: guild.ownerId === message.author?.id,
      askerRoles: member ? [...member.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).slice(0, 8).map((r) => r.name) : [],
      askerStaffPermissions: perms(member),
      staffRoles,
      // The room (2026-10-18, "maxed-out human" phase 4): the last few lines in this channel from OTHER people (and his own),
      // so "what do u think of that" / "he's lying" / "lmaooo" make sense. The engine only uses it when the message points
      // at the room — a plain "nexus …" question still starts fresh (Patrick, 2026-10-01).
      // 2026-10-20 (room summary): the last 20 from everyone — the asker's own earlier lines too (self), how long ago, and who
      // each one was aimed at (replyTo / mentions) — so the engine knows who's talking to whom, about what, in what mood.
      room: getChannelHistory(message.channel?.id, 24, { excludeMessageId: message.id })
        .filter((m) => m.content && m.content.trim())
        .slice(-20)
        .map((m) => ({
          name: m.role === 'assistant' ? 'Nexus' : m.username || 'someone',
          // who they are to him (the engine's who's who: a regular, new, back after days)
          id: m.role === 'assistant' ? undefined : m.authorId,
          text: String(m.content).replace(/\s+/g, ' ').slice(0, 160),
          isNexus: m.role === 'assistant',
          self: m.role !== 'assistant' && m.authorId === message.author?.id,
          ago: m.timestamp ? Math.max(0, Math.round((Date.now() - m.timestamp) / 1000)) : undefined,
          replyTo: m.replyToUsername || undefined,
          mentions: m.mentions?.length ? m.mentions : undefined,
        })),
    };
  } catch {
    return null;
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
export async function requestNexusReply(question, userContext = {}) {
  const isSuperChillUser = userContext.userId === '1394001641899954368' || Boolean(userContext.isSuperChillUser);
  const hasMemoryAccess = Boolean(userContext.client && userContext.userId);
  const startedAt = Date.now();

  try {
    const memories = hasMemoryAccess
      ? await getUserMemories(userContext.client, userContext.userId)
      : [];
    // Nexus's "brain" — channelHistoryService.js's rolling per-channel buffer, recorded on EVERY
    // message in messageCreate.js (not just ones addressed to Nexus).
    // The recent conversation is only used when the user REPLIED to one of Nexus's messages (Patrick,
    // 2026-10-01): a plain "nexus ..." mention starts fresh. Callers that do not say (useHistory unset)
    // keep the old behavior.
    const history = userContext.channelId && userContext.useHistory !== false
      ? getChannelHistory(userContext.channelId, undefined, { excludeMessageId: userContext.messageId })
      : [];
    // The message being replied to is always given to the engine (Patrick, 2026-10-04: he replied "why are you
    // scratching your balls" to a /say message and Nexus had no idea he'd said it, so he answered with medical facts;
    // "summarise this" on a reply needs the replied-to text too). It goes last, as the most recent message.
    const ref = userContext.referencedMessage;
    if (ref?.content?.trim()) {
      const already = history.some((m) => m.content === ref.content.trim().slice(0, 1000));
      if (!already) {
        history.push({
          role: ref.isBot ? 'assistant' : 'user',
          content: ref.content.trim().slice(0, 1500),
          authorId: ref.authorId,
          username: ref.username,
          replyToAuthorId: ref.isBot ? userContext.userId : undefined,
        });
      }
    }
    const data = await nexusClient.askJSON({
      prompt: question,
      // what they replied to, said plainly (not just the last history line)
      replyTo: ref?.content?.trim() || ref?.imageUrl || ref?.videoUrl ? { name: ref.isBot ? 'Nexus' : ref.username || 'someone', text: ref.content?.trim() ? ref.content.trim().slice(0, 500) : ref.videoUrl ? '(posted a video)' : '(posted a picture)', isNexus: Boolean(ref.isBot) } : undefined,
      authorId: userContext.userId,
      username: userContext.username,
      isSuperChillUser,
      memories,
      history,
      // A Discord image attachment is forwarded to the engine's vision pipeline.
      imageUrl: userContext.imageUrl || '',
      videoUrl: userContext.videoUrl || '',
      imageFrom: userContext.imageFrom || undefined,
      serverContext: userContext.serverContext || null,
      unprompted: userContext.unprompted === true,
      openMode: userContext.openMode === true,
      openChecked: userContext.openChecked === true,
      strike: userContext.strike === true,
      // the channel is age-restricted (Discord's NSFW flag) — the only place adult / gore pictures may be posted
      channelNsfw: userContext.channelNsfw === true,
    });
    let reply = data?.response || data?.text || '';
    // a realistic picture comes alone, with no text (engine v2/photoEngine.ts) — that's a real answer, not an empty one
    const hasPicture = Array.isArray(data?.images) && data.images.length > 0;
    if (!reply && !hasPicture) throw new Error('Empty response from Nexus API');
    // Personal memory (2026-10-11): the engine attaches its privacy notice the first time someone talks to Nexus after the
    // update. It's DMed once (they started the interaction, so it isn't an unsolicited mass DM); if their DMs are closed,
    // a small line goes under the reply instead.
    if (typeof data?.privacyNotice === 'string' && data.privacyNotice && userContext.client && userContext.userId) {
      const sent = await Promise.race([
        userContext.client.users.fetch(userContext.userId).then((u) => u.send({ content: data.privacyNotice.slice(0, 1900), allowedMentions: { parse: [] } })).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 4000)),
      ]).catch(() => false);
      if (!sent) reply += '\n-# 🗂️ Nexus now remembers what you send him so he can banter properly. Say "nexus stop saving my messages" to turn it off — details in the Privacy Policy on the Nexus AI website.';
    }
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
      ? await voiced('rate-limited', "Whoa, slow the fuck down — you're asking faster than I can think. Try again in a few seconds.")
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

// The engine's message parts, if they're usable: 2-3 short non-empty parts that together are the whole answer (the bot
// never drops words — if anything looks off, the answer goes as one message like before).
// The engine's drawn pictures ([{ mime, name, data(base64) }]) as Discord attachments — only real PNG/JPEG/WebP, ≤ 7 MB, max 3.
const lastStrikeAt = new Map(); // channelId → last "on strike" rant

export function pictureFiles(images) {
  if (!Array.isArray(images)) return [];
  const out = [];
  for (const img of images.slice(0, 3)) {
    if (!img || typeof img.data !== 'string' || !/^image\/(?:png|jpeg|webp)$/.test(img.mime || '')) continue;
    const buf = Buffer.from(img.data, 'base64');
    if (!buf.length || buf.length > 9.5 * 1000 * 1000) continue; // Discord's 10 MB limit (the engine already keeps them ≤ 8 MB)
    const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/jpeg' ? 'jpg' : 'webp';
    out.push(new AttachmentBuilder(buf, { name: `${String(img.name || 'nexus-drawing').replace(/[^\w.-]/g, '').replace(/\.\w+$/, '') || 'nexus-drawing'}.${ext}` }));
  }
  return out;
}

export function humanParts(parts, answer) {
  if (!Array.isArray(parts)) return null;
  // An emoji back for a pure reaction ("lol" → "💀") is a whole answer on its own.
  if (parts.length === 1 && /^(?:\p{Extended_Pictographic}\uFE0F?){1,3}$/u.test(String(parts[0] || '').trim())) return [String(parts[0]).trim()];
  if (parts.length < 2 || parts.length > 6) return null; // up to 6: begging comes in bursts ("WAIT WHAT" / "NO PLEASE DELETE THAT" / …)
  const clean = parts.map((p) => defuseMassMentions(String(p || '')).trim());
  if (clean.some((p) => !p || p.length > 1900)) return null;
  const squash = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (squash(clean.join('')) === squash(answer)) return clean;
  // a slip + its fix as the last message ("Olmi was cooking" / "*Olmo", "seriosuly" / "*seriously", 2026-10-20): the rest
  // must be the answer with just that one word changed (same length, at most 2 letters different)
  const last = clean[clean.length - 1];
  if (clean.length >= 2 && /^\*\S{2,30}$/.test(last)) {
    const a = squash(clean.slice(0, -1).join('')), b = squash(answer);
    if (a.length === b.length && [...a].filter((c, i) => c !== b[i]).length <= 2 && b.includes(squash(last))) return clean;
  }
  return null;
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
    let chunk = remaining.substring(0, splitIdx).trim();
    remaining = remaining.substring(splitIdx).trim();
    // Split inside a ``` code block (long code, long binary): close it here and reopen it in the next message with the
    // same language, so both messages render as code (2026-10-11).
    const fences = chunk.match(/```/g) || [];
    if (fences.length % 2 === 1) {
      const lastOpen = chunk.lastIndexOf('```');
      const lang = (chunk.slice(lastOpen + 3).match(/^[\w+#-]*/) || [''])[0];
      chunk += '\n```';
      remaining = '```' + lang + '\n' + remaining;
    }
    chunks.push(chunk);
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

  // 4. "nexus" written in Morse code (-. . -..- ..- ...), anywhere as a word (Patrick, 2026-10-12: talking to Nexus in
  // Morse). Phones turn - into — / – and . into • / ·. The whole message goes to the engine, which decodes it and
  // answers in Morse.
  const morseWords = trimmed.replace(/[—–‒−_]/g, '-').replace(/[•·∙⋅]/g, '.').split(/\s*[/|]\s*|\s{3,}/).map((w) => w.trim().replace(/\s+/g, ' '));
  if (morseWords.includes('-. . -..- ..- ...')) {
    return { matched: true, question: trimmed };
  }

  return null;
}

/**
 * True when the message is a Discord reply to one of Nexus's own messages (one this process tracked, or one
 * Discord marks as replying to the bot). Only then does Nexus look at the recent conversation.
 */
// The picture / clip a message carries (2026-10-20, "images MAX priority"): its own image attachment, a video attachment, a
// GIF / link embed's picture (Tenor, Giphy, Imgur, a link preview), or a sticker. Before, only the message's OWN attachment
// was ever sent — "what is it from" / "what's dis" as a REPLY to someone's image got no image at all.
export function mediaOf(msg) {
  const att = [...(msg?.attachments?.values?.() || [])];
  const img = att.find((a) => a.contentType?.startsWith('image/'));
  if (img) return { imageUrl: img.url, videoUrl: '', kind: 'attachment' };
  const vid = att.find((a) => a.contentType?.startsWith('video/') && (a.size || 0) <= 100 * 1024 * 1024);
  if (vid) return { imageUrl: '', videoUrl: vid.url, kind: 'attachment' };
  for (const e of msg?.embeds || []) {
    const u = e.image?.url || e.thumbnail?.url;
    if (u && /^https?:\/\//.test(u)) return { imageUrl: u, videoUrl: '', kind: 'embed' };
  }
  const st = [...(msg?.stickers?.values?.() || [])].find((x) => x.format !== 3 && x.url); // 3 = Lottie (not an image)
  if (st) return { imageUrl: st.url, videoUrl: '', kind: 'sticker' };
  return { imageUrl: '', videoUrl: '', kind: '' };
}

// The message this one replies to, as { content, authorId, username, isBot, imageUrl, videoUrl } (null when not a reply or not fetchable).
export async function getReferencedMessage(message) {
  if (!message?.reference?.messageId) return null;
  try {
    const ref = await message.fetchReference();
    if (!ref) return null;
    const text = [ref.content, ...(ref.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(': '))].filter(Boolean).join('\n').trim();
    const media = mediaOf(ref);
    if (!text && !media.imageUrl && !media.videoUrl) return null;
    return { content: text, authorId: ref.author?.id, username: ref.author?.username, isBot: ref.author?.id === message.client?.user?.id, imageUrl: media.imageUrl, videoUrl: media.videoUrl, mediaKind: media.kind };
  } catch {
    return null;
  }
}

export function isReplyToNexus(message) {
  const refId = message?.reference?.messageId;
  if (!refId) return false;
  const botUserId = message.client?.user?.id;
  return Boolean(getTrackedAiReply(refId)) || Boolean(botUserId && message.mentions?.repliedUser?.id === botUserId);
}

/**
 * The trigger check for a message: it has to say "nexus" (start or end) or ping him. Replying to one of his messages
 * does NOT trigger him anymore (it only gives him the recent conversation, see isReplyToNexus).
 */
export function resolveNexusTrigger(message) {
  // Patrick (2026-10-19): "every time we answer to his message he answers" — a Discord reply to one of his messages is
  // talking to him, no "nexus" needed (this replaces the 2026-10-01 rule that a reply alone wasn't enough).
  const named = parseNexusTrigger(message.content, message.client?.user?.id);
  if (named) return named;
  if (isReplyToNexus(message) && String(message.content || '').trim()) return { matched: true, question: message.content.trim() };
  return null;
}

/**
 * Handles incoming Discord messages addressing Nexus.
 * Returns true if the message was handled as a Nexus AI query, false otherwise.
 */
export async function handleNexusAiMessage(message, opts = {}) {
  if (message.author?.bot) return false;
  if (!message.content || typeof message.content !== 'string') return false;

  const botUserId = message.client?.user?.id;
  // Open mode (nexusOpenModeService.js): nobody said "nexus" — the whole message is what he answers, and he stays silent
  // whenever it doesn't work out (PASS, an error, a busy engine) instead of posting an error to a message not aimed at him.
  const openMode = opts.openMode === true;
  const triggerResult = openMode ? { matched: true, question: message.content } : resolveNexusTrigger(message);
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
  // Videos (2026-10-05): the engine downloads the attachment and analyses it (metadata, 12 frames, speech transcript;
  // ~20-30 s for a 2-minute clip). Max 100 MB.
  // 2026-10-20: also a GIF / link embed's picture, a sticker, and — when the message has none — the one in the message it
  // REPLIES to (imageFrom tells the engine which: 'own' | 'embed' | 'sticker' | 'reply').
  const ownMedia = mediaOf(message);
  const refMessage = await getReferencedMessage(message);
  const useRefMedia = !ownMedia.imageUrl && !ownMedia.videoUrl;
  const imageUrl = ownMedia.imageUrl || (useRefMedia ? refMessage?.imageUrl || '' : '');
  const videoUrl = ownMedia.videoUrl || (useRefMedia && !imageUrl ? refMessage?.videoUrl || '' : '');
  const imageFrom = ownMedia.imageUrl || ownMedia.videoUrl ? (ownMedia.kind === 'attachment' ? 'own' : ownMedia.kind) : imageUrl || videoUrl ? 'reply' : '';

  // Check for deactivation / reactivation triggers (e.g. "Nexus, desactivate", "@Nexus activate").
  const wantsDeactivate = !openMode && DEACTIVATE_REGEX.test(rawQuestion.trim());
  const wantsActivate = !wantsDeactivate && ACTIVATE_REGEX.test(rawQuestion.trim());
  if (wantsDeactivate || wantsActivate) {
    if (!canToggleNexus(message)) {
      await message.reply({
        content: await voiced('toggle-denied', "Nice try bro, only the server mods get to flip my switch."),
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
        ? await voiced('deactivate', "Alright, I'm desactivating my fucking ass.")
        : await voiced('activate', "Alright, I'm back up, what the fuck do you want?"),
      allowedMentions: SAFE_REPLY_MENTIONS,
    }).catch(err => logger.error('[Nexus AI] Error sending toggle reply:', err));
    return true;
  }

  // "forget me": the bot's own small fact list is cleared here, then the message goes on to the engine, which deletes the
  // personal memory (saved messages + profile) and answers (2026-10-11).
  const forgetMe = !openMode && FORGET_ME_REGEX.test(rawQuestion.trim());
  if (forgetMe) {
    await forgetUserMemories(message.client, message.author?.id);
  }

  // If AI is currently disabled in this guild/channel, do not process regular prompts and notify the user
  const isDisabled = await isNexusAiDisabled(targetScopeId, message.client);
  if (isDisabled && openMode) return false;
  if (isDisabled) {
    // ON STRIKE (2026-10-25, Patrick): switched off here, someone talks to him anyway → he rants that Casseurt hasn't paid him,
    // written by the engine as a burst of messages. Once per channel every 10 min; otherwise he stays quiet (no spam).
    const ch = message.channel?.id || 'x';
    if (Date.now() - (lastStrikeAt.get(ch) || 0) < 10 * 60_000) return true;
    lastStrikeAt.set(ch, Date.now());
    const r = await requestNexusReply(rawQuestion || 'nexus', { userId: message.author?.id, username: message.author?.username, client: message.client, channelId: ch, messageId: message.id, strike: true }).catch(() => null);
    const parts = humanParts(r?.data?.parts, r?.reply || '') || (r?.reply ? [r.reply] : null);
    if (!parts || r?.error) {
      const randomDisabledMsg = disabledAiResponses[Math.floor(Math.random() * disabledAiResponses.length)];
      await message.reply({ content: await voiced('disabled', randomDisabledMsg), allowedMentions: SAFE_REPLY_MENTIONS }).catch(() => {});
      return true;
    }
    await message.reply({ content: defuseMassMentions(parts[0]).slice(0, 1900), allowedMentions: SAFE_REPLY_MENTIONS, failIfNotExists: false }).catch(() => {});
    for (const p of parts.slice(1)) {
      message.channel.sendTyping().catch(() => {});
      await new Promise((res) => setTimeout(res, Math.min(2500, Math.max(500, p.length * 35))));
      await message.channel.send({ content: defuseMassMentions(p).slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
    }
    return true;
  }

  const userId = message.author?.id;

  // If user only pinged/said "nexus" or sent greeting with no question — UNLESS they attached an
  // image with no other text ("@Nexus" + a screenshot, no caption), which is a real, common way to
  // ask "what is this" — that case now falls through to the real question below instead of the
  // generic "why'd you mention me" filler, same as before this fix would have shown for a plain
  // text-only ping.
  // A bare "nexus" / "@Nexus" with nothing else is answered by the engine like any other message (it greets back in
  // its own words) instead of the old hardcoded "why the fuck did you mention my name?" line (2026-10-04).
  const bareMention = printableCharacters.length === 0 && !imageUrl && !videoUrl;

  // A bare "@Nexus" + image with no caption still needs SOME prompt text for the engine's own
  // language/intent detection to run against — mirrors the same fallback Nexus-AI-'s server.ts
  // itself already uses when an image arrives with no accompanying user text.
  // "<@123456>" means nothing to the model: user mentions become "@username" (2026-10-04: "should we invite <@id> to
  // our goon party?" got "who even is <@123>?"). Role/channel mentions become their names too.
  const namedQuestion = rawQuestion
    .replace(/<@!?(\d+)>/g, (m, id) => {
      const user = message.mentions?.users?.get(id);
      return user ? `@${message.guild?.members?.cache?.get(id)?.displayName || user.username}` : m;
    })
    .replace(/<@&(\d+)>/g, (m, id) => {
      const role = message.mentions?.roles?.get(id) || message.guild?.roles?.cache?.get(id);
      return role ? `@${role.name}` : m;
    })
    .replace(/<#(\d+)>/g, (m, id) => {
      const channel = message.mentions?.channels?.get(id) || message.guild?.channels?.cache?.get(id);
      return channel ? `#${channel.name}` : m;
    });
  const question = namedQuestion.trim() || (imageUrl ? (imageFrom === 'reply' ? 'what do you think of this?' : 'Analyze this uploaded image attachment') : videoUrl ? 'what do you think of this video?' : bareMention ? 'nexus' : '');

  // "nexus react 💀 to that": a real reaction, done here (nexusReactService.js) — he only says it worked if it did.
  const reactReq = !imageUrl && !videoUrl ? parseReactRequest(question) : null;
  if (reactReq) {
    const done = await performReactRequest(message, reactReq);
    logger.info(`[nexusReact] ${done.ok ? 'reacted' : `failed (${done.reason})`} ${reactReq.emoji || reactReq.customName} for ${message.author.id}`);
    if (!done.ok) await message.reply({ content: REACT_FAIL_LINES[done.reason] || REACT_FAIL_LINES['api-error'], allowedMentions: SAFE_REPLY_MENTIONS, failIfNotExists: false }).catch(() => {});
    else if (done.target?.id !== message.id) await message.react('👍').catch(() => {});
    return true;
  }

  // Open mode: decide FIRST, silently — "Nexus is typing…" only shows once he's actually going to reply (Patrick,
  // 2026-10-19: seeing him type for messages he then ignored was annoying).
  let openChecked = false;
  if (openMode) {
    const verdict = await nexusClient.openCheck({ message: question, username: message.author.username, room: buildServerContext(message)?.room || [], signals: opts.openSignals || {} }).catch(() => null);
    if (!verdict?.reply) {
      logger.debug(`[openMode] stays out: ${verdict?.why || 'check failed'}`);
      return false;
    }
    openChecked = true;
  }

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
    // Nobody gets "slow down" any more: every message waits its turn in the engine's queue, and anyone who'd be 5th or
    // later in line is told it might take a bit longer (Patrick, 2026-10-04).
    const queue = await Promise.race([
      nexusClient.getQueueStatus().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    const ahead = queue ? Number(queue.aheadOfNewRequest ?? (queue.pendingInWaitlist || 0) + (queue.runningNow || 0)) || 0 : 0;
    // open mode never adds to a busy engine — people who called him by name come first
    if (openMode && ahead >= 2) return false;
    if (ahead >= 4 && !openMode) {
      const eta = Number(queue?.estimatedWaitSeconds) || 0;
      await message.reply({
        content: `⏳ lots of people are talking to me rn — you're #${ahead + 1} in line, so my answer might take a bit longer${eta ? ` (~${Math.max(5, eta)}s)` : ''}. hang tight.`,
        allowedMentions: SAFE_REPLY_MENTIONS,
      }).catch(() => {});
    }

    const result = await requestNexusReply(question, {
      userId,
      username: message.author.username,
      client: message.client,
      channelId: message.channel.id,
      messageId: message.id,
      useHistory: isReplyToNexus(message),
      referencedMessage: refMessage,
      imageUrl,
      videoUrl,
      imageFrom,
      serverContext: buildServerContext(message),
      openMode,
      openChecked,
      channelNsfw: message.channel?.nsfw === true || message.channel?.parent?.nsfw === true,
    });
    if (openMode && (result.error || !String(result.reply || '').trim() || /^\s*PASS\b/i.test(String(result.reply || '')))) return false;
    // "PASS" is the engine's "stay out of it" word — never a message, in any mode (2026-10-20: posted as a reply)
    if (/^\s*PASS\b\W*$/i.test(String(result.reply || ''))) return false;
    // allowedMentions already stops the actual ping, but "@everyone" still showed as text in the
    // reply (live: a Casseurt rant said "he pings @everyone"). A zero-width space makes it plain text.
    // "forget me" while the engine is down: the bot's own facts ARE wiped, so say so instead of "can't reach my engine" —
    // and ask for it again later, since the saved messages live on the engine.
    if (forgetMe && result.error && !result.rateLimited) {
      result.reply = "done, wiped everything i had on you here. my engine's down rn tho, say \"nexus forget me\" again in a bit so ur saved messages go too";
    }
    const answer = defuseMassMentions(result.reply);

    // Moderation (AI moderation / RaidShield) runs concurrently and may have deleted the question
    // while the engine was thinking — don't answer a message staff just removed.
    if (wasRecentlyDeleted(message.id)) return true;
    reportTelemetry(message, question, result);

    // Check if answer is missing or consists entirely of invisible blank characters
    // (a picture he drew / made comes with no text on purpose — that's a real answer, sent as an attachment below)
    const hasPicture = pictureFiles(result.data?.images).length > 0;
    if (!hasPicture && (!answer || cleanInvisibleCharacters(answer).length === 0)) {
      await message.reply({
        content: await voiced('error', "Nah bro, I ran into a fucking error, Try again when I want to work..."),
        allowedMentions: SAFE_REPLY_MENTIONS,
      }).catch(() => {});
      return true;
    }

    // The question may have been deleted by moderation while the engine was thinking — replying
    // to a deleted message would throw "Unknown message", so fall back to a plain channel send.
    const replyOptions = { failIfNotExists: false };
    // Texting like a person (engine v2/texting.ts, 2026-10-13): a short chat reply can come as 2-3 messages ("nah" …
    // "ur cooked"), each after a typing pause as long as it takes to type it; a long answer is still split by length.
    // A picture he drew (engine v2/drawEngine.ts, 2026-10-21): sent as a real attachment so it shows in the channel, with his line as the text.
    const drawn = pictureFiles(result.data?.images);
    if (drawn.length) {
      await message.reply({ ...(answer ? { content: answer.slice(0, 1900) } : {}), files: drawn, allowedMentions: SAFE_REPLY_MENTIONS, ...replyOptions }).catch(async () => {
        await message.channel.send({ ...(answer ? { content: answer.slice(0, 1900) } : {}), files: drawn, allowedMentions: { parse: [] } });
      });
      return true;
    }
    const parts = humanParts(result.data?.parts, answer);
    const chunks = parts || splitIntoChunks(answer);
    const firstMessage = await message.reply({
      content: chunks[0],
      allowedMentions: SAFE_REPLY_MENTIONS,
      ...replyOptions,
    });
    for (let i = 1; i < chunks.length; i++) {
      if (parts) {
        // Typing pace: ~40 ms a character, 0.6-3 s, with the typing indicator on.
        message.channel.sendTyping().catch(() => {});
        await new Promise((r) => setTimeout(r, Math.min(3000, Math.max(600, chunks[i].length * 40))));
      } else {
        // A short pause between parts: long answers (long code, long binary programs) arrive in order and stay well under
        // Discord's rate limit (2026-10-11).
        await new Promise((r) => setTimeout(r, 700));
      }
      await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
    }
    // Now and then he also reacts to their message (💀 😭) — on top of the reply, never instead of it.
    if (typeof result.data?.react === 'string' && /^\p{Extended_Pictographic}/u.test(result.data.react)) {
      message.react(result.data.react).catch(() => {});
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
      content: await voiced('error', "Nah bro, I ran into a fucking error, Try again when I want to work..."),
      allowedMentions: SAFE_REPLY_MENTIONS,
    }).catch(() => {});
    return true;
  } finally {
    clearInterval(typingInterval);
  }
}
