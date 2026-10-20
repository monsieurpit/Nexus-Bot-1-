import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getOpenMode, setOpenMode } from '../../services/nexusOpenModeService.js';

// /nexus-open (Patrick, 2026-10-19): turn Nexus's open mode on or off for this server — he reads every message in the
// chat channels and joins in like a member (~75% of the time), staying out of conversations between other people.
// Server managers only; per server, stored in the bot's database (no redeploy).
export default {
    data: new SlashCommandBuilder()
        .setName('nexus-open')
        .setDescription('Let Nexus read the chat and join in on his own (open mode)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName('on')
                .setDescription('Turn open mode on for this server')
                .addStringOption((o) =>
                    o
                        .setName('channels')
                        .setDescription('Where he can join in (default: channels with "chat" or "general" in the name)')
                        .addChoices({ name: 'chat / general channels', value: 'chat' }, { name: 'all channels', value: 'all' })
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) => sub.setName('off').setDescription('Turn open mode off (he only answers when called by name)'))
        .addSubcommand((sub) => sub.setName('status').setDescription('Show whether open mode is on')),

    async execute(interaction, guildConfig, client) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This only works in a server.', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                embeds: [createEmbed({ title: 'Permission Denied', description: 'You need the **Manage Server** permission to change Nexus open mode.', color: 'error' })],
                flags: MessageFlags.Ephemeral,
            });
        }
        const ok = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!ok) return;
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'status') {
                const cfg = await getOpenMode(client, interaction.guildId);
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: `Nexus open mode: ${cfg.enabled ? 'ON' : 'OFF'}`,
                        description: cfg.enabled
                            ? `He reads ${cfg.scope === 'all' ? '**all channels**' : 'channels with **chat** or **general** in the name'} and joins in about 75% of the time — never when people talk to each other, never in ticket / staff channels.`
                            : 'He only answers when someone says "nexus", pings him or replies to him.',
                        color: cfg.enabled ? 'success' : 'info',
                    })],
                });
            }
            const enabled = sub === 'on';
            const scope = enabled ? interaction.options.getString('channels') || 'chat' : 'chat';
            await setOpenMode(client, interaction.guildId, { enabled, scope });
            logger.info(`[openMode] ${enabled ? 'enabled' : 'disabled'} in guild ${interaction.guildId} (${scope}) by ${interaction.user.id}`);
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: enabled ? '✅ Nexus open mode is ON' : 'Nexus open mode is OFF',
                    description: enabled
                        ? `Nexus now reads ${scope === 'all' ? '**all channels**' : 'channels with **chat** or **general** in the name'} and joins in on his own about 75% of the time.\n• He stays out of conversations between other people (pings, replies, names, back-and-forths).\n• Never in ticket / staff / log channels.\n• \`/nexus-open off\` turns it off.`
                        : 'Back to normal: he only answers when someone says "nexus", pings him or replies to him.',
                    color: enabled ? 'success' : 'info',
                })],
            });
        } catch (err) {
            logger.error('[nexus-open] failed:', err);
            return InteractionHelper.safeEditReply(interaction, { content: "Couldn't save that, try again in a sec." });
        }
    },
};
