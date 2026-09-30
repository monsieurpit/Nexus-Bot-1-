import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getTrackedAiReply, nexusClient } from '../services/nexusAiService.js';
import { logNegativeFeedback } from '../services/aiTelemetryService.js';

// Reactions on Nexus's own replies are the clearest feedback members give:
//  - 👎 is still forwarded to the guild's #negative-feedback telemetry channel (question + answer,
//    for corpus fixes), exactly as before — only in guilds that configured that channel.
//  - These reactions also go to the engine's learning system (Nexus-AI- docs/learning-system.md):
//    praise (👍 😂 🤣 💀 🔥 ❤️ 😭 💯) can turn the reply into a learned voice example, 👎/❌ re-checks
//    whatever fact the answer came from. The engine only accepts reactions on replies it really
//    sent recently, and applies its own quality/safety gates and daily caps.
// Only replies this process itself tracked (getTrackedAiReply) count, so reactions on anything else
// — a restart-old AI reply no longer in the bounded tracking map, or any non-AI message — are ignored.
const LEARNING_REACTIONS = new Set(['👍', '😂', '🤣', '💀', '🔥', '❤️', '😭', '💯', '👎', '❌']);

export default {
  name: Events.MessageReactionAdd,
  once: false,

  async execute(reaction, user) {
    try {
      if (user.bot) return;
      const emoji = reaction.emoji?.name;
      if (!emoji || !LEARNING_REACTIONS.has(emoji)) return;

      // Reactions on messages the bot didn't have cached arrive as partial objects with most
      // fields unavailable until fetched.
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch {
          return;
        }
      }

      const message = reaction.message;
      if (!message.guild) return;

      const tracked = getTrackedAiReply(message.id);
      if (!tracked) return;

      // Fire-and-forget: learning feedback must never delay or break anything else.
      nexusClient
        .sendReactionFeedback({ answer: tracked.answer, emoji, authorId: user.id })
        .catch((err) => logger.debug(`[messageReactionAdd] learning feedback not sent: ${err.message}`));

      if (emoji === '👎') {
        await logNegativeFeedback(message.client, tracked.guildId || message.guild.id, {
          question: tracked.question,
          answer: tracked.answer,
          reactedBy: user.id,
          messageUrl: message.url,
        });
      }
    } catch (error) {
      logger.error('[messageReactionAdd] Error handling reaction:', error);
    }
  },
};
