import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../../services/guildConfig.js';

// Guild-only test-server tooling — never registered globally. See commandLoader.js's
// registerCommands(): commands exporting guildOnly: true only ever sync to the dev/test guild
// (GUILD_ID) via the existing instant-sync mechanism, and are excluded from the global PUT.
export default {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Post an announcement to the announcements channel (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The announcement text to post')
                .setRequired(true)
                .setMaxLength(4000)
        ),

    async execute(interaction) {
        // setDefaultMemberPermissions already restricts this at the Discord UI level, but every
        // other admin-gated command in this codebase (see admin-set.js) also re-checks explicitly
        // inside execute() as defense in depth — matching that convention here.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                embeds: [createEmbed({
                    title: 'Permission Denied',
                    description: 'You need Administrator permission to use this command.',
                    color: 'error'
                })],
                flags: MessageFlags.Ephemeral
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Announce interaction defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
            return;
        }

        const message = interaction.options.getString('message', true);
        const config = await getGuildConfig(interaction.client, interaction.guild.id);
        const channelId = config?.aiTelemetry?.announcementsChannelId;

        if (!channelId) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: 'Not Configured',
                    description: 'No announcements channel is set for this server. Configure one with `/set-ai-telemetry`.',
                    color: 'error'
                })],
            });
        }

        try {
            const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: 'Channel Not Found',
                        description: `Could not find the configured announcements channel (${channelId}) in this server.`,
                        color: 'error'
                    })],
                });
            }

            await channel.send({
                embeds: [createEmbed({
                    title: '📢 Announcement',
                    description: message,
                    color: 'primary',
                    footer: { text: `Posted by ${interaction.user.tag}` },
                })],
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: 'Announcement Posted',
                    description: `Sent to <#${channelId}>.`,
                    color: 'success'
                })],
            });
        } catch (error) {
            logger.error('Announce command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: 'System Error',
                    description: 'Could not post the announcement.',
                    color: 'error'
                })],
            });
        }
    },
};
