import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { db } from '../../utils/database.js';
import { getRaidShieldEngineStatus } from '../../services/aiModerationService.js';
import { NEXUS_AI_CHAT_DISABLED } from '../../services/nexusAiService.js';

// Plain-language health of the parts members depend on — each line reflects observed state
// (real database status, real RaidShield calls), never an assumption.
export function buildHealthFields() {
    const status = db.getStatus();
    const backend = { firestore: 'Firebase Firestore', postgresql: 'PostgreSQL (fallback)', memory: 'In-memory', none: 'Not connected' }[status.connectionType] || status.connectionType;
    const dbLine = status.persistent
        ? `🟢 ${backend}`
        : `🔴 ${backend} — **data is NOT saved and will be lost on restart**`;
    const failures = status.readFailures || status.writeFailures
        ? `\n⚠️ ${status.readFailures} failed read(s), ${status.writeFailures} failed write(s) since start`
        : '';

    const engine = getRaidShieldEngineStatus();
    const engineLine = !engine.configured
        ? '⚪ Not configured'
        : engine.state === 'operational' ? '🟢 Reachable'
            : engine.state === 'unavailable' ? '🔴 Unreachable — AI scans paused (no action on unscanned messages)'
                : '⚪ Not used since restart';

    return [
        { name: 'Database', value: dbLine + failures, inline: false },
        { name: 'RaidShield AI engine', value: engineLine, inline: true },
        { name: 'Nexus AI chat', value: NEXUS_AI_CHAT_DISABLED ? '⏸️ Switched off' : '🟢 Enabled', inline: true },
    ];
}

export default {
    allowDM: true,
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check the bot's latency and the health of its database and AI services"),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Ping interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ping'
            });
            return;
        }

        try {
            await InteractionHelper.safeEditReply(interaction, {
                content: "Pinging...",
            });

            const latency = Date.now() - interaction.createdTimestamp;
            const apiLatency = Math.round(interaction.client.ws.ping);

            const embed = createEmbed({ title: "🏓 Pong!", description: null }).addFields(
                { name: "Bot Latency", value: `${latency}ms`, inline: true },
                { name: "API Latency", value: `${apiLatency}ms`, inline: true },
                ...buildHealthFields(),
            );

            await InteractionHelper.safeEditReply(interaction, {
                content: null,
                embeds: [embed],
            });
        } catch (error) {
            logger.error('Ping command error:', error);
            try {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({ title: 'System Error', description: 'Could not determine latency at this time.', color: 'error' })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        }
    },
};




