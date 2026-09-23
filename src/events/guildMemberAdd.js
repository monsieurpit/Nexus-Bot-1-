import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../config/bot.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { getWelcomeConfig } from '../utils/database.js';
import { formatWelcomeMessage } from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { scheduleCounterRefresh } from '../services/serverstatsService.js';
import { logger } from '../utils/logger.js';
import { checkAndAnnounceMilestone } from '../services/milestoneService.js';
import { RaidDetectionService } from '../services/raidDetectionService.js';
import { recordWeeklyStat } from '../services/weeklySummaryService.js';

export default {
  name: Events.GuildMemberAdd,
  once: false,
  
  async execute(member) {
    const { guild, user } = member;
    const client = member.client;

    recordWeeklyStat(client, guild.id, 'joins').catch(() => null);

    // Every step below is isolated: one failing (a welcome channel the bot lost access to, a bad
    // welcome image URL, a missing role…) must never skip the steps after it. Previously a missing
    // welcome-channel permission `return`ed out of the whole handler, silently skipping auto-roles,
    // verification, join logging, milestones — and raid detection.
    const config = await getGuildConfig(client, guild.id).catch(() => null);
    const welcomeConfig = await getWelcomeConfig(client, guild.id).catch(() => null);

    await runStep('welcome message', () => sendWelcomeMessage(member, welcomeConfig));
    await runStep('auto roles', () => assignAutoRoles(member, welcomeConfig));

    if (config?.verification?.enabled || config?.verification?.autoVerify?.enabled) {
        await runStep('verification', () => handleVerification(member, guild, config.verification, client));
    }

    // Raid detection runs after onboarding (so a quarantine isn't undone by the auto-roles above)
    // but before the slower, purely informational steps below.
    await runStep('raid detection', () => RaidDetectionService.processMemberJoin(member, client));

    await runStep('join log', () => logEvent({
        client,
        guildId: guild.id,
        eventType: EVENT_TYPES.MEMBER_JOIN,
        data: {
            description: `${user.tag} joined the server`,
            userId: user.id,
            fields: [
                { name: '👤 Member', value: `${user.tag} (${user.id})`, inline: true },
                { name: '👥 Member Count', value: guild.memberCount.toString(), inline: true },
                { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
            ]
        }
    }));

    // Debounced + never awaited: a counter-channel rename can be rate limited by Discord for
    // minutes, and a join burst should collapse into a single refresh.
    scheduleCounterRefresh(client, guild);

    await runStep('milestones', async () => {
        const milestoneResult = await checkAndAnnounceMilestone(client, guild, member, guild.memberCount);
        if (milestoneResult?.announced) {
            logger.info(`Milestone ${milestoneResult.milestone} announced in ${guild.name}`);
        }
    });
  }
};

async function runStep(name, fn) {
    try {
        await fn();
    } catch (error) {
        logger.warn(`guildMemberAdd: ${name} failed:`, error);
    }
}

async function sendWelcomeMessage(member, welcomeConfig) {
    const { guild, user } = member;
    const welcomeChannelId = welcomeConfig?.channelId;
    if (!welcomeConfig?.enabled || !welcomeChannelId) return;

    const channel = guild.channels.cache.get(welcomeChannelId);
    if (!channel?.isTextBased?.()) return;

    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        logger.warn(`Welcome message skipped in guild ${guild.id}: missing View/Send permission in channel ${welcomeChannelId}`);
        return;
    }

    const formatData = { user, guild, member };
    const welcomeMessage = formatWelcomeMessage(
        welcomeConfig.welcomeMessage || welcomeConfig.welcomeEmbed?.description || 'Welcome {user} to {server}!',
        formatData
    );

    const messageContent = welcomeConfig.welcomePing ? user.toString() : null;
    // Only the new member may be pinged — never @everyone/@here or roles typed into the template.
    const allowedMentions = { parse: [], users: welcomeConfig.welcomePing ? [user.id] : [] };

    const embedTitle = formatWelcomeMessage(welcomeConfig.welcomeEmbed?.title || '🎉 Welcome!', formatData);
    const embedFooter = welcomeConfig.welcomeEmbed?.footer
        ? formatWelcomeMessage(welcomeConfig.welcomeEmbed.footer, formatData)
        : `Welcome to ${guild.name}!`;

    if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
        const text = messageContent ? `${messageContent} ${welcomeMessage}` : welcomeMessage;
        await channel.send({ content: text.slice(0, 2000), allowedMentions });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(welcomeConfig.welcomeEmbed?.color || getColor('success'))
        .setTitle(embedTitle.slice(0, 256))
        .setDescription(welcomeMessage.slice(0, 4096))
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
            { name: 'Member Count', value: guild.memberCount.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: embedFooter.slice(0, 2048) });

    const imageUrl = welcomeConfig.welcomeImage || welcomeConfig.welcomeEmbed?.image?.url;
    if (typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
        embed.setImage(imageUrl);
    }

    await channel.send({ content: messageContent, embeds: [embed], allowedMentions });
}

async function assignAutoRoles(member, welcomeConfig) {
    const roleIds = Array.isArray(welcomeConfig?.roleIds) ? welcomeConfig.roleIds.slice(0, 5) : [];
    if (roleIds.length === 0) return;

    const assign = async () => {
        // Re-check the member is still here (a delayed assignment may fire after they left or
        // after raid detection quarantined/kicked them).
        const fresh = await member.guild.members.fetch(member.id).catch(() => null);
        if (!fresh) return;
        // RaidShield quarantine applies a 28-day timeout — never hand roles back to a suspect.
        if (fresh.isCommunicationDisabled?.()) return;
        for (const roleId of roleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (role) await assignRoleSafely(fresh, role);
        }
    };

    const delay = Number(welcomeConfig.autoRoleDelay) || 0;
    if (delay > 0) {
        const timeout = setTimeout(() => {
            assign().catch(error => logger.warn(`Delayed auto-role failed for ${member.id}:`, error));
        }, delay * 1000);
        timeout.unref?.();
    } else {
        await assign();
    }
}

async function handleVerification(member, guild, verificationConfig, client) {
    const { autoVerifyOnJoin } = await import('../services/verificationService.js');
    
    try {
        const result = await autoVerifyOnJoin(client, guild, member, verificationConfig);
        
        if (result.autoVerified) {
            logger.info('User auto-verified on join', {
                guildId: guild.id,
                userId: member.id,
                userTag: member.user.tag,
                roleName: result.roleName,
                criteria: result.criteria
            });
        } else {
            logger.debug('User not auto-verified on join', {
                guildId: guild.id,
                userId: member.id,
                reason: result.reason
            });
        }

    } catch (error) {
        logger.error('Error in auto-verification for member', {
            guildId: guild.id,
            userId: member.id,
            userTag: member.user.tag,
            error: error.message
        });
    }
}

async function assignRoleSafely(member, role) {
    try {
        await member.roles.add(role);
    } catch (error) {
        logger.warn(`Failed to assign role ${role.id} to member ${member.id}:`, error);
    }
}



