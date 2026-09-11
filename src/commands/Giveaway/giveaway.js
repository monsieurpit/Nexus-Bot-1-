import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { NexusBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway, deleteGiveaway } from '../../utils/giveaways.js';
import {
    parseDuration,
    validatePrize,
    validateWinnerCount,
    createGiveawayEmbed,
    createGiveawayButtons,
    endGiveaway as endGiveawayService,
    selectWinners
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { guardGuild, guardPermission } from '../../utils/commandGuards.js';
import { safeLogEvent } from '../../utils/safeLogger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage server giveaways (create, end, reroll, delete)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Starts a new giveaway in a specified channel.')
                .addStringOption(opt =>
                    opt.setName('duration')
                        .setDescription('How long the giveaway lasts (e.g. 1h, 30m, 5d).')
                        .setRequired(true))
                .addIntegerOption(opt =>
                    opt.setName('winners')
                        .setDescription('Number of winners to pick (1-20).')
                        .setMinValue(1)
                        .setMaxValue(20)
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('prize')
                        .setDescription('What is being given away.')
                        .setRequired(true))
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to post the giveaway in (defaults to current).')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('Extra description shown on the giveaway embed.')
                        .setMaxLength(512)
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('image')
                        .setDescription('Image URL displayed as a banner on the giveaway embed.')
                        .setRequired(false))
                .addRoleOption(opt =>
                    opt.setName('required_role')
                        .setDescription('Role members must have to enter the giveaway.')
                        .setRequired(false))
                .addRoleOption(opt =>
                    opt.setName('bonus_role')
                        .setDescription('Role that earns extra entries (use with bonus_entries).')
                        .setRequired(false))
                .addIntegerOption(opt =>
                    opt.setName('bonus_entries')
                        .setDescription('Bonus entries awarded for having the bonus role (1-10).')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('end')
                .setDescription('Ends an active giveaway immediately and picks the winner(s).')
                .addStringOption(opt =>
                    opt.setName('messageid')
                        .setDescription('The message ID of the giveaway to end.')
                        .setRequired(true))
        )
        .addSubcommand(sub =>
            sub
                .setName('reroll')
                .setDescription('Rerolls the winner(s) for an ended giveaway.')
                .addStringOption(opt =>
                    opt.setName('messageid')
                        .setDescription('The message ID of the ended giveaway.')
                        .setRequired(true))
        )
        .addSubcommand(sub =>
            sub
                .setName('delete')
                .setDescription('Deletes a giveaway message and removes it from the database.')
                .addStringOption(opt =>
                    opt.setName('messageid')
                        .setDescription('The message ID of the giveaway to delete.')
                        .setRequired(true))
        ),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            return handleCreate(interaction);
        } else if (subcommand === 'end') {
            return handleEnd(interaction);
        } else if (subcommand === 'reroll') {
            return handleReroll(interaction);
        } else if (subcommand === 'delete') {
            return handleDelete(interaction);
        }
    }
};

