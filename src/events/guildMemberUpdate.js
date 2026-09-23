import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild) return;
      // Without the member cached beforehand, discord.js hands us a partial "old" member with no
      // real previous state — comparing against it would log bogus changes.
      if (oldMember.partial) return;

      const client = newMember.client;
      const guildId = newMember.guild.id;
      const memberField = {
        name: '👤 Member',
        value: `${newMember.user.tag} (${newMember.user.id})`,
        inline: true
      };

      // Nickname changes
      if (oldMember.nickname !== newMember.nickname) {
        await logEvent({
          client,
          guildId,
          eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
          data: {
            description: `Member nickname changed: ${newMember.user.tag}`,
            userId: newMember.user.id,
            fields: [
              memberField,
              { name: '🏷️ Old Nickname', value: oldMember.nickname || '*(no nickname)*', inline: true },
              { name: '🏷️ New Nickname', value: newMember.nickname || '*(no nickname)*', inline: true }
            ]
          }
        });
      }

      // Role changes (previously never logged at all)
      const added = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
      const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
      if (added.size > 0 || removed.size > 0) {
        const fields = [memberField];
        if (added.size > 0) {
          fields.push({ name: '➕ Roles Added', value: added.map(role => role.toString()).join(', '), inline: false });
        }
        if (removed.size > 0) {
          fields.push({ name: '➖ Roles Removed', value: removed.map(role => role.toString()).join(', '), inline: false });
        }
        await logEvent({
          client,
          guildId,
          eventType: EVENT_TYPES.MEMBER_ROLE_UPDATE,
          data: {
            description: `Roles updated for ${newMember.user.tag}`,
            userId: newMember.user.id,
            fields
          }
        });
      }

      // Timeouts applied / removed (including ones done directly in Discord, not via the bot)
      const oldTimeout = oldMember.communicationDisabledUntilTimestamp || 0;
      const newTimeout = newMember.communicationDisabledUntilTimestamp || 0;
      const now = Date.now();
      const wasTimedOut = oldTimeout > now;
      const isTimedOut = newTimeout > now;
      if (wasTimedOut !== isTimedOut || (isTimedOut && oldTimeout !== newTimeout)) {
        await logEvent({
          client,
          guildId,
          eventType: EVENT_TYPES.MEMBER_TIMEOUT,
          data: {
            description: isTimedOut
              ? `${newMember.user.tag} was timed out`
              : `${newMember.user.tag}'s timeout was removed`,
            userId: newMember.user.id,
            fields: [
              memberField,
              ...(isTimedOut
                ? [{ name: '⏳ Until', value: `<t:${Math.floor(newTimeout / 1000)}:F> (<t:${Math.floor(newTimeout / 1000)}:R>)`, inline: true }]
                : [])
            ]
          }
        });
      }
    } catch (error) {
      logger.error('Error in guildMemberUpdate event:', error);
    }
  }
};
