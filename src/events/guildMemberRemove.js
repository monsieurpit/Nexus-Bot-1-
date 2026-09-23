import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../config/bot.js';
import { getWelcomeConfig, getUserApplications, deleteApplication } from '../utils/database.js';
import { formatWelcomeMessage } from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { scheduleCounterRefresh } from '../services/serverstatsService.js';
import { deleteUserLevelData } from '../services/leveling.js';
import { logger } from '../utils/logger.js';
import { recordWeeklyStat } from '../services/weeklySummaryService.js';

export default {
  name: Events.GuildMemberRemove,
  once: false,
  
  async execute(member) {
    const { guild, user } = member;
    const client = member.client;

    recordWeeklyStat(client, guild.id, 'leaves').catch(() => null);

    // Each step is isolated — a goodbye channel the bot can't post in used to `return` out of the
    // whole handler, skipping the leave log, counters and application cleanup below.
    await runStep('goodbye message', async () => {
        const welcomeConfig = await getWelcomeConfig(client, guild.id);
        await sendGoodbyeMessage(member, welcomeConfig);
    });

    await runStep('leave log', () => logEvent({
        client,
        guildId: guild.id,
        eventType: EVENT_TYPES.MEMBER_LEAVE,
        data: {
            description: `${user.tag} left the server`,
            userId: user.id,
            fields: [
                { name: '👤 Member', value: `${user.tag} (${user.id})`, inline: true },
                { name: '👥 Member Count', value: guild.memberCount.toString(), inline: true },
                {
                    name: '📅 Joined',
                    value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown',
                    inline: true
                }
            ]
        }
    }));

    scheduleCounterRefresh(client, guild);

    // Remove all pending applications when a member leaves
    await runStep('application cleanup', async () => {
        const userApplications = await getUserApplications(client, guild.id, user.id);
        if (userApplications && userApplications.length > 0) {
            for (const app of userApplications) {
                await deleteApplication(client, guild.id, app.id, user.id);
            }
            logger.debug(`Removed ${userApplications.length} applications for user ${user.id} in guild ${guild.id}`);
        }
    });

    // Remove leveling data when a member leaves
    await runStep('leveling cleanup', async () => {
        await deleteUserLevelData(client, guild.id, user.id);
        logger.debug(`Removed leveling data for user ${user.id} in guild ${guild.id}`);
    });
  }
};




async function runStep(name, fn) {
    try {
        await fn();
    } catch (error) {
        logger.warn(`guildMemberRemove: ${name} failed:`, error);
    }
}

async function sendGoodbyeMessage(member, welcomeConfig) {
    const { guild, user } = member;
    const goodbyeChannelId = welcomeConfig?.goodbyeChannelId;
    if (!welcomeConfig?.goodbyeEnabled || !goodbyeChannelId) return;

    const channel = guild.channels.cache.get(goodbyeChannelId);
    if (!channel?.isTextBased?.()) return;

    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        logger.warn(`Goodbye message skipped in guild ${guild.id}: missing View/Send permission in channel ${goodbyeChannelId}`);
        return;
    }

    const formatData = { user, guild, member };
    const goodbyeMessage = formatWelcomeMessage(
        welcomeConfig.leaveMessage || welcomeConfig.leaveEmbed?.description || '{user.tag} has left the server.',
        formatData
    );
    const embedTitle = formatWelcomeMessage(welcomeConfig.leaveEmbed?.title || '👋 Goodbye', formatData);
    const embedFooter = welcomeConfig.leaveEmbed?.footer
        ? formatWelcomeMessage(welcomeConfig.leaveEmbed.footer, formatData)
        : `Goodbye from ${guild.name}!`;
    const allowedMentions = welcomeConfig?.goodbyePing ? { parse: [], users: [user.id] } : { parse: [] };

    if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
        const text = welcomeConfig?.goodbyePing ? `<@${user.id}> ${goodbyeMessage}` : goodbyeMessage;
        await channel.send({ content: text.slice(0, 2000), allowedMentions });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(embedTitle.slice(0, 256))
        .setDescription(goodbyeMessage.slice(0, 4096))
        .setColor(welcomeConfig.leaveEmbed?.color || getColor('error'))
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
            { name: 'Member Count', value: guild.memberCount.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: embedFooter.slice(0, 2048) });

    const imageUrl = typeof welcomeConfig.leaveEmbed?.image === 'string'
        ? welcomeConfig.leaveEmbed.image
        : welcomeConfig.leaveEmbed?.image?.url;
    if (typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
        embed.setImage(imageUrl);
    }

    await channel.send({
        content: welcomeConfig?.goodbyePing ? `<@${user.id}>` : undefined,
        allowedMentions,
        embeds: [embed]
    });
}