async function handleCreate(interaction) {
    try {
        guardGuild(interaction);
        guardPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');

        const durationStr = interaction.options.getString('duration');
        const winners = interaction.options.getInteger('winners');
        const prize = interaction.options.getString('prize');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const description = interaction.options.getString('description') || null;
        const image = interaction.options.getString('image') || null;
        const requiredRole = interaction.options.getRole('required_role') || null;
        const bonusRole = interaction.options.getRole('bonus_role') || null;
        const bonusEntries = interaction.options.getInteger('bonus_entries') || null;

        if (bonusEntries && !bonusRole) {
            throw new NexusBotError(
                'Bonus entries specified without bonus role',
                ErrorTypes.VALIDATION,
                'You specified `bonus_entries` but did not select a `bonus_role`. Please specify both or neither.',
                { bonusEntries }
            );
        }

        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            throw new NexusBotError(
                'Invalid duration format',
                ErrorTypes.VALIDATION,
                'Invalid duration format. Use values like `1h`, `30m`, `5d`, or `1w`.',
                { durationStr }
            );
        }

        const prizeError = validatePrize(prize);
        if (prizeError) {
            throw new NexusBotError(
                'Invalid prize',
                ErrorTypes.VALIDATION,
                prizeError,
                { prize }
            );
        }

        const winnerError = validateWinnerCount(winners);
        if (winnerError) {
            throw new NexusBotError(
                'Invalid winner count',
                ErrorTypes.VALIDATION,
                winnerError,
                { winners }
            );
        }

        if (!targetChannel.isTextBased()) {
            throw new NexusBotError(
                'Target channel is not text-based',
                ErrorTypes.VALIDATION,
                'The specified channel is not a text channel.',
                { channelId: targetChannel.id }
            );
        }

        const botMember = interaction.guild.members.me;
        const requiredPerms = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
        ];
        const missing = requiredPerms.filter(p => !botMember.permissionsIn(targetChannel).has(p));
        if (missing.length > 0) {
            throw new NexusBotError(
                'Bot lacks permissions in target channel',
                ErrorTypes.PERMISSION,
                `I am missing permissions in ${targetChannel}: **${missing.map(p => Object.keys(PermissionFlagsBits).find(k => PermissionFlagsBits[k] === p)).join(', ')}**`,
                { missingPermissions: missing, channelId: targetChannel.id }
            );
        }

        const endsAt = new Date(Date.now() + durationMs);

        const giveawayObj = {
            id: null,
            messageId: null,
            channelId: targetChannel.id,
            guildId: interaction.guildId,
            hostId: interaction.user.id,
            prize: prize.trim(),
            description: description ? description.trim() : null,
            image: image ? image.trim() : null,
            winnerCount: winners,
            requiredRoleId: requiredRole ? requiredRole.id : null,
            bonusRoleId: bonusRole ? bonusRole.id : null,
            bonusEntries: bonusEntries || 0,
            endsAt: endsAt.toISOString(),
            ended: false,
            winnerIds: [],
            participants: [],
            createdAt: new Date().toISOString()
        };

        const embed = createGiveawayEmbed(giveawayObj, 'active');
        const row = createGiveawayButtons(false);

        const giveawayMessage = await targetChannel.send({
            content: '🎉 **GIVEAWAY** 🎉',
            embeds: [embed],
            components: [row]
        });

        giveawayObj.id = giveawayMessage.id;
        giveawayObj.messageId = giveawayMessage.id;

        await saveGiveaway(interaction.client, interaction.guildId, giveawayObj);

        await safeLogEvent(() => logEvent({
            client: interaction.client,
            guildId: interaction.guildId,
            eventType: EVENT_TYPES.GIVEAWAY_START,
            data: {
                description: `Giveaway created: ${prize}`,
                channelId: targetChannel.id,
                userId: interaction.user.id,
                fields: [
                    { name: '🎁 Prize', value: prize, inline: true },
                    { name: '👥 Winners', value: winners.toString(), inline: true },
                    { name: '⏳ Ends', value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true }
                ]
            }
        }), 'giveaway creation');

        return InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    'Giveaway Created 🎉',
                    `Successfully started the giveaway for **${prize}** in ${targetChannel}!\nEnds <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`
                )
            ],
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        await handleInteractionError(interaction, error, {
            type: 'command',
            commandName: 'giveaway create'
        });
    }
}

async function handleEnd(interaction) {
    try {
        guardGuild(interaction);
        guardPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');

        const messageId = interaction.options.getString('messageid');
        if (!messageId || !/^\d+$/.test(messageId)) {
            throw new NexusBotError('Invalid message ID format', ErrorTypes.VALIDATION, 'Please provide a valid message ID.');
        }

        const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
        const giveaway = giveaways.find(g => g.messageId === messageId);
        if (!giveaway) {
            throw new NexusBotError('Giveaway not found', ErrorTypes.VALIDATION, 'No giveaway was found with that message ID in the database.');
        }

        const endResult = await endGiveawayService(interaction.client, giveaway, interaction.guildId, interaction.user.id);
        const updatedGiveaway = endResult.giveaway;
        const winners = endResult.winners;

        const channel = await interaction.client.channels.fetch(updatedGiveaway.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            throw new NexusBotError('Channel not found', ErrorTypes.VALIDATION, 'Could not find the channel where the giveaway was hosted.');
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
            throw new NexusBotError('Message not found', ErrorTypes.VALIDATION, 'Could not find the giveaway message.');
        }

        await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);

        const newEmbed = createGiveawayEmbed(updatedGiveaway, 'ended', winners);
        const newRow = createGiveawayButtons(true);

        await message.edit({
            content: '🎉 **GIVEAWAY ENDED** 🎉',
            embeds: [newEmbed],
            components: [newRow]
        });

        if (winners.length > 0) {
            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            const winnerPingMsg = await channel.send({
                content: `🎉 CONGRATULATIONS ${winnerMentions}! You won the **${updatedGiveaway.prize}** giveaway! Please contact the host <@${updatedGiveaway.hostId}> to claim your prize.`
            });
            updatedGiveaway.winnerPingMessageId = winnerPingMsg.id;
            await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);
        } else {
            await channel.send({
                content: `The giveaway for **${updatedGiveaway.prize}** has ended with no valid entries.`
            });
        }

        return InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    'Giveaway Ended ✅',
                    `Successfully ended **${updatedGiveaway.prize}** in ${channel}.\n**${winners.length}** winner(s) selected from **${endResult.participantCount}** unique entrant(s).`
                )
            ],
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        await handleInteractionError(interaction, error, {
            type: 'command',
            commandName: 'giveaway end'
        });
    }
}

