import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    MessageFlags
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import {
    getFootballConfig,
    setFootballConfig,
    getAllMatches,
    sendMatchAlert,
    formatMatchAnnouncement,
    syncBarcelonaFixturesFromApi,
    getFootballApiStatus,
    updateLiveScheduleBoard,
    DEFAULT_BARCELONA_MATCHES
} from '../../services/footballService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('football')
        .setDescription('FC Barcelona match announcement settings / Configuración de avisos de partidos del FC Barcelona')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('set-channel')
                .setDescription('Set the channel for FC Barcelona match announcements (posted 3 days before match)')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel where match announcements will be posted')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role')
                        .setDescription('Role to ping at the end of the announcement (optional)')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt
                        .setName('enabled')
                        .setDescription('Enable automated 3-day announcements (default: true)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('View current FC Barcelona match announcement settings and API sync status')
        )
        .addSubcommand(sub =>
            sub
                .setName('schedule')
                .setDescription('View scheduled FC Barcelona matches and announcement countdowns')
                .addStringOption(opt =>
                    opt
                        .setName('filter')
                        .setDescription('Filter matches to display (default: upcoming matches)')
                        .setRequired(false)
                        .addChoices(
                            { name: '⏳ Upcoming Matches (Default)', value: 'upcoming' },
                            { name: '🏁 Past / Completed Matches', value: 'past' },
                            { name: '📅 All Matches in Schedule', value: 'all' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('sync-api')
                .setDescription('Manually force a sync of all season fixtures from the live football API')
        )
        .addSubcommand(sub =>
            sub
                .setName('alert-now')
                .setDescription('Immediately post a match announcement to test or announce on demand')
                .addStringOption(opt =>
                    opt
                        .setName('match')
                        .setDescription('Select or enter match ID (e.g. barca-valencia-2026-08-23 or select from list)')
                        .setAutocomplete(true)
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt
                        .setName('ping_role')
                        .setDescription('Whether to ping the configured role in this manual announcement (default: true)')
                        .setRequired(false)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Optional specific channel to send this announcement to')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('custom-match')
                .setDescription('Add a custom match fixture to the announcement schedule')
                .addStringOption(opt => opt.setName('opponent').setDescription('Opponent name (e.g. REAL MADRID)').setRequired(true))
                .addStringOption(opt => opt.setName('competition').setDescription('Competition (e.g. LaLiga, Champions League)').setRequired(true))
                .addStringOption(opt => opt.setName('matchday').setDescription('Matchday/Round (e.g. Matchday 38 / Final)').setRequired(true))
                .addStringOption(opt => opt.setName('date_time').setDescription('Kick-off date & time text (e.g. Saturday, May 23, 2026 – 9:00 PM CET)').setRequired(true))
                .addStringOption(opt => opt.setName('stadium').setDescription('Stadium and city (e.g. Spotify Camp Nou, Barcelona 🇪🇸)').setRequired(true))
                .addStringOption(opt => opt.setName('transport').setDescription('Transport directions info in English').setRequired(true))
                .addStringOption(opt => opt.setName('transport_es').setDescription('Transport directions info in Spanish (optional)').setRequired(false))
                .addStringOption(opt => opt.setName('kickoff_iso').setDescription('Kickoff ISO date for 3-day alert timing (e.g. 2026-05-23T19:00:00Z)').setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('toggle')
                .setDescription('Enable or disable automated 3-day match announcements')
                .addBooleanOption(opt =>
                    opt
                        .setName('enabled')
                        .setDescription('Enable (true) or disable (false)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('auto-schedule')
                .setDescription('Set up an auto-updating live schedule board channel (refreshes every 1 hour)')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel where the live schedule board will post & auto-update hourly')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt
                        .setName('action')
                        .setDescription('Select action: Refresh live board now or Disable hourly updates')
                        .setRequired(false)
                        .addChoices(
                            { name: '🔄 Refresh Live Board Now', value: 'refresh' },
                            { name: '🔴 Disable Auto-Schedule', value: 'disable' }
                        )
                )
        ),

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const { guild } = interaction;
        const sub = interaction.options.getSubcommand();

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Permission Denied / Permiso Denegado',
                    'You need **Manage Server** permission to configure football match announcements.'
                )],
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'set-channel') {
            const channel = interaction.options.getChannel('channel');
            const role = interaction.options.getRole('role');
            const enabled = interaction.options.getBoolean('enabled') ?? true;

            let me = guild.members.me;
            if (!me) {
                me = await guild.members.fetchMe().catch(() => null);
            }
            
            const perms = me ? channel.permissionsFor(me) : channel.permissionsFor(client.user.id);
            if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Missing Channel Permissions',
                        `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${channel}.`
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            await setFootballConfig(client, guild.id, {
                channelId: channel.id,
                roleId: role ? role.id : null,
                enabled
            });

            const roleDisplay = role ? `<@&${role.id}>` : '*None (No ping)*';

            const embed = new EmbedBuilder()
                .setColor(getColor('success'))
                .setTitle('⚽ FC Barcelona Match Announcements Configured')
                .setDescription(
                    `Match announcements are now configured!\n\n` +
                    `📢 **Channel:** ${channel}\n` +
                    `🔔 **Alert Role:** ${roleDisplay}\n` +
                    `⏱️ **Schedule:** Automated alerts are posted **3 days before** each FC Barcelona match.\n` +
                    `⚡ **Status:** ${enabled ? '🟢 Active' : '🔴 Disabled'}\n\n` +
                    `*You can run \`/football alert-now\` to test a live announcement at any time.*`
                )
                .setFooter({ text: 'FC Barcelona Matchday Alert System' })
                .setTimestamp();

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === 'sync-api') {
            try {
                const updatedMatches = await syncBarcelonaFixturesFromApi();
                const apiStatus = getFootballApiStatus();

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('⚽ FC Barcelona API Fixtures Synchronized')
                    .setDescription(
                        `Successfully queried official football APIs and updated match schedule!\n\n` +
                        `📋 **Total Matches Loaded:** ${updatedMatches.length} fixtures\n` +
                        `🔄 **Status:** ${apiStatus.lastSyncStatus}\n` +
                        `⏱️ **Sync Time:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                        `*The bot also automatically checks the API daily for schedule changes, matchday moves, and kick-off time confirmations.*`
                    )
                    .setFooter({ text: 'FC Barcelona API Scheduler' })
                    .setTimestamp();

                return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (err) {
                logger.error('Failed to sync API in /football sync-api:', err);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('API Sync Failed', `Could not update fixtures: ${err.message}`)]
                });
            }
        }

        if (sub === 'auto-schedule') {
            const action = interaction.options.getString('action');
            const channel = interaction.options.getChannel('channel');
            const config = await getFootballConfig(client, guild.id);

            if (action === 'disable') {
                await setFootballConfig(client, guild.id, { scheduleEnabled: false });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(
                        'Hourly Auto-Schedule Disabled',
                        'Automated hourly schedule board updates have been turned off for this server. You can re-enable anytime by choosing a channel in `/football auto-schedule`.'
                    )]
                });
            }

            let targetChannel = channel;
            if (!targetChannel && config.scheduleChannelId) {
                targetChannel = guild.channels.cache.get(config.scheduleChannelId) || await guild.channels.fetch(config.scheduleChannelId).catch(() => null);
            }

            if (!targetChannel) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Channel Required',
                        'Please specify a text channel using the `channel:` option to set up your live hourly schedule board (e.g. `/football auto-schedule channel:#matches`).'
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
                // Force sync first
                await syncBarcelonaFixturesFromApi().catch(() => null);
                // Update or create live board message
                const msg = await updateLiveScheduleBoard(client, guild.id, targetChannel, action === 'refresh');
                if (msg) {
                    await setFootballConfig(client, guild.id, {
                        scheduleChannelId: targetChannel.id,
                        scheduleMessageId: msg.id,
                        scheduleEnabled: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('⚽ FC Barcelona Live Auto-Updating Schedule Board Active')
                    .setDescription(
                        `Successfully configured the live schedule board in ${targetChannel}!\n\n` +
                        `📌 **Board Message:** [Jump to Live Schedule Message](${msg ? msg.url : '#'}).\n` +
                        `🔄 **Refresh Rate:** Auto-updates **every 1 hour** with latest kick-off times, venues, and score updates.\n` +
                        `⚡ **Overload Safety:** Uses hourly background caching to prevent API rate limits while keeping data completely up to date.\n\n` +
                        `*Tip: Run \`/football auto-schedule action:Refresh Live Board Now\` at any time to force an immediate refresh.*`
                    )
                    .setFooter({ text: 'FC Barcelona Live Scheduler Board' })
                    .setTimestamp();

                return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (err) {
                logger.error('Error setting up live schedule board:', err);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Failed to Setup Live Schedule Board', err.message)]
                });
            }
        }

        if (sub === 'status') {
            const config = await getFootballConfig(client, guild.id);
            const channelDisplay = config.channelId ? `<#${config.channelId}>` : '*Not configured*';
            const liveBoardDisplay = config.scheduleChannelId ? `<#${config.scheduleChannelId}> (${config.scheduleEnabled ? '🟢 Hourly Auto-Updates' : '🔴 Disabled'})` : '*Not configured*';
            const roleDisplay = config.roleId ? `<@&${config.roleId}>` : '*None*';
            const allMatches = getAllMatches(config.customMatches);
            const apiStatus = getFootballApiStatus();

            const nextUpcoming = allMatches.find(m => new Date(m.kickoffUtc).getTime() > Date.now());
            const nextMatchText = nextUpcoming
                ? `**${nextUpcoming.title}** • ID: \`${nextUpcoming.id}\`\n📅 ${nextUpcoming.kickoffEn}\n📍 ${nextUpcoming.locationEn}\n⚡ Manual alert: \`/football alert-now match:${nextUpcoming.id}\``
                : 'No upcoming matches found';

            const embed = new EmbedBuilder()
                .setColor(getColor('primary'))
                .setTitle('⚽ FC Barcelona Matchday Alert Status')
                .addFields(
                    { name: '📢 Announcement Channel', value: channelDisplay, inline: true },
                    { name: '📌 Live Schedule Board', value: liveBoardDisplay, inline: true },
                    { name: '🔔 Ping Role', value: roleDisplay, inline: true },
                    { name: '⚡ Auto Alerts', value: config.enabled ? '🟢 Enabled (3 days prior)' : '🔴 Disabled', inline: true },
                    { name: '📋 Total Fixtures in Schedule', value: `${allMatches.length} matches (API + Custom)`, inline: true },
                    { name: '🌐 API Sync Status', value: apiStatus.lastSyncStatus || 'Active', inline: true },
                    { name: '⏳ Next Scheduled Match', value: nextMatchText, inline: false }
                )
                .setFooter({ text: 'Use /football auto-schedule or /football set-channel to configure' })
                .setTimestamp();

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === 'schedule') {
            const filter = interaction.options.getString('filter') || 'upcoming';
            const config = await getFootballConfig(client, guild.id);
            const matches = getAllMatches(config.customMatches);
            const now = Date.now();

            const upcomingMatches = matches.filter(m => new Date(m.kickoffUtc).getTime() >= now);
            const pastMatches = matches.filter(m => new Date(m.kickoffUtc).getTime() < now);

            let displayList = [];
            let headerDesc = '';
            let titleText = '⚽ FC Barcelona Match Schedule';

            if (filter === 'past') {
                titleText = '⚽ FC Barcelona – Recent / Completed Matches';
                displayList = [...pastMatches].reverse().slice(0, 8);
                headerDesc = displayList.length > 0 
                    ? `Showing ${displayList.length} recently completed matches:` 
                    : 'No past matches found in the current log.';
            } else if (filter === 'all') {
                titleText = '⚽ FC Barcelona – Full Season Calendar';
                displayList = matches.slice(0, 10);
                headerDesc = `Showing ${displayList.length} season fixtures (${upcomingMatches.length} upcoming, ${pastMatches.length} completed):`;
            } else {
                // Default: upcoming matches
                titleText = '⚽ FC Barcelona – Upcoming Match Fixtures';
                displayList = upcomingMatches.slice(0, 8);
                headerDesc = displayList.length > 0
                    ? `Showing next **${displayList.length} upcoming matches** with automatic 3-day announcement countdowns:`
                    : 'No upcoming matches found in the current calendar. Run `/football sync-api` to refresh.';
            }

            const embed = new EmbedBuilder()
                .setColor(getColor('primary'))
                .setTitle(titleText)
                .setDescription(headerDesc)
                .setFooter({ text: 'FC Barcelona Match Alerts • Automated 3-Day Kick-off Notifications' })
                .setTimestamp();

            for (const match of displayList) {
                const matchTime = new Date(match.kickoffUtc).getTime();
                const announceTime = matchTime - (3 * 24 * 60 * 60 * 1000);
                const isPast = matchTime < now;
                const isAnnounceReady = now >= announceTime && !isPast;
                const isPosted = config.postedMatches?.includes(match.id);

                let statusBadge = '⏳ Upcoming';
                if (isPast) statusBadge = '🏁 Completed';
                else if (isPosted) statusBadge = '✅ Announced';
                else if (isAnnounceReady) statusBadge = '🚨 Ready for 3-Day Alert';

                embed.addFields({
                    name: `${match.title} • ID: \`${match.id}\` (${statusBadge})`,
                    value: `🆔 **Match ID:** \`${match.id}\`\n` +
                           `🏆 **${match.competition}** – ${match.matchday}\n` +
                           `📅 **Kick-off:** ${match.kickoffEn}\n` +
                           `📍 **Venue:** ${match.locationEn}\n` +
                           `⏰ **3-Day Alert:** <t:${Math.floor(announceTime / 1000)}:f> (<t:${Math.floor(announceTime / 1000)}:R>)\n` +
                           `⚡ **Manual Alert:** \`/football alert-now match:${match.id}\``,
                    inline: false
                });
            }

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        if (sub === 'alert-now') {
            const matchIdInput = interaction.options.getString('match');
            const pingRoleOpt = interaction.options.getBoolean('ping_role') ?? true;
            const channelOverride = interaction.options.getChannel('channel');
            const config = await getFootballConfig(client, guild.id);

            const matches = getAllMatches(config.customMatches);

            let selectedMatch = null;
            if (matchIdInput) {
                const cleanInput = matchIdInput.trim().toLowerCase();
                selectedMatch = matches.find(m =>
                    m.id.toLowerCase() === cleanInput ||
                    m.id.toLowerCase().includes(cleanInput) ||
                    m.title.toLowerCase().includes(cleanInput) ||
                    m.opponent?.toLowerCase().includes(cleanInput)
                );
            }

            if (!selectedMatch) {
                selectedMatch = matches.find(m => new Date(m.kickoffUtc).getTime() > Date.now()) || matches[0] || DEFAULT_BARCELONA_MATCHES[0];
            }

            // Resolve target channel: explicit option -> configured channel -> current interaction channel
            let targetChannel = channelOverride;
            if (!targetChannel && config.channelId) {
                targetChannel = client.channels.cache.get(config.channelId) ||
                                await client.channels.fetch(config.channelId).catch(() => null);
            }
            if (!targetChannel) {
                targetChannel = interaction.channel;
            }

            const targetChannelId = targetChannel?.id || interaction.channelId;
            const roleToPing = (pingRoleOpt && config.roleId) ? config.roleId : null;

            try {
                await sendMatchAlert(client, targetChannelId, selectedMatch, roleToPing);

                // Mark as posted in config
                if (!config.postedMatches?.includes(selectedMatch.id)) {
                    const newPosted = [...(config.postedMatches || []), selectedMatch.id];
                    await setFootballConfig(client, guild.id, { postedMatches: newPosted });
                }

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(
                        'Match Announcement Sent ⚽',
                        `Successfully posted matchday alert for **${selectedMatch.title}** (ID: \`${selectedMatch.id}\`) to <#${targetChannelId}>!`
                    )],
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                logger.error('Error in football alert-now:', err);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Failed to Send Announcement',
                        `Could not post announcement to <#${targetChannelId}>:\n${err.message}`,
                        { showDetails: true }
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (sub === 'custom-match') {
            const opponent = interaction.options.getString('opponent').trim().toUpperCase();
            const competition = interaction.options.getString('competition').trim();
            const matchday = interaction.options.getString('matchday').trim();
            const dateTime = interaction.options.getString('date_time').trim();
            const stadium = interaction.options.getString('stadium').trim();
            const transportEn = interaction.options.getString('transport').trim();
            const transportEs = interaction.options.getString('transport_es')?.trim() || transportEn;
            const kickoffIso = interaction.options.getString('kickoff_iso')?.trim() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

            const customId = `custom-barca-${Date.now()}`;
            const customMatchObj = {
                id: customId,
                opponent,
                title: `FC BARCELONA vs ${opponent}`,
                competition,
                matchday,
                kickoffUtc: kickoffIso,
                kickoffEn: dateTime,
                kickoffEs: dateTime,
                locationEn: stadium,
                locationEs: stadium,
                transportEn,
                transportEs
            };

            const config = await getFootballConfig(client, guild.id);
            const updatedCustomList = [...(config.customMatches || []), customMatchObj];

            await setFootballConfig(client, guild.id, { customMatches: updatedCustomList });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    'Custom Match Added ⚽',
                    `Scheduled **${customMatchObj.title}** (${competition} - ${matchday}).\n` +
                    `Kick-off: ${dateTime}\nVenue: ${stadium}\n` +
                    `Alerts will trigger 3 days prior to kick-off.`
                )]
            });
        }

        if (sub === 'toggle') {
            const enabled = interaction.options.getBoolean('enabled');
            await setFootballConfig(client, guild.id, { enabled });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        'Football Alerts Updated',
                        `Automated 3-day match announcements are now **${enabled ? 'Enabled 🟢' : 'Disabled 🔴'}**.`
                    )
                ]
            });
        }
    },

    async autocomplete(interaction) {
        try {
            const focused = (interaction.options.getFocused() || '').toLowerCase();
            const config = await getFootballConfig(interaction.client, interaction.guildId);
            const matches = getAllMatches(config.customMatches);

            const filtered = matches.filter(m =>
                m.id.toLowerCase().includes(focused) ||
                m.title.toLowerCase().includes(focused) ||
                m.opponent?.toLowerCase().includes(focused) ||
                m.competition?.toLowerCase().includes(focused)
            );

            const choices = filtered.slice(0, 25).map(m => {
                const dateStr = m.kickoffUtc ? m.kickoffUtc.substring(0, 10) : '';
                const roundStr = m.matchday ? `[${m.matchday.split('/')[0].trim()}] ` : '';
                const nameLabel = `${roundStr}${m.title} (${dateStr})`.substring(0, 100);
                return {
                    name: nameLabel,
                    value: m.id
                };
            });

            await interaction.respond(choices);
        } catch {
            await interaction.respond([]);
        }
    }
};
