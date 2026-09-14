import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// "Nexus Code" now lives as a permanent page in the dashboard nav (like the "Code" tab on
// claude.ai) rather than behind a single-use generated link — this command is just a convenient
// pointer to it. Your own GitHub token, entered fresh on that page every time, is the real
// gatekeeper: it's never generated or stored here, and this command touches no database at all.
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
        .setDescription('Get the link to Nexus Code, where you can have Nexus propose (and, once you approve, push) changes to YOUR OWN GitHub repo'),

    async execute(interaction, guildConfig, client) {
        try {
            const link = `${getDashboardBaseUrl()}/nexus-code`;

            const embed = createEmbed({
                title: '🧑‍💻 Nexus Code',
                description:
                    `${link}\n\n` +
                    `Give Nexus **your own** GitHub repo URL, a file to change, and your own token — you'll see ` +
                    `the exact diff before anything gets pushed, and nothing is pushed without your approval. ` +
                    `Never your token, never anyone else's repo.`,
                color: 'primary',
            });

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });

            logger.info('editrepo command executed', {
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
