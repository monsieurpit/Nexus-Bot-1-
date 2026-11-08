// Turns Discord activity into quest progress, with anti-farming rules. Everything here is
// synchronous, in-memory and wrapped so it can never slow down or break message handling.
import { trackQuestEvent, trackQuestUnique, periodKeys } from './questService.js';

const MESSAGE_COOLDOWN_MS = 5000; // spam bursts count once
const NEWCOMER_WINDOW_MS = 48 * 60 * 60 * 1000;
const lastCounted = new Map(); // `${guild}:${user}` → timestamp
const recentReactions = new Map(); // `${guild}:${user}` → Set of `${message}:${emoji}`

const EMOJI_RE = /\p{Extended_Pictographic}|<a?:\w+:\d+>/u;

function prune(map, max = 20000) {
  if (map.size <= max) return;
  let n = Math.ceil(max / 10);
  for (const key of map.keys()) { map.delete(key); if (--n <= 0) break; }
}

/** Called for every guild message from a human. */
export function trackMessageForQuests(message, now = Date.now()) {
  try {
    if (!message?.guild || message.author?.bot || message.webhookId) return;
    const guildId = message.guild.id;
    const userId = message.author.id;
    const content = (message.content || '').trim();
    const images = [...(message.attachments?.values?.() || [])].filter((a) =>
      a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));
    if (content.length < 3 && images.length === 0) return;

    const key = `${guildId}:${userId}`;
    if (now - (lastCounted.get(key) || 0) < MESSAGE_COOLDOWN_MS) return;
    lastCounted.set(key, now);
    prune(lastCounted);

    trackQuestEvent(guildId, userId, 'messages');
    trackQuestUnique(guildId, userId, 'channels', message.channel?.id);
    trackQuestUnique(guildId, userId, 'activeDays', periodKeys(new Date(now)).day);
    if (images.length) trackQuestEvent(guildId, userId, 'images');
    // Long = 80+ characters with some variety (a wall of one repeated letter doesn't count).
    if (content.length >= 80 && new Set(content.toLowerCase()).size >= 12) trackQuestEvent(guildId, userId, 'longMessages');
    if (content.length >= 8 && content.endsWith('?')) trackQuestEvent(guildId, userId, 'questions');
    if (EMOJI_RE.test(content)) trackQuestEvent(guildId, userId, 'emojiMessages');

    const replied = message.mentions?.repliedUser;
    if (message.reference?.messageId && replied && replied.id !== userId && !replied.bot) {
      trackQuestEvent(guildId, userId, 'replies');
    }

    // Greeting newcomers: mentioning a member who joined in the last 48 hours.
    if (content.length >= 5) {
      for (const member of message.mentions?.members?.values?.() || []) {
        if (member.id === userId || member.user?.bot) continue;
        if (member.joinedTimestamp && now - member.joinedTimestamp < NEWCOMER_WINDOW_MS) {
          trackQuestUnique(guildId, userId, 'welcomes', member.id);
        }
      }
    }
  } catch { /* never break message handling */ }
}

/** Called when a member adds a reaction. Adding/removing the same reaction again doesn't count twice. */
export function trackReactionForQuests(reaction, user) {
  try {
    const guildId = reaction?.message?.guild?.id || reaction?.message?.guildId;
    if (!guildId || !user || user.bot) return;
    const key = `${guildId}:${user.id}`;
    let seen = recentReactions.get(key);
    if (!seen) { seen = new Set(); recentReactions.set(key, seen); prune(recentReactions); }
    const id = `${reaction.message.id}:${reaction.emoji?.id || reaction.emoji?.name}`;
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    trackQuestEvent(guildId, user.id, 'reactions');
  } catch { /* never break reaction handling */ }
}

export function _resetTrackerForTests() { lastCounted.clear(); recentReactions.clear(); }
