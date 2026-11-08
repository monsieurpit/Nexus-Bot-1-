import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, actionEmbed, field } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/warningService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { guardDefer, guardPermission, guardMemberExists, guardSelfTarget, guardRoleHierarchy } from '../../utils/commandGuards.js';

export default {
    data: new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a user")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("User to warn"),
        )
        .addStringOption((o) =>
            o
                .setName("reason")
                .setRequired(true)
                .setDescription("Reason for the warning"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        if (!await guardDefer(interaction, 'warn')) return;

        try {
                guardPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members');

                const target = interaction.options.getUser("target");
                const member = interaction.options.getMember("target");
                const reason = interaction.options.getString("reason");
                const moderator = interaction.user;
                const guildId = interaction.guildId;

                guardMemberExists(member);
                // Same rules as /kick and /timeout: no warning yourself, the bot, or anyone at or
                // above your own top role (warnings are permanent records on that member).
                guardSelfTarget(target.id, interaction, client, 'warn');
                guardRoleHierarchy(interaction, member, 'warn');

                const result = await WarningService.addWarning({
                    guildId,
                    userId: target.id,
                    moderatorId: moderator.id,
                    reason,
                    timestamp: Date.now()
                });

                if (!result.success) {
                    throw new Error("Failed to store warning in database");
                }

                const totalWarns = result.totalCount;

                await logModerationAction({
                    client,
                    guild: interaction.guild,
                    event: {
                        action: "User Warned",
                        target: `${target.tag} (${target.id})`,
                        executor: `${moderator.tag} (${moderator.id})`,
                        reason,
                        metadata: {
                            userId: target.id,
                            moderatorId: moderator.id,
                            totalWarns,
                            warningNumber: totalWarns,
                            warningId: result.id
                        }
                    }
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        actionEmbed({
                            title: `⚠️ ${target.username} was warned`,
                            color: 'warning',
                            target: `${target} \`${target.id}\``,
                            moderator: `${interaction.user}`,
                            reason,
                            extra: [field('Total warnings', `**${totalWarns}**`, true)],
                            thumbnail: target.displayAvatarURL?.({ size: 128 }),
                        }),
                    ],
                });
        } catch (error) {
            logger.error('Warn command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'warn_failed' });
        }
    }
};
