// Nexus jumps into chat on his own (2026-10-18, Patrick: "yes, rarely" — the "maxed-out human" plan, phase 5). A real
// member doesn't only talk when called: he jumps in when it's HIS kind of moment. Only those moments, rarely:
//   - someone talks ABOUT him in the third person ("nexus is trash fr") without calling him;
//   - Barça / Messi / Vardrid / Olise / F1 talk (his things);
//   - a roast going on between members;
//   - a real question nobody answered for 3 minutes.
// Budget: 1 per channel per 25 min, 6 per hour in a server, never in ticket / staff / log / announcement channels, never
// while the channel is busy with something serious. The engine can PASS (nothing worth adding) → he stays silent.
// Mode (NEXUS_JUMPIN): "dry" (default — logs what he WOULD have said, sends nothing) · "live" · "off".
import { logger } from '../utils/logger.js';
import { parseNexusTrigger, requestNexusReply, buildServerContext, trackAiReply } from './nexusAiService.js';
import { getChannelHistory } from './channelHistoryService.js';

const MODE = () => (process.env.NEXUS_JUMPIN || 'dry').toLowerCase();
const CHANNEL_COOLDOWN_MS = 25 * 60_000;
const GUILD_PER_HOUR = 6;
const QUIET_CHANNEL_RE = /ticket|staff|mod|admin|log|announce|rule|partner|apply|application|welcome|verify|giveaway|report|appeal|support|vent|serious/i;
const SERIOUS_RE = /\b(?:died|passed\s+away|funeral|suicid\w*|kill\s+myself|self[\s-]?harm|abus\w*|hospital|cancer|depress\w*|panic\s+attack|police|harass\w*)\b/i;

// Jump-ins only happen in channels whose name contains "chat" or "general" (Patrick, 2026-10-19) — whatever emojis,
// separators or fancy letters surround it: "💬┃general", "『chat』", "ɢᴇɴᴇʀᴀʟ-ᴄʜᴀᴛ", "General_Chat_2". Anywhere else he never jumps in.
const SMALL_CAPS = { 'ᴄ': 'c', 'ʜ': 'h', 'ᴀ': 'a', 'ᴛ': 't', 'ɢ': 'g', 'ᴇ': 'e', 'ɴ': 'n', 'ʀ': 'r', 'ʟ': 'l' };
export function isJumpInChannel(name) {
  const plain = String(name || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[ᴄʜᴀᴛɢᴇɴʀʟ]/g, (c) => SMALL_CAPS[c])
    .replace(/[^a-z]/g, '');
  return plain.includes('chat') || plain.includes('general');
}

const lastInChannel = new Map(); // channelId → time
const guildLog = new Map(); // guildId → [times]
const pendingQuestions = new Map(); // channelId → timer

export function candidateMoment(message, botUserId) {
  const t = (message.content || '').trim();
  if (!t || t.length < 6 || t.length > 400 || SERIOUS_RE.test(t)) return null;
  // Called directly → the normal path answers it, not this one.
  if (parseNexusTrigger(t, botUserId)) return null;
  if (/\bnexus\b/i.test(t)) return { kind: 'about-him', chance: 0.6 };
  if (/\b(?:bar[cç]a|barcelona|messi|vardrid|real\s+madrid|cl[aá]sico|yamal|olise|lewandowski|raphinha|pedri|verstappen|f1|formula\s*1)\b/i.test(t)) return { kind: 'his-thing', chance: 0.25 };
  return null;
}