async function handleReroll(interaction) {
    try {
        guardGuild(interaction);
        guardPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');

        const messageId = interaction.options.getString('messageid');
        if (!messageId || !/^\d+$/.test(messageId)) {
            throw new NexusBotError('Invalid message ID format', ErrorTypes.VALIDATION, 'Please provide a valid message ID.');
        }

        const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
        const giveaway = giveaways.find(g => g.messageId === messageId);
        if (!giveaway) {
            throw new NexusBotError('Giveaway not found', ErrorTypes.VALIDATION, 'No giveaway was found with that message ID in the database.');
        }

        if (!giveaway.isEnded && !giveaway.ended) {
            throw new NexusBotError('Giveaway still active', ErrorTypes.VALIDATION, 'This giveaway is still active. Please end it first using `/giveaway end`.');
        }

        const participants = giveaway.participants || [];
        if (participants.length < giveaway.winnerCount) {
            throw new NexusBotError('Insufficient participants', ErrorTypes.VALIDATION, 'Not enough entries to pick the required number of winners.');
        }

        const newWinners = selectWinners(participants, giveaway.winnerCount);
        const updatedGiveaway = {
            ...giveaway,
            winnerIds: newWinners,
            rerolledAt: new Date().toISOString(),
            rerolledBy: interaction.user.id
        };

        const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);
            return InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed('Reroll Complete', 'The new winners have been selected and saved to the database. Could not find channel to announce.')],
                flags: MessageFlags.Ephemeral
            });
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        const winnerMentions = newWinners.map(id => `<@${id}>`).join(', ');

        const announceWinners = async (ch) => {
            const newPingMsg = await ch.send({
                content: `🔄 **REROLL WINNERS** 🔄 CONGRATULATIONS ${winnerMentions}! You are the new winner(s) for the **${giveaway.prize}** giveaway! Please contact the host <@${giveaway.hostId}> to claim your prize.`
            });
            updatedGiveaway.winnerPingMessageId = newPingMsg.id;
        };

        await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);

        if (message) {
            const newEmbed = createGiveawayEmbed(updatedGiveaway, 'reroll', newWinners);
            const newRow = createGiveawayButtons(true);
            await message.edit({
                content: '🔄 **GIVEAWAY REROLLED** 🔄',
                embeds: [newEmbed],
                components: [newRow]
            });
        }

        await announceWinners(channel);

        return InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    'Reroll Successful ✅',
                    `Successfully rerolled the giveaway for **${giveaway.prize}** in ${channel}. Selected ${newWinners.length} new winner(s).`
                )
            ],
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        await handleInteractionError(interaction, error, {
            type: 'command',
            commandName: 'giveaway reroll'
        });
    }
}

async function handleDelete(interaction) {
    try {
        guardGuild(interaction);
        guardPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server');

        const messageId = interaction.options.getString('messageid');
        if (!messageId || !/^\d+$/.test(messageId)) {
            throw new NexusBotError('Invalid message ID format', ErrorTypes.VALIDATION, 'Please provide a valid message ID.');
        }

        const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
        const giveaway = giveaways.find(g => g.messageId === messageId);
        if (!giveaway) {
            throw new NexusBotError('Giveaway not found', ErrorTypes.VALIDATION, 'No giveaway was found with that message ID.');
        }

        let deletedMessage = false;
        let channelName = 'Unknown Channel';

        try {
            const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
            if (channel && channel.isTextBased()) {
                const message = await channel.messages.fetch(messageId).catch(() => null);
                if (message) {
                    await message.delete();
                    channelName = channel.name || 'unknown-channel';
                    deletedMessage = true;
                }
            }
        } catch (err) {
            logger.warn(`Could not delete giveaway message: ${err.message}`);
        }

        await deleteGiveaway(interaction.client, interaction.guildId, messageId);

        const statusMsg = deletedMessage
            ? `and the message was deleted from #${channelName}`
            : `but the message was already deleted or inaccessible.`;

        return InteractionHelper.safeReply(interaction, {
            embeds: [
                successEmbed(
                    'Giveaway Deleted',
                    `Successfully deleted the giveaway for **${giveaway.prize}** ${statusMsg}.`
                )
            ],
            flags: MessageFlags.Ephemeral
        });
    } catch (error) {
        await handleInteractionError(interaction, error, {
            type: 'command',
            commandName: 'giveaway delete'
        });
    }
}
