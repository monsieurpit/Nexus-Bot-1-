// Open mode (Patrick, 2026-10-19: "nexus analyses each and every message and answers ~75% of the time — but if someone
// talks to another person, he doesn't answer; make a command to enable that for servers"). Off by default; a server
// turns it on with /nexus-open. When on, every message in the server's chat channels is read and:
//   - talking to ANOTHER person (pings someone else, replies to someone else's message, starts / ends with another
//     member's name, a back-and-forth between two people) → he stays out of it;
//   - talking to HIM ("nexus …", a ping, a reply to one of his messages) → the normal path answers, always;
//   - open to the room → he answers ~75% of the time (little "lol" / emoji-only lines less often), and the engine can
//     still PASS when it isn't for him.
// Limits: one reply in progress per channel, a per-server cap per minute, never in ticket / staff / log channels.
import { logger } from '../utils/logger.js';
import { getChannelHistory } from './channelHistoryService.js';
import { isJumpInChannel } from './nexusJumpInService.js';

const KEY = (guildId) => `nexus:openmode:${guildId}`;
const CACHE_MS = 60_000;
const cache = new Map(); // guildId → { at, cfg }
export const DEFAULT_OPEN_MODE = { enabled: false, scope: 'chat' }; // scope: 'chat' (chat/general channels) | 'all'

export async function getOpenMode(client, guildId) {
  if (!guildId) return DEFAULT_OPEN_MODE;
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.cfg;
  let cfg = DEFAULT_OPEN_MODE;
  try {
    const v = await client?.db?.get?.(KEY(guildId));
    if (v && typeof v === 'object') cfg = { ...DEFAULT_OPEN_MODE, ...v };
  } catch {
    /* default: off */
  }
  cache.set(guildId, { at: Date.now(), cfg });
  return cfg;
}

export async function setOpenMode(client, guildId, cfg) {
  const next = { ...DEFAULT_OPEN_MODE, ...cfg };
  await client.db.set(KEY(guildId), next);
  cache.set(guildId, { at: Date.now(), cfg: next });
  return next;
}

// Never in these, whatever the scope (a "staff-chat" included).
const QUIET_CHANNEL_RE = /ticket|staff|mod|admin|log|announce|rule|partner|apply|application|welcome|verify|giveaway|report|appeal|support|vent|serious/i;
const TINY_RE = /^(?:l+m+f*a+o+|lo+l+|ha(?:ha)+|xd+|ok+|k+|w+|l+|fr+|real|true|bet|same|ikr|ye+s*|ya+|yeah|nah|no+|bruh+|bro+|damn|nice|💀+|😭+|😂+|🤣+|\p{Extended_Pictographic}|\s)+[!?.]*$/iu;

function nameVariants(member, user) {
  return [member?.displayName, member?.nickname, user?.globalName, user?.username]
    .filter(Boolean)
    .map((n) => String(n).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((n) => n.length >= 3);
}

/** Is this message aimed at someone other than Nexus? (Discord metadata + names + the back-and-forth.) */
export function talksToSomeoneElse(message, now = Date.now()) {
  const botId = message.client?.user?.id;
  const authorId = message.author?.id;
  // pings someone else / a role / everyone
  if ([...(message.mentions?.users?.keys?.() || [])].some((id) => id !== botId && id !== authorId)) return true;
  if ((message.mentions?.roles?.size || 0) > 0 || message.mentions?.everyone) return true;
  // a reply to someone else's message
  const repliedTo = message.mentions?.repliedUser?.id;
  if (message.reference?.messageId && repliedTo && repliedTo !== botId) return true;
  // starts / ends with another person's name ("josh u coming?", "u coming, josh")
  const text = String(message.content || '').toLowerCase().normalize('NFKD');
  const first = (text.match(/^[\s@]*([\p{L}\p{N}_.]{3,32})/u) || [])[1]?.replace(/[^\p{L}\p{N}]/gu, '');
  const last = (text.match(/[,\s]@?([\p{L}\p{N}_.]{3,32})[\s?!.]*$/u) || [])[1]?.replace(/[^\p{L}\p{N}]/gu, '');
  const recent = getChannelHistory(message.channel?.id, 20).filter((m) => m.role === 'user' && m.authorId && m.authorId !== authorId);
  const names = new Set();
  for (const m of recent) {
    const member = message.guild?.members?.cache?.get(m.authorId);
    for (const n of nameVariants(member, member?.user || { username: m.username })) names.add(n);
  }
  if ((first && names.has(first)) || (last && names.has(last))) return true;
  // a back-and-forth between them and ONE other person in the last ~90 s, Nexus not in it
  const lastFew = getChannelHistory(message.channel?.id, 4);
  if (lastFew.length >= 3 && lastFew.every((m) => m.role === 'user')) {
    const people = new Set(lastFew.map((m) => m.authorId));
    const alternates = lastFew.slice(1).every((m, i) => m.authorId !== lastFew[i].authorId);
    if (people.size === 2 && people.has(authorId) && alternates) return true;
  }
  return false;
}

// ── budget ──
const inFlightChannels = new Set();
const guildMinute = new Map(); // guildId → [times]
const GUILD_PER_MINUTE = 3; // was 10 — Patrick (2026-10-25): "Nexus answers too often and even to things he doesn't have context"
const CHANNEL_COOLDOWN_MS = 3 * 60_000; // one unprompted reply per channel every 3 min (unless he's already in the conversation)
const lastOpenReply = new Map(); // channelId → time of his last open-mode reply

// "that", "this", "he", "lmao same", "exactly" — a line that only makes sense if you saw what came before
const NEEDS_CONTEXT_RE = /^(?:(?:lmao|lol|bro|nah|yeah|ye|wait|ok|so|and|but)[\s,]+)*(?:that|this|it|its|it's|he|she|they|them|him|her|his|those|these|there|same|exactly|agreed|true|fr|real|facts|this\s+guy|that\s+guy|bro\s+what|what\s+happened|who(?:'s|s|\s+is|\s+was)\s+(?:that|this|he|she|they|him|her)|why\s+(?:tho|though)|did\s+(?:he|she|they)|is\s+(?:he|she|that)|was\s+(?:he|she|that))\b/i;

