import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { buildServer, previewServerBuild, BUILD_SCOPES } from '../../services/serverBuilderService.js';

// Internal test-server tooling — same treatment as /announce, /benchmark and
// /set-ai-telemetry: registered only in the configured dev/home guild so it
// syncs instantly and never shows up in other servers the bot happens to join.
// Remove `guildOnly` to make it a normal global command.
export default {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('build-server')
    .setDescription('Scaffold the whole server — roles, categories and channels — from the bot blueprint')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Show what would be created without changing anything')
        .addStringOption((o) =>
          o.setName('scope').setDescription('How much to build').addChoices(
            { name: 'core', value: 'core' },
            { name: 'core-ai (default)', value: 'core-ai' },
            { name: 'full (adds FC Barcelona section)', value: 'full' },
          ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Create every missing role, category and channel (additive — nothing is deleted)')
        .addStringOption((o) =>
          o.setName('scope').setDescription('How much to build').addChoices(
            { name: 'core', value: 'core' },
            { name: 'core-ai (default)', value: 'core-ai' },
            { name: 'full (adds FC Barcelona section)', value: 'full' },
          ),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const scope = interaction.options.getString('scope') || 'core-ai';

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return InteractionHelper.safeReply(interaction, {
        embeds: [errorEmbed('Permission Denied', 'You need Administrator permission to use this command.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const botMe = interaction.guild.members.me;
    if (!botMe?.permissions.has(PermissionFlagsBits.ManageChannels) || !botMe?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return InteractionHelper.safeReply(interaction, {
        embeds: [errorEmbed('Missing Permissions', 'I need **Manage Channels** and **Manage Roles** (Administrator is easiest). Give me those and try again.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

    // ── PREVIEW ────────────────────────────────────────────────────────────
    const preview = previewServerBuild(interaction.guild, scope);
    const summarise = (arr) => arr.map((x) => (x.exists ? `~~${x.name}~~` : x.name)).join(', ');
    const previewFields = [
      { name: `Roles (${preview.totals.roles})`, value: summarise(preview.roles).slice(0, 1024) || '—' },
      ...preview.categories.map((cat) => ({
        name: `${cat.exists ? '↳ existing · ' : ''}${cat.name}`,
        value: summarise(cat.channels).slice(0, 1024) || '—',
      })),
    ];

    if (sub === 'preview') {
      return InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: `🏗️ Build preview — scope: ${scope}`,
          description: `${BUILD_SCOPES[scope]}\n\n~~struck-through~~ items already exist and will be skipped. Run \`/build-server run scope:${scope}\` to create the rest.`,
          color: 'info',
          fields: previewFields,
        })],
      });
    }

    // ── RUN — confirm first ────────────────────────────────────────────────
    const confirmId = `buildserver-confirm-${interaction.id}`;
    const cancelId = `buildserver-cancel-${interaction.id}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('Build it').setStyle(ButtonStyle.Success).setEmoji('🏗️'),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await InteractionHelper.safeEditReply(interaction, {
      embeds: [createEmbed({
        title: `🏗️ Build the server? — scope: ${scope}`,
        description:
          `${BUILD_SCOPES[scope]}\n\n` +
          `This will create **${preview.totals.roles} roles**, **${preview.totals.categories} categories** and **${preview.totals.channels} channels** ` +
          `(existing ones are skipped, nothing is deleted).\n\n` +
          `~~struck-through~~ already exists.`,
        color: 'warning',
        fields: previewFields,
      })],
      components: [row],
    });

    let btn;
    try {
      const msg = await interaction.fetchReply();
      btn = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60_000,
        filter: (i) => i.user.id === interaction.user.id && [confirmId, cancelId].includes(i.customId),
      });
    } catch {
      return InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({ title: 'Timed out', description: 'No confirmation within 60s — nothing was changed.', color: 'error' })],
        components: [],
      });
    }

    if (btn.customId === cancelId) {
      return btn.update({
        embeds: [createEmbed({ title: 'Cancelled', description: 'Nothing was changed.', color: 'error' })],
        components: [],
      });
    }

    await btn.update({
      embeds: [createEmbed({ title: '🏗️ Building…', description: 'Creating roles and channels. This takes up to a minute.', color: 'info' })],
      components: [],
    });

    try {
      const res = await buildServer(interaction.guild, {
        scope,
        reason: `/build-server by ${interaction.user.tag}`,
      });

      const line = (label, arr) => `**${label}:** ${arr.length ? arr.length : 'none'}`;
      const fields = [
        {
          name: 'Result',
          value: [
            line('Roles created', res.rolesCreated),
            line('Roles already present', res.rolesExisting),
            line('Categories created', res.categoriesCreated),
            line('Channels created', res.channelsCreated),
            line('Channels already present', res.channelsExisting),
            res.settingsApplied.length ? `**Guild settings:** ${res.settingsApplied.join(', ')}` : null,
          ].filter(Boolean).join('\n'),
        },
      ];
      if (res.wiring?.length) {
        fields.push({ name: 'Next: wire channels into the bot', value: res.wiring.join('\n').slice(0, 1024) });
      }
      if (res.notes.length) fields.push({ name: 'Notes', value: res.notes.join('\n').slice(0, 1024) });
      if (res.errors.length) fields.push({ name: '⚠️ Errors', value: res.errors.join('\n').slice(0, 1024) });

      logger.info(`[build-server] ${interaction.user.tag} built ${interaction.guild.name} (scope ${scope})`);

      return InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: `✅ Server build complete — scope: ${scope}`,
          description: res.errors.length
            ? 'Finished with some errors (below). Usually means the bot role sits too low — move it up and re-run.'
            : 'All set. Move my role above 👑 Owner if you want me to manage everyone.',
          color: res.errors.length ? 'warning' : 'success',
          fields,
        })],
        components: [],
      });
    } catch (error) {
      logger.error('[build-server] build failed:', error);
      return InteractionHelper.safeEditReply(interaction, {
        embeds: [errorEmbed('Build failed', error.message || 'Unknown error. Check the bot logs.')],
        components: [],
      });
    }
  },
};
