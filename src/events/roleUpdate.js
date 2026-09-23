import { Events, AuditLogEvent, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { checkPermGuard } from '../services/permGuardService.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';

export default {
    name: Events.GuildRoleUpdate,
    once: false,

    async execute(oldRole, newRole, client) {
        if (!newRole.guild) return;

        try {
            await checkPermGuard(
                newRole.guild,
                client,
                AuditLogEvent.RoleUpdate,
                newRole.id,
                `edited role @${newRole.name ?? newRole.id}`
            );
        } catch (error) {
            logger.error('Error in roleUpdate perm guard event:', error);
        }

        // ROLE_UPDATE existed as a log type but nothing ever emitted it.
        try {
            const fields = [{ name: '🎭 Role', value: `${newRole.toString()} (${newRole.id})`, inline: true }];

            if (oldRole.name !== newRole.name) {
                fields.push({ name: '🏷️ Name', value: `${oldRole.name} → ${newRole.name}`, inline: false });
            }
            if (oldRole.color !== newRole.color) {
                fields.push({ name: '🎨 Color', value: `${oldRole.hexColor} → ${newRole.hexColor}`, inline: true });
            }
            if (oldRole.hoist !== newRole.hoist) {
                fields.push({ name: '📌 Displayed separately', value: `${oldRole.hoist} → ${newRole.hoist}`, inline: true });
            }
            if (oldRole.mentionable !== newRole.mentionable) {
                fields.push({ name: '📣 Mentionable', value: `${oldRole.mentionable} → ${newRole.mentionable}`, inline: true });
            }
            if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
                const oldPerms = new PermissionsBitField(oldRole.permissions.bitfield);
                const newPerms = new PermissionsBitField(newRole.permissions.bitfield);
                const granted = newPerms.toArray().filter(p => !oldPerms.has(p));
                const revoked = oldPerms.toArray().filter(p => !newPerms.has(p));
                if (granted.length) fields.push({ name: '✅ Permissions granted', value: granted.join(', '), inline: false });
                if (revoked.length) fields.push({ name: '⛔ Permissions revoked', value: revoked.join(', '), inline: false });
            }

            // Position shifts alone (every role below a moved one "changes") aren't worth a log line.
            if (fields.length <= 1) return;

            await logEvent({
                client: newRole.client || client,
                guildId: newRole.guild.id,
                eventType: EVENT_TYPES.ROLE_UPDATE,
                data: {
                    description: `A role was updated: ${newRole.toString()}`,
                    fields
                }
            });
        } catch (error) {
            logger.error('Error logging role update:', error);
        }
    },
};
