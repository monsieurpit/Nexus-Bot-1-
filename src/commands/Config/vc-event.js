import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    MessageFlags
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import {
    getVcEventConfig,
    setVcEventConfig,
    runVcEventNow,
    isPlaybackActive,
    stopPlaylistPlayback,
    getPlaybackStatus,
    DAY_NAMES,
    DEFAULT_VC_EVENT_PLAYLIST
} from '../../services/vcEventService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('vc-event')
        .setDescription('Configure a recurring weekly VC listening event / Configura un evento semanal de escucha en VC')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('setup')
                .setDescription('Configure or update the recurring weekly VC event')
                .addStringOption(opt =>
                    opt
                        .setName('day')
                        .setDescription('Day of the week the event runs')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Sunday', value: '0' },
                            { name: 'Monday', value: '1' },
                            { name: 'Tuesday', value: '2' },
                            { name: 'Wednesday', value: '3' },
                            { name: 'Thursday', value: '4' },
                            { name: 'Friday', value: '5' },
                            { name: 'Saturday', value: '6' }
                        )
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('hour')
                        .setDescription('Hour to start, in UTC-4 (0-23)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(23)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('announce-channel')
                        .setDescription('Text channel where the event announcement is posted')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('voice-channel')
                        .setDescription('Voice channel the bot joins to play the playlist')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role')
                        .setDescription('Role to ping in the announcement (optional)')
                        .setRequired(false)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('minute')
                        .setDescription('Minute of the hour to start (default: 0)')
                        .setRequired(false)
                        .setMinValue(0)
                        .setMaxValue(59)
                )
                .addStringOption(opt =>
                    opt
                        .setName('playlist')
                        .setDescription('Spotify playlist URL (default: the configured Nexus event playlist)')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt
                        .setName('enabled')
                        .setDescription('Enable this event immediately (default: true)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('View the current VC event configuration')
        )
        .addSubcommand(sub =>
            sub
                .setName('disable')
                .setDescription('Disable the recurring VC event without losing its configuration')
        )
        .addSubcommand(sub =>
            sub
                .setName('stop')
                .setDescription('Immediately stop any playlist currently playing in this server')
        )
        .addSubcommand(sub =>
            sub
                .setName('trigger-now')
                .setDescription('Immediately run the configured VC event right now (for testing)')
        ),

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const { guild } = interaction;
        const sub = interaction.options.getSubcommand();

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Permission Denied / Permiso Denegado',
                    'You need **Manage Server** permission to configure VC events.'
                )],
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'setup') {
            const dayOfWeek = parseInt(interaction.options.getString('day'), 10);
            const hour = interaction.options.getInteger('hour');
            const minute = interaction.options.getInteger('minute') ?? 0;
            const announceChannel = interaction.options.getChannel('announce-channel');
            const voiceChannel = interaction.options.getChannel('voice-channel');
            const role = interaction.options.getRole('role');
            const playlistUrl = interaction.options.getString('playlist') || DEFAULT_VC_EVENT_PLAYLIST;
            const enabled = interaction.options.getBoolean('enabled') ?? true;

            if (!/open\.spotify\.com\/playlist\//.test(playlistUrl)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Invalid Playlist URL',
                        'Please provide a valid Spotify playlist link (e.g. `https://open.spotify.com/playlist/...`).'
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            let me = guild.members.me;
            if (!me) {
                me = await guild.members.fetchMe().catch(() => null);
            }

            const textPerms = me ? announceChannel.permissionsFor(me) : null;
            if (!textPerms || !textPerms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Missing Channel Permissions',
                        `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${announceChannel}.`
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            const voicePerms = me ? voiceChannel.permissionsFor(me) : null;
            if (!voicePerms || !voicePerms.has(['ViewChannel', 'Connect', 'Speak'])) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Missing Voice Permissions',
                        `I need **View Channel**, **Connect**, and **Speak** permissions in ${voiceChannel}.`
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            const updated = await setVcEventConfig(client, guild.id, {
                dayOfWeek,
                hour,
                minute,
                announceChannelId: announceChannel.id,
                voiceChannelId: voiceChannel.id,
                pingRoleId: role ? role.id : null,
                playlistUrl,
                enabled
            });

            const roleDisplay = updated.pingRoleId ? `<@&${updated.pingRoleId}>` : '*None (No ping)*';

            const embed = new EmbedBuilder()
                .setColor(getColor('success'))
                .setTitle('🎧 VC Listening Event Configured')
                .setDescription(
                    `The recurring VC event is now configured!\n\n` +
                    `📅 **Day:** ${DAY_NAMES[dayOfWeek]}\n` +
                    `⏰ **Time:** ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (UTC-4)\n` +
                    `📢 **Announcement Channel:** ${announceChannel}\n` +
                    `🔊 **Voice Channel:** ${voiceChannel}\n` +
                    `🔔 **Ping Role:** ${roleDisplay}\n` +
                    `🎵 **Playlist:** [Spotify Link](${playlistUrl})\n` +
                    `🔁 **Loops:** Plays the full playlist 3 times, then leaves automatically.\n` +
                    `⚡ **Status:** ${updated.enabled ? '🟢 Active' : '🔴 Disabled'}`
                )
                .setFooter({ text: 'Nexus VC Event Scheduler' })
                .setTimestamp();

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === 'status') {
            const config = await getVcEventConfig(client, guild.id);
            const playback = getPlaybackStatus(guild.id);

            if (config.dayOfWeek === null || config.hour === null) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'No VC Event Configured',
                        'Run `/vc-event setup` to schedule a recurring VC listening event.'
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            const roleDisplay = config.pingRoleId ? `<@&${config.pingRoleId}>` : '*None*';
            const announceChannel = guild.channels.cache.get(config.announceChannelId);
            const voiceChannel = guild.channels.cache.get(config.voiceChannelId);

            const embed = new EmbedBuilder()
                .setColor(getColor(config.enabled ? 'success' : 'warning'))
                .setTitle('🎧 VC Listening Event Status')
                .setDescription(
                    `📅 **Day:** ${DAY_NAMES[config.dayOfWeek]}\n` +
                    `⏰ **Time:** ${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')} (UTC-4)\n` +
                    `📢 **Announcement Channel:** ${announceChannel ? announceChannel.toString() : '*Unknown/Deleted*'}\n` +
                    `🔊 **Voice Channel:** ${voiceChannel ? voiceChannel.toString() : '*Unknown/Deleted*'}\n` +
                    `🔔 **Ping Role:** ${roleDisplay}\n` +
                    `🎵 **Playlist:** [Spotify Link](${config.playlistUrl})\n` +
                    `⚡ **Status:** ${config.enabled ? '🟢 Active' : '🔴 Disabled'}\n` +
                    `▶️ **Currently Playing:** ${playback ? `Yes (loop ${playback.loop}/${playback.totalLoops})` : 'No'}`
                )
                .setFooter({ text: 'Nexus VC Event Scheduler' })
                .setTimestamp();

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === 'disable') {
            const config = await getVcEventConfig(client, guild.id);
            if (config.dayOfWeek === null) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('No VC Event Configured', 'Run `/vc-event setup` first.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            await setVcEventConfig(client, guild.id, { enabled: false });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [new EmbedBuilder()
                    .setColor(getColor('warning'))
                    .setTitle('🔴 VC Event Disabled')
                    .setDescription('The recurring VC event has been disabled. Its configuration is kept, so `/vc-event setup` will pre-fill it again if you re-enable.')
                ]
            });
        }

        if (sub === 'stop') {
            if (!isPlaybackActive(guild.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Nothing Playing', 'There is no VC event playlist currently playing in this server.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            stopPlaylistPlayback(guild.id);
            logger.info(`[VC Event] Playback manually stopped in guild ${guild.id} by ${interaction.user.id}`);

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('⏹️ Playback Stopped')
                    .setDescription('The playlist has been stopped and the bot will leave the voice channel.')
                ]
            });
        }

        if (sub === 'trigger-now') {
            const config = await getVcEventConfig(client, guild.id);

            if (!config.announceChannelId || !config.voiceChannelId) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Not Configured', 'Run `/vc-event setup` first before triggering it manually.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (isPlaybackActive(guild.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Already Playing', 'A VC event playlist is already playing in this server. Use `/vc-event stop` first.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            logger.info(`[VC Event] Manually triggered by ${interaction.user.id} in guild ${guild.id}`);
            runVcEventNow(client, guild, config).catch(err => {
                logger.error(`[VC Event] Manual trigger failed for guild ${guild.id}: ${err.message}`);
            });

            const voiceChannel = guild.channels.cache.get(config.voiceChannelId);

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('🎧 VC Event Triggered')
                    .setDescription(`Starting now! Announcement posted and joining ${voiceChannel || 'the voice channel'}.`)
                ]
            });
        }
    }
};
