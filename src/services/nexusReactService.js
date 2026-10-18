// "nexus react 💀 to that" (Patrick, 2026-10-18: "when told to react to a message, he must actually react"). Handled
// here, by the bot — no engine call: it knows which message is meant (the one replied to, or the last message from
// someone else) and whether Discord accepted the reaction. Only a reaction that really landed is claimed.
import { logger } from '../utils/logger.js';

const EMOJI_NAMES = [
  [/\b(?:skull|dead|💀)\b/i, '💀'], [/\b(?:sob|crying|cry|tears)\b/i, '😭'], [/\b(?:laugh\w*|lmao|crying\s+laughing|joy)\b/i, '😂'],
  [/\bfire\b/i, '🔥'], [/\bclown\b/i, '🤡'], [/\bcap\b/i, '🧢'], [/\bgoat\b/i, '🐐'], [/\beyes\b/i, '👀'], [/\b(?:heart|love)\b/i, '❤️'],
  [/\bthumbs?\s*down\b/i, '👎'], [/\bthumbs?(?:\s*up)?\b/i, '👍'], [/\b(?:100|hundred)\b/i, '💯'], [/\b(?:moai|stone\s+face)\b/i, '🗿'],
  [/\bnerd\b/i, '🤓'], [/\b(?:pray\w*|please)\b/i, '🙏'], [/\b(?:w|win)\b/i, '🇼'], [/\b(?:l|loss)\b/i, '🇱'], [/\b(?:italian|chef'?s?\s+kiss|🤌)\b/i, '🤌'],
  [/\bshrug\b/i, '🤷'], [/\bsalute\b/i, '🫡'], [/\b(?:check|tick)\b/i, '✅'], [/\b(?:x|cross)\b/i, '❌'], [/\bkangaroo\b/i, '🦘'],
];

// "react 💀", "react with a skull to that", "add a 🔥 reaction", "react to his message with :kekw:"
const REACT_RE = /^(?:(?:pls|please|plz|can\s+(?:you|u)|could\s+(?:you|u)|go|now|yo|bro|ok|and)[\s,]+)*(?:react\b|add\s+(?:a|an|the|ur)?\s*\S{0,20}\s*reaction\b|put\s+(?:a|an)?\s*\S{1,20}\s+(?:on|under)\s+(?:it|that|this|his|her|their|my))/i;
const NOT_A_REQUEST_RE = /\b(?:how\s+(?:do|to)|what\s+(?:does|is)|why\s+did|don'?t|do\s+not|stop|can'?t)\b[^.?!]{0,20}\breact/i;

export function parseReactRequest(text) {
  const t = (text || '').trim();
  if (!t || t.length > 140 || !REACT_RE.test(t) || NOT_A_REQUEST_RE.test(t)) return null;
  const custom = t.match(/<a?:(\w+):(\d+)>|:(\w{2,32}):/);
  if (custom) return { emoji: custom[2] ? custom[0] : null, customName: custom[3] || custom[1] || null, target: targetOf(t) };
  const literal = t.match(/\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/u);
  if (literal) return { emoji: literal[0], customName: null, target: targetOf(t) };
  const rest = t.replace(/\b(?:react|reaction|to|with|on|this|that|his|her|their|my|the|message|msg|nexus|pls|please|a|an)\b/gi, ' ');
  for (const [re, e] of EMOJI_NAMES) if (re.test(rest)) return { emoji: e, customName: null, target: targetOf(t) };
  return null;
}

function targetOf(t) {
  if (/\b(?:my|mine|this\s+one|to\s+me)\b/i.test(t)) return 'own';
  return 'other';
}

async function resolveTarget(message, target) {
  if (target === 'own') return message;
  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    if (ref) return ref;
    return null; // replied to a message that's gone
  }
  // No reply: the last message in the channel from someone else (not the bot, not them).
  const recent = await message.channel.messages.fetch({ limit: 10, before: message.id }).catch(() => null);
  return recent?.find((m) => m.author?.id !== message.author.id && m.author?.id !== message.client.user.id) || null;
}

/** Tries the reaction. Returns { ok, reason, target } — the caller says the truth about it. */
export async function performReactRequest(message, req) {
  const target = await resolveTarget(message, req.target);
  if (!target) return { ok: false, reason: 'no-target' };
  let emoji = req.emoji;
  if (!emoji && req.customName) {
    const found = message.guild?.emojis?.cache?.find((e) => e.name?.toLowerCase() === req.customName.toLowerCase());
    if (!found) return { ok: false, reason: 'unknown-emoji' };
    emoji = found;
  }
  try {
    await target.react(emoji);
    return { ok: true, reason: 'reacted', target };
  } catch (err) {
    const code = err?.code;
    logger.debug(`[nexusReact] reaction failed: ${err?.message}`);
    return { ok: false, reason: code === 50013 ? 'no-permission' : code === 10008 ? 'message-gone' : code === 10014 || code === 50035 ? 'unknown-emoji' : 'api-error' };
  }
}

export const REACT_FAIL_LINES = {
  'no-target': "which message bro? reply to it and tell me again",
  'unknown-emoji': "i can't find that emoji here mate",
  'no-permission': "can't, i don't have perms to react in here 😭",
  'message-gone': "that message is gone mate",
  'api-error': "discord said no, try again in a sec",
};
