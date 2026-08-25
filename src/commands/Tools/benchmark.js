import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { nexusClient } from '../../services/nexusAiService.js';
import { getGuildConfig } from '../../services/guildConfig.js';

// Guild-only test-server tooling — never registered globally, see announce.js's comment /
// commandLoader.js's registerCommands() for how guildOnly commands are scoped.
//
// Fires several real LLM calls against the deployed engine, which — per this session's own
// Ollama-concurrency work on the engine side — is only safe for one request at a time on the Mac
// Mini it runs on. Admin-gated so it can't be spammed by regular members and stack up alongside
// real user traffic.
export default {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('benchmark')
        .setDescription('Run a quick speed/coherence check against the AI engine (admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                embeds: [createEmbed({
                    title: 'Permission Denied',
                    description: 'You need Administrator permission to use this command.',
                    color: 'error'
                })],
                flags: MessageFlags.Ephemeral
            });
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Benchmark interaction defer failed', { userId: interaction.user.id, guildId: interaction.guildId });
            return;
        }

        // One prompt per rough category, not an exhaustive suite — enough to spot a genuinely
        // broken deploy (timeouts, empty responses, wrong-language drift) without hammering the
        // single-request-at-a-time engine for a long time.
        const TEST_PROMPTS = [
            { label: 'Factual', prompt: 'What is the capital of France?' },
            { label: 'Conversational', prompt: 'whats up' },
            { label: 'Polish', prompt: 'Jak się masz?' },
            { label: 'Broad', prompt: 'Explain how photosynthesis works' },
        ];

        // Deliberately basic — not a rigorous coherence/quality eval. Just enough to catch the
        // obvious failure modes (empty reply, a couple words, or the same word looping) without
        // pretending to score actual response quality.
        function isRoughlyCoherent(text) {
            if (!text || typeof text !== 'string') return false;
            const words = text.trim().split(/\s+/).filter(Boolean);
            if (words.length < 4) return false;
            let runLength = 1;
            for (let i = 1; i < words.length; i++) {
                if (words[i].toLowerCase() === words[i - 1].toLowerCase()) {
                    runLength++;
                    if (runLength >= 5) return false;
                } else {
                    runLength = 1;
                }
            }
            return true;
        }

        const results = [];
        for (const { label, prompt } of TEST_PROMPTS) {
            const startedAt = Date.now();
            try {
                const data = await nexusClient.askJSON({ prompt, authorId: interaction.user.id, username: interaction.user.username });
                const latencyMs = Date.now() - startedAt;
                const text = data?.response || data?.text || '';
                results.push({
                    label,
                    latencyMs,
                    coherent: isRoughlyCoherent(text),
                    language: data?.telemetry?.language ?? 'n/a',
                    temperature: data?.telemetry?.temperature ?? 'n/a',
                    ok: true,
                });
            } catch (error) {
                results.push({ label, latencyMs: Date.now() - startedAt, coherent: false, language: 'n/a', temperature: 'n/a', ok: false, error: error.message });
            }
        }

        const avgLatency = Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length);
        const passCount = results.filter(r => r.ok && r.coherent).length;

        const table = results
            .map(r => `**${r.label}** — ${r.ok ? `${r.latencyMs}ms, ${r.coherent ? '✅ coherent' : '⚠️ looks off'}, lang=${r.language}, temp=${r.temperature}` : `❌ failed (${r.error})`}`)
            .join('\n');

        const embed = createEmbed({
            title: '🧪 AI Engine Benchmark',
            description: `${passCount}/${results.length} passed a basic coherence check. Average latency: ${avgLatency}ms.\n\n${table}\n\n*Coherence here is a basic heuristic (non-empty, minimum length, no repeated-word run) — not a quality/accuracy eval.*`,
            color: passCount === results.length ? 'success' : passCount > 0 ? 'warning' : 'error',
        });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

        // Also cross-post to #benchmark-suite when configured, so a run from any admin lands in
        // one shared channel history, not just the invoker's ephemeral-adjacent reply thread.
        if (interaction.guild) {
            const config = await getGuildConfig(interaction.client, interaction.guild.id).catch(() => null);
            const benchmarkChannelId = config?.aiTelemetry?.benchmarkSuiteChannelId;
            if (benchmarkChannelId) {
                const channel = await interaction.guild.channels.fetch(benchmarkChannelId).catch(() => null);
                if (channel) {
                    await channel.send({ embeds: [embed] }).catch((err) => logger.warn(`Could not cross-post benchmark results: ${err.message}`));
                }
            }
        }
    },
};
