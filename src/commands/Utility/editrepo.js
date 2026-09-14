import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { randomBytes } from 'crypto';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { firestoreDb } from '../../utils/firestoreDatabase.js';

const SESSION_PREFIX = 'codeedit:session:';
const SESSION_TTL_SECONDS = 15 * 60;

function getDashboardBaseUrl() {
    const explicit = process.env.DASHBOARD_URL;
    if (explicit) return explicit.replace(/\/$/, '');
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (railwayDomain) return `https://${railwayDomain}`;
    const railwayStatic = process.env.RAILWAY_STATIC_URL;
    if (railwayStatic) return railwayStatic.startsWith('http') ? railwayStatic.replace(/\/$/, '') : `https://${railwayStatic}`;
    return 'http://localhost:3000';
}

export default {
    data: new SlashCommandBuilder()
        .setName('editrepo')
        .setDescription('Get Nexus to propose (and, once you approve, push) a code change to YOUR OWN GitHub repo'),

    async execute(interaction, guildConfig, client) {
        try {
            if (!firestoreDb.isAvailable()) {
                await firestoreDb.connect().catch(() => false);
            }
            const token = randomBytes(32).toString('hex');
            const session = {
                discordUserId: interaction.user.id,
                discordUsername: interaction.user.username,
                createdAt: Date.now(),
                expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
                used: false,
            };

            const saved = await firestoreDb.set(`${SESSION_PREFIX}${token}`, session, SESSION_TTL_SECONDS);
            if (!saved) {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Nexus Code is unavailable right now (storage backend not connected). Try again later.', 'Nexus Code')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const link = `${getDashboardBaseUrl()}/nexus-code?session=${token}`;

            const embed = createEmbed({
                title: '🧑‍💻 Nexus Code',
                description:
                    `Open this link to give Nexus access to **your own** GitHub repo and describe a code change:\n\n${link}\n\n` +
                    `**Only your own repo — never share this link.** You'll see Nexus's exact diff before anything gets pushed, ` +
                    `and nothing is pushed without your approval. This link expires in 15 minutes and works once.`,
                color: 'primary',
            });

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });

            logger.info('editrepo command executed - session link generated', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
            });
        } catch (error) {
            logger.error('editrepo command execution failed', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'editrepo',
            });
            await handleInteractionError(interaction, error, {
                commandName: 'editrepo',
                source: 'editrepo_command',
            });
        }
    },
};
