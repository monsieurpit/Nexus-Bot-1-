import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../../services/guildConfig.js';

const CHANNEL_OPTIONS = [
    { name: 'bot-logs', configKey: 'botLogsChannelId', description: 'Channel for #bot-logs (per-response AI telemetry)' },
    { name: 'prompt-workbench', configKey: 'promptWorkbenchChannelId', description: 'Channel for #prompt-workbench (crashes / generation failures)' },
    { name: 'jailbreak-stress-test', configKey: 'jailbreakStressTestChannelId', description: 'Channel for #jailbreak-stress-test (meltdown/swear-floor triggers)' },
    { name: 'announcements', configKey: 'announcementsChannelId', description: 'Channel for /announce' },
    { name: 'benchmark-suite', configKey: 'benchmarkSuiteChannelId', description: 'Channel for /benchmark cross-posting' },
];

// Guild-only test-server tooling — never registered globally, same as announce.js/benchmark.js.
// Persists to the same Firestore/Postgres-backed guildConfig store every other configurable
// channel in this bot uses (see guildConfig.js's aiTelemetry defaults), NOT env vars — so these
// are changeable live, per-guild, without a redeploy.
export default {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('set-ai-telemetry')
        .setDescription('Configure the AI engine telemetry/logging channels (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set one or more telemetry channels')
                .addChannelOption(o => o.setName('bot-logs').setDescription(CHANNEL_OPTIONS[0].description).addChannelTypes(ChannelType.GuildText).setRequired(false))
                .addChannelOption(o => o.setName('prompt-workbench').setDescription(CHANNEL_OPTIONS[1].description).addChannelTypes(ChannelType.GuildText).setRequired(false))
                .addChannelOption(o => o.setName('jailbreak-stress-test').setDescription(CHANNEL_OPTIONS[2].description).addChannelTypes(ChannelType.GuildText).setRequired(false))
                .addChannelOption(o => o.setName('announcements').setDescription(CHANNEL_OPTIONS[3].description).addChannelTypes(ChannelType.GuildText).setRequired(false))
                .addChannelOption(o => o.setName('benchmark-suite').setDescription(CHANNEL_OPTIONS[4].description).addChannelTypes(ChannelType.GuildText).setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the current AI telemetry channel configuration')
        ),

    async execute(interaction, guildConfig, client) {
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

        const subcommand = interaction.options.getSubcommand();
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('set-ai-telemetry interaction defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
            return;
        }

        try {
            if (subcommand === 'view') {
                const config = guildConfig || await getGuildConfig(client, interaction.guild.id);
                const fields = CHANNEL_OPTIONS.map(({ name, configKey }) => {
                    const channelId = config?.aiTelemetry?.[configKey];
                    return { name, value: channelId ? `<#${channelId}>` : 'Not set', inline: true };
                });
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({ title: 'AI Telemetry Configuration', color: 'info', fields })],
                });
            }

            // subcommand === 'set'
            const updates = {};
            const setFields = [];
            for (const { name, configKey } of CHANNEL_OPTIONS) {
                const channel = interaction.options.getChannel(name);
                if (channel) {
                    updates[configKey] = channel.id;
                    setFields.push({ name, value: `${channel}`, inline: true });
                }
            }

            if (Object.keys(updates).length === 0) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: 'Nothing to Update',
                        description: 'Provide at least one channel option to set.',
                        color: 'warning'
                    })],
                });
            }

            const currentConfig = guildConfig || await getGuildConfig(client, interaction.guild.id);
            await setGuildConfig(client, interaction.guild.id, {
                aiTelemetry: { ...currentConfig?.aiTelemetry, ...updates }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: 'AI Telemetry Channels Updated',
                    color: 'success',
                    fields: setFields
                })],
            });
        } catch (error) {
            logger.error('set-ai-telemetry command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ title: 'System Error', description: 'Could not update the configuration.', color: 'error' })],
            });
        }
    },
};
