import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getTrackedAiReply } from '../services/nexusAiService.js';
import { logNegativeFeedback } from '../services/aiTelemetryService.js';

// The only signal for "the AI got a question wrong" used to be someone manually screenshotting it
// and remembering to report it — a 👎 on the bot's own reply (added automatically alongside 👍
// right after every real AI answer, see nexusAiService.js's trackAiReply/react calls) is a much
// lower-friction way for any member to flag a bad one. Only acts on replies this process itself
// tracked (getTrackedAiReply), so reactions on anything else — including a restart-old AI reply no
// longer in the bounded tracking map, or literally any non-AI message — are silently ignored.
export default {
  name: Events.MessageReactionAdd,
  once: false,

  async execute(reaction, user) {
    try {
      if (user.bot) return;
      if (reaction.emoji.name !== '👎') return;

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

      await logNegativeFeedback(message.client, tracked.guildId || message.guild.id, {
        question: tracked.question,
        answer: tracked.answer,
        reactedBy: user.id,
        messageUrl: message.url,
      });
    } catch (error) {
      logger.error('[messageReactionAdd] Error handling reaction:', error);
    }
  },
};