/** Is he part of this conversation right now? (he spoke in the last 2 min, among the channel's last few lines) */
function inConversation(message, now = Date.now()) {
  const botId = message.client?.user?.id;
  const last = getChannelHistory(message.channel?.id, 5);
  return last.some((m) => (m.role === 'assistant' || m.authorId === botId) && (!m.timestamp || now - m.timestamp < 120_000));
}

/** Other people have been talking among themselves (4+ lines, 2+ people, none from him) — he walked in late. */
function othersMidConversation(message) {
  const botId = message.client?.user?.id;
  const last = getChannelHistory(message.channel?.id, 6).filter((m) => m.authorId !== message.author?.id || true);
  if (last.length < 4) return false;
  if (last.some((m) => m.role === 'assistant' || m.authorId === botId)) return false;
  return new Set(last.map((m) => m.authorId)).size >= 2;
}

export function channelAllowed(channelName, scope = 'chat') {
  if (QUIET_CHANNEL_RE.test(channelName || '')) return false;
  return scope === 'all' ? true : isJumpInChannel(channelName);
}

/** Should he answer this (non-"nexus") message in open mode? Pure decision, no side effects except the dice. */
export function shouldAnswerOpen(message, cfg, rand = Math.random(), now = Date.now()) {
  if (!cfg?.enabled || !message?.guild || message.author?.bot) return { answer: false, why: 'off' };
  if (!channelAllowed(message.channel?.name, cfg.scope)) return { answer: false, why: 'channel' };
  const t = String(message.content || '').trim();
  const hasImage = Boolean(message.attachments?.some?.((a) => a.contentType?.startsWith('image/')));
  if (!t && !hasImage) return { answer: false, why: 'empty' };
  // another bot's command ("owo daily", "owo kill", "!play", "pls beg", ".rank") — not talk, never his business (2026-10-22 log)
  if (/^(?:owo|uwu|pls|dank|mudae)\s+\S/i.test(t) || /^(?:[!.$;%&+>\-]|[a-z]{1,2}!)[a-z]/i.test(t)) return { answer: false, why: 'bot-command' };
  const botId = message.client?.user?.id;
  // a Discord reply to one of his messages: always
  if (message.reference?.messageId && message.mentions?.repliedUser?.id === botId) return { answer: true, why: 'reply-to-nexus' };
  if (talksToSomeoneElse(message, now)) return { answer: false, why: 'someone-else' };
  const withHim = inConversation(message, now) || /\bnexus\b/i.test(t);
  // never butts in on "lol" / "bet" / "fr" unless he's the one they're talking with
  if (TINY_RE.test(t) && !withHim) return { answer: false, why: 'tiny' };
  if (!withHim) {
    // he'd need context he doesn't have
    if (NEEDS_CONTEXT_RE.test(t)) return { answer: false, why: 'no-context' };
    if (!/\?/.test(t) && t.split(/\s+/).length <= 3 && !hasImage) return { answer: false, why: 'too-short' };
    if (othersMidConversation(message)) return { answer: false, why: 'others-talking' };
    if (now - (lastOpenReply.get(message.channel?.id) || 0) < CHANNEL_COOLDOWN_MS) return { answer: false, why: 'cooldown' };
  }
  const chance = withHim ? 0.85 : 0.25; // was 0.75 for anything
  return rand < chance ? { answer: true, why: withHim ? 'in-conversation' : 'open' } : { answer: false, why: 'dice' };
}

/** The budget gate; call right before answering. Returns a release function, or null when over budget. */
export function takeSlot(message, now = Date.now()) {
  const ch = message.channel?.id;
  const g = message.guild?.id;
  if (!ch || !g || inFlightChannels.has(ch)) return null;
  const times = (guildMinute.get(g) || []).filter((x) => now - x < 60_000);
  if (times.length >= GUILD_PER_MINUTE) {
    guildMinute.set(g, times);
    return null;
  }
  guildMinute.set(g, [...times, now]);
  lastOpenReply.set(ch, now);
  inFlightChannels.add(ch);
  return () => inFlightChannels.delete(ch);
}

export function logDecision(message, d) {
  logger.debug(`[openMode] #${message.channel?.name}: ${d.answer ? 'answer' : 'skip'} (${d.why})`);
}

export const __test = { talksToSomeoneElse, shouldAnswerOpen, takeSlot, channelAllowed, inFlightChannels, guildMinute, cache, lastOpenReply, NEEDS_CONTEXT_RE };
