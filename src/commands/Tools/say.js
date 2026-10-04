import {
    SlashCommandBuilder,
    ChannelType,
    MessageFlags,
} from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { relayedMessageMentions } from '../../utils/commandGuards.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { recordChannelMessage } from '../../services/channelHistoryService.js';

const AUTHORIZED_USER_ID = '1554657430393196594';

export default {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Make Nexus send a message to any channel')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setRequired(true)
                .setMaxLength(2000)
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to send the message in (defaults to current channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)
        ),

    async execute(interaction) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        // Restrict to authorized user ID only
        if (interaction.user.id !== AUTHORIZED_USER_ID) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Access Denied',
                    'You are not authorized to use the `/say` command.'
                )],
            });
        }

        try {
            const message = interaction.options.getString('message', true);
            const target  = interaction.options.getChannel('channel') ?? interaction.channel;

            // Verify the bot can send messages in the target channel
            const botMember = interaction.guild.members.me;
            if (!target.permissionsFor(botMember)?.has('SendMessages')) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Missing Permissions',
                        `I don't have permission to send messages in ${target}.`
                    )],
                });
            }

            // @everyone/@here/role pings only if the member could send them themselves.
            const sent = await target.send({ content: message, allowedMentions: relayedMessageMentions(interaction.member) });
            // Nexus "said" this, so it goes into his channel memory as his own message: a reply to it ("why are you
            // scratching your balls 😭") is then answered knowing he said it (2026-10-04).
            recordChannelMessage(target.id, {
                messageId: sent?.id,
                authorId: interaction.client.user.id,
                username: 'Nexus',
                content: message,
                isBot: true,
            });

            logger.info(
                `[Say] ${interaction.user.tag} sent a message to #${target.name} in ${interaction.guild.name}`
            );

            await InteractionHelper.safeEditReply(interaction, {
                content: `✅ Message sent to ${target}.`,
            });
        } catch (error) {
            logger.error('Error in /say command:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Error', 'Failed to send the message. Please try again.')],
            });
        }
    },
};
