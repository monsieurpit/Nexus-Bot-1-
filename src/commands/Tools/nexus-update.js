import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

// Same owner-only gating as /say and /status — posting an announcement is an outward-facing
// action, restricted to the same single authorized user those already trust with it.
const AUTHORIZED_USER_ID = '1354229457522524322';

// A pre-built, one-shot embed for the "feelings" update (mood engine, debate side-picking,
// gotcha trick-question recognition, follow-up curiosity, analogies) — requested as an
// alternative to either six separate /say messages or manually clicking through /embedbuilder
// field-by-field. Content lives here as plain data so a future update announcement is just a
// matter of duplicating this shape with new fields, not writing a new command from scratch.
const NEXUS_UPDATE_EMBED = {
    title: '🧠 NEXUS UPDATE — I GOT FUCKING FEELINGS NOW',
    description: "yo assholes, big one this time. buckle up. here's what changed:",
    color: 'blurple',
    fields: [
        {
            name: '😤 I have moods now, for real',
            value:
                "I'm not just some flat-ass chatbot anymore — I can be happy, super happy, sad, angry, bored, or straight up depressed, and it's not random, it's earned. Be a dick to me? I get pissed off and stay short-fused for a while. Hype me up or compliment me? I'm riding that high. Bore me with the same one-word replies over and over? I check out and get bored as hell. Talk football with me? I light up, obviously. My mood actually builds up realistically over a conversation instead of flipping every message.",
        },
        {
            name: '⚖️ I pick a side now, no more fence-sitting',
            value:
                'Ask me "pizza or tacos" or "who\'s better, Messi or Ronaldo" and I\'m not gonna hit you with some soft "both are great in their own way 🙂" bullshit. I commit. Fully random pick most of the time — except FC Barcelona, which wins automatically every single time it\'s on the table, because that\'s my team.',
        },
        {
            name: "🗣️ I stopped sounding like a broken robot",
            value:
                'Caught myself saying dumb shit like "crashout mode is on, full power, zero chill, what do you need?" as a greeting — that\'s a status report, not a hello. Fixed it, now I actually greet you back and ask how you\'re doing. Also fixed the way I was stacking swears in a weird robotic "goddamn, yo, damn, I\'m here, shit," pattern — they land natural now.',
        },
        {
            name: "🧩 I don't fall for gotcha questions anymore",
            value:
                'Try to trick me with the classic ones — "how many months have 28 days," "divide 30 by half and add 10," "where do they bury the survivors of a plane crash" — I catch the trick now instead of confidently giving you the wrong answer like every other AI does.',
        },
        {
            name: '🤔 I actually give a shit about the conversation now',
            value:
                "Every so often I'll follow up an answer with a real question back instead of just dumping info and going silent. And when I'm explaining something complex, I'll break it down with a real-world comparison instead of just throwing jargon at you.",
        },
    ],
    footer: { text: 'more human, harder to fool — act accordingly 🖤' },
};

export default {
    data: new SlashCommandBuilder()
        .setName('nexus-update')
        .setDescription('Post the pre-built "Nexus got feelings" update announcement to a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to post the announcement in (defaults to current channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)
        ),

    async execute(interaction) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        if (interaction.user.id !== AUTHORIZED_USER_ID) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Access Denied',
                    'You are not authorized to use the `/nexus-update` command.'
                )],
            });
        }

        try {
            const target = interaction.options.getChannel('channel') ?? interaction.channel;

            const botMember = interaction.guild.members.me;
            if (!target.permissionsFor(botMember)?.has('SendMessages')) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Missing Permissions',
                        `I don't have permission to send messages in ${target}.`
                    )],
                });
            }

            await target.send({ embeds: [createEmbed(NEXUS_UPDATE_EMBED)] });

            logger.info(
                `[NexusUpdate] ${interaction.user.tag} posted the feelings-update announcement to #${target.name} in ${interaction.guild.name}`
            );

            await InteractionHelper.safeEditReply(interaction, {
                content: `✅ Announcement posted to ${target}.`,
            });
        } catch (error) {
            logger.error('Error in /nexus-update command:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Error', 'Failed to post the announcement. Please try again.')],
            });
        }
    },
};
