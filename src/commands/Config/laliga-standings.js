import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
    fetchLaLigaStandings,
    buildStandingsEmbed,
    getLaligaStandingsConfig,
    setLaligaStandingsConfig,
    updateLaligaStandingsBoard
} from '../../services/laligaStandingsService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('laliga-standings')
        .setDescription('View or auto-update the LaLiga standings table / Ver la clasificación de LaLiga')
        .addSubcommand(sub =>
            sub
                .setName('view')
                .setDescription('Show the current LaLiga standings right now')
        )
        .addSubcommand(sub =>
            sub
                .setName('auto-update')
                .setDescription('Configure an hourly auto-updating standings board in a channel (Manage Server only)')
                .addStringOption(opt =>
                    opt
                        .setName('action')
                        .setDescription('Enable, refresh, or disable the auto-updating board')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Enable / Update Channel', value: 'enable' },
                            { name: 'Refresh (post a fresh message)', value: 'refresh' },
                            { name: 'Disable', value: 'disable' }
                        )
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Text channel for the auto-updating standings board')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        ),

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const { guild } = interaction;
        const sub = interaction.options.getSubcommand();

        if (sub === 'view') {
            try {
                const rows = await fetchLaLigaStandings();
                return await InteractionHelper.safeEditReply(interaction, { embeds: [buildStandingsEmbed(rows)] });
            } catch (err) {
                logger.error('Failed to fetch LaLiga standings in /laliga-standings view:', err);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Could Not Load Standings', err.message)]
                });
            }
        }

        if (sub === 'auto-update') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Permission Denied / Permiso Denegado',
                        'You need **Manage Server** permission to configure the auto-updating standings board.'
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            const action = interaction.options.getString('action');
            const channel = interaction.options.getChannel('channel');
            const config = await getLaligaStandingsConfig(client, guild.id);

            if (action === 'disable') {
                await setLaligaStandingsConfig(client, guild.id, { enabled: false });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [{
                        color: 0xEE8707,
                        title: '🔴 Auto-Updating Standings Board Disabled',
                        description: 'Hourly standings updates have been turned off. Its message and channel are kept, so re-enabling will pick up where it left off.'
                    }]
                });
            }

            let targetChannel = channel;
            if (!targetChannel && config.channelId) {
                targetChannel = guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId).catch(() => null);
            }

            if (!targetChannel) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Channel Required',
                        'Please specify a text channel using the `channel:` option (e.g. `/laliga-standings auto-update action:Enable channel:#standings`).'
                    )]
                });
            }

            let me = guild.members.me;
            if (!me) me = await guild.members.fetchMe().catch(() => null);
            const perms = me ? targetChannel.permissionsFor(me) : targetChannel.permissionsFor(client.user.id);
            if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Missing Channel Permissions',
                        `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${targetChannel}.`
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                const msg = await updateLaligaStandingsBoard(client, guild.id, targetChannel, action === 'refresh');

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [{
                        color: 0xEE8707,
                        title: '🇪🇸 LaLiga Auto-Updating Standings Board Active',
                        description:
                            `Successfully configured the live standings board in ${targetChannel}!\n\n` +
                            `📌 **Board Message:** ${msg ? `[Jump to Message](${msg.url})` : 'N/A'}\n` +
                            `🔄 **Updates:** Every hour, automatically.`
                    }]
                });
            } catch (err) {
                logger.error('Failed to set up LaLiga auto-update board:', err);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Setup Failed', err.message)]
                });
            }
        }
    }
};
