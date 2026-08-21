import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditFields } from '../utils/roleLogFields.js';
import { recordWeeklyStat } from '../services/weeklySummaryService.js';

export default {
  name: Events.GuildRoleCreate,
  once: false,

  async execute(role) {
    try {
      if (!role.guild) return;

      recordWeeklyStat(role.client, role.guild.id, 'rolesCreated').catch(() => null);

      const fields = buildRoleAuditFields(role);

      await logEvent({
        client: role.client,
        guildId: role.guild.id,
        eventType: EVENT_TYPES.ROLE_CREATE,
        data: {
          description: `A new role was created: ${role.toString()}`,
          fields
        }
      });

    } catch (error) {
      logger.error('Error in roleCreate event:', error);
    }
  }
};
