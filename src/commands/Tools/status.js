import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ActivityType
} from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { voiced } from '../../services/nexusAiService.js';

const AUTHORIZED_USER_ID = '1354229457522524322';

export default {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription("Change Nexus's presence status (online, idle, dnd, offline)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option
                .setName('status')
                .setDescription('Select the new presence status')
                .setRequired(true)
                .addChoices(
                    { name: '🟢 Online', value: 'online' },
                    { name: '🟡 Idle', value: 'idle' },
                    { name: '🔴 Do Not Disturb (DND)', value: 'dnd' },
                    { name: '⚫ Offline / Invisible', value: 'invisible' }
                )
        )
        .addStringOption(option =>
            option
                .setName('activity')
                .setDescription('Optional custom activity text to display')
                .setRequired(false)
                .setMaxLength(128)
        ),

    async execute(interaction) {
        // Ephemeral defer ensures the user receives a private response with no public interaction badge
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        // Anyone with Administrator in the server can use it (Patrick, 2026-10-04), plus the original owner account.
        const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
        if (interaction.user.id !== AUTHORIZED_USER_ID && !isAdmin) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Access Denied',
                    'You need the Administrator permission to use the `/status` command.'
                )],
            });
        }

        try {
            const statusChoice = interaction.options.getString('status', true);
            const customActivity = interaction.options.getString('activity');

            // Map choices to descriptive status labels
            const statusLabels = {
                online: 'Online (🟢)',
                idle: 'Idle (🟡)',
                dnd: 'Do Not Disturb (🔴)',
                invisible: 'Offline / Invisible (⚫)'
            };

            // Pool of sentence variations per status choice (original + 5 variations)
            const statusPhrases = {
                invisible: [
                    'let me sleep now',
                    'going ghost mode fr',
                    'sneaking off the radar',
                    'powering down my display, don’t miss me too much',
                    'stealth mode activated',
                    'catching some Z’s, but I still see everything'
                ],
                idle: [
                    'I’m coming back',
                    'stepping away for a min',
                    'brb grabbing some snacks',
                    'on standby mode',
                    'taking a quick breather',
                    'afk for a sec don’t burn the server down'
                ],
                online: [
                    'I’m back.',
                    'we are so back',
                    'green light on, let’s get it',
                    'fully charged and locked in',
                    'back in action',
                    'reporting for duty'
                ],
                dnd: [
                    'do not disturb',
                    'in the zone, keep it quiet',
                    'red light mode, cooking something up',
                    'busy grinding, hold your pings',
                    'do not disturb or else',
                    'hyper-focused right now'
                ]
            };

            // Nexus announces it himself, written by the AI for THIS status (Patrick, 2026-10-11); the fixed phrases are only
            // the fallback if the engine doesn't answer within a few seconds.
            const phrasesList = statusPhrases[statusChoice] || ['status updated'];
            const randomPhrase = phrasesList[Math.floor(Math.random() * phrasesList.length)];
            const channelMessage = await voiced(`status-${statusChoice}`, `I changed my status gng, ${randomPhrase}`);

            // Build presence payload
            const presencePayload = {
                status: statusChoice
            };

            if (customActivity) {
                presencePayload.activities = [
                    { name: customActivity, type: ActivityType.Custom }
                ];
            }

            // Apply presence directly to Discord client
            interaction.client.customStatus = statusChoice;
            if (customActivity) {
                interaction.client.customActivity = customActivity;
            }
            interaction.client.user.setPresence(presencePayload);

            logger.info(
                `[Status] ${interaction.user.tag} changed bot status to ${statusChoice} in guild ${interaction.guild?.name || 'DM'}`
            );

            // 1. Send standalone message to the current channel (looks 100% like Nexus posted it on its own)
            const targetChannel = interaction.channel;
            const botMember = interaction.guild?.members?.me;
            
            if (targetChannel && (!botMember || targetChannel.permissionsFor(botMember)?.has('SendMessages'))) {
                await targetChannel.send(channelMessage);
            }

            // 2. Private confirmation message to the user
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(
                    'Status Updated',
                    `Nexus status has successfully been changed to **${statusLabels[statusChoice] || statusChoice}**.\n\n` +
                    (statusChoice === 'invisible' ? '💤 *Nexus is now invisible/offline on Discord but remains fully active and responsive to all commands and messages.*' : '')
                )]
            });
        } catch (error) {
            logger.error('Error in /status command:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Error', 'Failed to update bot status. Please try again.')],
            });
        }
    },
};
