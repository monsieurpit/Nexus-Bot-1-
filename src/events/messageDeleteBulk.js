import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { markMessageDeleted } from '../services/nexusAiService.js';

// MESSAGE_BULK_DELETE existed as a log type (and /purge relies on Discord's bulk delete), but there
// was no listener for it, so purges and bulk deletions never reached the log channel.
export default {
  name: Events.MessageBulkDelete,
  once: false,

  async execute(messages, channel) {
    try {
      if (!channel?.guild) return;

      for (const id of messages.keys()) markMessageDeleted(id);

      const authors = new Map();
      for (const message of messages.values()) {
        if (!message.author) continue;
        authors.set(message.author.id, (authors.get(message.author.id) || 0) + 1);
      }
      const topAuthors = [...authors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, count]) => `<@${userId}>: ${count}`)
        .join('\n');

      await logEvent({
        client: channel.client,
        guildId: channel.guild.id,
        eventType: EVENT_TYPES.MESSAGE_BULK_DELETE,
        data: {
          description: `${messages.size} messages were bulk deleted in ${channel.toString()}`,
          channelId: channel.id,
          fields: [
            { name: '💬 Channel', value: `${channel.toString()} (${channel.id})`, inline: true },
            { name: '🔢 Count', value: String(messages.size), inline: true },
            ...(topAuthors ? [{ name: '👥 Authors (cached messages)', value: topAuthors, inline: false }] : [])
          ]
        }
      });
    } catch (error) {
      logger.error('Error in messageDeleteBulk event:', error);
    }
  }
};
