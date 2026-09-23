import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getAllMatches, getFootballConfig } from '../../services/footballService.js';

export default {
    allowDM: true,
    data: new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('View upcoming FC Barcelona matches and 3-day announcement countdowns')
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
        ),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn('Schedule interaction defer failed', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'schedule'
                });
                return;
            }

            const client = interaction.client;
            const guild = interaction.guild;
            const filter = interaction.options?.getString('filter') || 'upcoming';

            // Works in DMs too — there are simply no server-specific custom matches there.
            const config = guild ? await getFootballConfig(client, guild.id) : { customMatches: [] };
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
        } catch (error) {
            logger.error('Error executing schedule command:', error);
            return await handleInteractionError(interaction, error);
        }
    }
};