// A roast going on: 3+ of the last 5 lines in the channel are jabs between at least 2 people.
const JAB_RE = /\b(?:ur\s+mum|your\s+mom|ur\s+mom|you'?re\s+(?:so\s+)?(?:dumb|trash|ugly|fat|mid)|ratio|L\s+bozo|cry\s+about\s+it|skill\s+issue|stfu|shut\s+up|fuck\s+(?:you|u|off)|ur\s+(?:trash|mid|bald|ugly))\b/i;
export function roastGoingOn(channelId) {
  const last = getChannelHistory(channelId, 5).filter((m) => m.role === 'user');
  const jabs = last.filter((m) => JAB_RE.test(m.content || ''));
  return jabs.length >= 3 && new Set(jabs.map((m) => m.authorId)).size >= 2;
}

function budgetOk(message, now = Date.now()) {
  const ch = message.channel?.id;
  const g = message.guild?.id;
  if (!ch || !g) return false;
  if (!isJumpInChannel(message.channel?.name)) return false;
  // (even a "staff-chat" / "ticket-chat" stays off limits)
  if (QUIET_CHANNEL_RE.test(message.channel?.name || '')) return false;
  if (now - (lastInChannel.get(ch) || 0) < CHANNEL_COOLDOWN_MS) return false;
  const times = (guildLog.get(g) || []).filter((t) => now - t < 3600_000);
  guildLog.set(g, times);
  if (times.length >= GUILD_PER_HOUR) return false;
  // a serious moment in the channel → he stays out of it
  if (getChannelHistory(ch, 6).some((m) => SERIOUS_RE.test(m.content || ''))) return false;
  return true;
}

function spend(message, now = Date.now()) {
  lastInChannel.set(message.channel.id, now);
  guildLog.set(message.guild.id, [...(guildLog.get(message.guild.id) || []), now]);
}

async function jumpIn(message, kind) {
  const mode = MODE();
  if (mode === 'off' || !budgetOk(message)) return;
  spend(message); // spent even on PASS / dry, so he never tries twice in a row
  const { reply, error } = await requestNexusReply(message.content, {
    client: message.client,
    userId: message.author.id,
    username: message.author.username,
    channelId: message.channel.id,
    messageId: message.id,
    useHistory: false,
    unprompted: true,
    serverContext: buildServerContext(message),
  });
  const text = String(reply || '').trim();
  if (error || !text || /^PASS\b/i.test(text)) {
    logger.info(`[jumpIn] ${kind} in #${message.channel.name}: ${error ? `engine error (${error.message})` : 'passed'}`);
    return;
  }
  if (mode !== 'live') {
    logger.info(`[jumpIn][dry] would have said in #${message.channel.name} (${kind}) to "${message.content.slice(0, 80)}": ${text.slice(0, 200)}`);
    return;
  }
  const sent = await message.reply({ content: text.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false }, failIfNotExists: false }).catch(() => null);
  if (sent) {
    trackAiReply(sent.id, { question: message.content, answer: text, guildId: message.guild.id });
    logger.info(`[jumpIn] ${kind} in #${message.channel.name}: "${text.slice(0, 120)}"`);
  }
}

/** Called for every message NOT addressed to Nexus (messageCreate.js). Never throws. */
export async function maybeJumpIn(message) {
  try {
    if (!message?.guild || message.author?.bot || MODE() === 'off' || !isJumpInChannel(message.channel?.name)) return;
    const botId = message.client?.user?.id;
    const c = candidateMoment(message, botId);
    if (c && Math.random() < c.chance) return void (await jumpIn(message, c.kind));
    if (roastGoingOn(message.channel.id) && Math.random() < 0.3) return void (await jumpIn(message, 'roast-battle'));
    // a real question nobody answers within 3 minutes
    const t = (message.content || '').trim();
    if (/\?\s*$/.test(t) && t.split(/\s+/).length >= 6 && !parseNexusTrigger(t, botId) && !SERIOUS_RE.test(t)) {
      clearTimeout(pendingQuestions.get(message.channel.id));
      pendingQuestions.set(message.channel.id, setTimeout(() => {
        pendingQuestions.delete(message.channel.id);
        const after = getChannelHistory(message.channel.id, 3);
        const stillLast = after.length && after[after.length - 1].content === message.content;
        if (stillLast && Math.random() < 0.5) jumpIn(message, 'unanswered-question').catch(() => {});
      }, 3 * 60_000));
    }
  } catch (err) {
    logger.debug(`[jumpIn] skipped: ${err.message}`);
  }
}

export const __test = { candidateMoment, budgetOk, spend, lastInChannel, guildLog, isJumpInChannel };
