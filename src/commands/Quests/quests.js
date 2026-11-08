// /quests — the whole Seasons & Quests feature in ONE slash command (Discord allows 100 global
// commands per bot; Nexus is at the limit).
//   /quests setup channel:#…            (Manage Server) turn quests on + daily post channel
//   /quests progress [member]           your board, or another member's progress
//   /quests season                      season tier, rewards and leaderboard
//   /quests admin <dashboard|disable|channel|announcements|multiplier|tier-role>   (Manage Server)
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError, NexusBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { getQuestSettings, updateQuestSettings, forceCompleteDaily } from '../../services/quests/questService.js';
import { buildQuestSettingsEmbed } from '../../services/quests/questEmbeds.js';
import { renderQuestBoard, renderSeason } from '../../services/quests/questViews.js';
import { postDailyBoard } from '../../services/quests/questAnnouncer.js';
import { MAX_TIER } from '../../services/quests/catalog.js';
import { logger } from '../../utils/logger.js';

// The only account allowed to use /quests complete-daily.
const QUEST_OWNER_ID = '1554657430393196594';

const channelOption = (o, required) => o.setName('channel').setDescription('Where the daily quests, completions and season results are posted')
  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(required);

function assertCanPost(guild, channel) {
  const perms = channel.permissionsFor(guild.members.me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new NexusBotError('Missing permissions', ErrorTypes.PERMISSION, `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`);
  }
}

function assertManager(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new NexusBotError('Missing permission', ErrorTypes.PERMISSION, 'You need **Manage Server** to configure quests.');
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Seasons & Quests: daily and weekly quests, monthly seasons and leaderboards')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('progress').setDescription('Your quest progress — or another member\'s')
      .addUserOption((o) => o.setName('member').setDescription('See this member\'s progress instead').setRequired(false)))
    .addSubcommand((s) => s.setName('season').setDescription('This month\'s season: your tier, next rewards and the leaderboard'))
    .addSubcommand((s) => s.setName('complete-daily').setDescription('(Bot owner only) Complete all of today\'s daily quests'))
    .addSubcommand((s) => s.setName('setup').setDescription('(Manage Server) Turn Seasons & Quests on and pick the quest channel')
      .addChannelOption((o) => channelOption(o, true)))
    .addSubcommandGroup((g) => g.setName('admin').setDescription('(Manage Server) Quest settings')
      .addSubcommand((s) => s.setName('dashboard').setDescription('Show the current quest settings'))
      .addSubcommand((s) => s.setName('disable').setDescription('Turn Seasons & Quests off (progress is kept)'))
      .addSubcommand((s) => s.setName('channel').setDescription('Change the quest channel')
        .addChannelOption((o) => channelOption(o, true)))
      .addSubcommand((s) => s.setName('announcements').setDescription('Announce each completed quest in the quest channel')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
      .addSubcommand((s) => s.setName('multiplier').setDescription('Scale every coin reward (quests, chests, tiers, podium)')
        .addNumberOption((o) => o.setName('value').setDescription('0.25 to 5 (1 = default)').setMinValue(0.25).setMaxValue(5).setRequired(true)))
      .addSubcommand((s) => s.setName('tier-role').setDescription('Give a role when members reach a season tier')
        .addIntegerOption((o) => o.setName('tier').setDescription(`Tier 1-${MAX_TIER}`).setMinValue(1).setMaxValue(MAX_TIER).setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Leave empty to remove the reward')))),
  category: 'Quests',

  async execute(interaction, _config, client) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const adminCall = group === 'admin' || sub === 'setup' || sub === 'complete-daily';
    const ok = await InteractionHelper.safeDefer(interaction, adminCall ? { flags: MessageFlags.Ephemeral } : {});
    if (!ok) return;

    try {
      const guild = interaction.guild;

      if (sub === 'progress') {
        const user = interaction.options.getUser('member') || interaction.user;
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member || user.bot) {
          return InteractionHelper.safeEditReply(interaction, { embeds: [errorEmbed('Member not found', "Pick a member of this server — bots don't do quests.")] });
        }
        return InteractionHelper.safeEditReply(interaction, await renderQuestBoard(client, guild, member, interaction.user));
      }

      if (sub === 'season') {
        const member = interaction.member || await guild.members.fetch(interaction.user.id);
        return InteractionHelper.safeEditReply(interaction, await renderSeason(client, guild, member));
      }

      if (sub === 'complete-daily') {
        // Owner tool: checked by user ID, not by server permissions.
        if (interaction.user.id !== QUEST_OWNER_ID) {
          throw new NexusBotError('Not the quest owner', ErrorTypes.PERMISSION, 'This command is reserved for the bot owner.');
        }
        if (!(await getQuestSettings(guild.id)).enabled) {
          throw new NexusBotError('Quests off', ErrorTypes.CONFIGURATION, 'Seasons & Quests aren\'t active on this server — run `/quests setup` first.');
        }
        const { completed, board } = await forceCompleteDaily(client, guild.id, interaction.user.id);
        logger.info(`[Quests] Owner completed ${completed} daily quest(s) in guild ${guild.id}`);
        const member = interaction.member || await guild.members.fetch(interaction.user.id);
        const view = await renderQuestBoard(client, guild, member, interaction.user);
        const note = completed
          ? successEmbed('Daily quests completed', `All **${board.quests.length}** of today's daily quests are done (${completed} newly completed). Press **Claim** below to collect the rewards and the daily chest.`)
          : successEmbed('Already done', 'All of today\'s daily quests were already complete. Press **Claim** below if anything is left to collect.');
        return InteractionHelper.safeEditReply(interaction, { embeds: [note, ...view.embeds], components: view.components });
      }

      // ── Admin ──
      assertManager(interaction);
      let note = null;

      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        assertCanPost(guild, channel);
        const before = await getQuestSettings(guild.id);
        await updateQuestSettings(guild.id, { enabled: true, channelId: channel.id });
        const posted = await postDailyBoard(client, guild, { force: true }).catch(() => false);
        note = `${before.enabled ? 'Seasons & Quests are on' : '🎉 **Seasons & Quests are live!**'} Daily quests are posted in ${channel} every day` +
          `${posted ? ' — today\'s board is already there.' : '.'}\nMembers check their progress with \`/quests progress\` and the race with \`/quests season\`.`;
      } else if (sub === 'disable') {
        await updateQuestSettings(guild.id, { enabled: false });
        note = 'Seasons & Quests are **off**. Nothing is tracked or posted; progress is kept for when you run `/quests setup` again.';
      } else if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        assertCanPost(guild, channel);
        await updateQuestSettings(guild.id, { channelId: channel.id });
        note = `Daily quests, completions and season results will be posted in ${channel}.`;
      } else if (sub === 'announcements') {
        const enabled = interaction.options.getBoolean('enabled');
        await updateQuestSettings(guild.id, { announceCompletions: enabled });
        note = enabled ? 'Completed quests will be announced in the quest channel.' : 'Only the daily quests and season results will be posted.';
      } else if (sub === 'multiplier') {
        const value = Math.round(interaction.options.getNumber('value') * 100) / 100;
        await updateQuestSettings(guild.id, { multiplier: value });
        note = `Every coin reward is now **×${value}**.`;
      } else if (sub === 'tier-role') {
        const tier = interaction.options.getInteger('tier');
        const role = interaction.options.getRole('role');
        if (role) {
          if (role.managed || role.id === guild.id) throw new NexusBotError('Invalid role', ErrorTypes.VALIDATION, 'Pick a normal role (not @everyone or a bot/integration role).');
          if (role.position >= guild.members.me.roles.highest.position) throw new NexusBotError('Role too high', ErrorTypes.PERMISSION, `${role} is above my highest role, so I couldn't give it. Move my role higher first.`);
          if (['Administrator', 'ManageGuild', 'ManageRoles', 'BanMembers', 'KickMembers'].some((p) => role.permissions.has(PermissionFlagsBits[p]))) {
            throw new NexusBotError('Dangerous role', ErrorTypes.VALIDATION, `${role} has staff permissions — it can't be a quest reward.`);
          }
        }
        const settings = await getQuestSettings(guild.id);
        const tierRoles = { ...settings.tierRoles };
        if (role) tierRoles[tier] = role.id; else delete tierRoles[tier];
        await updateQuestSettings(guild.id, { tierRoles });
        note = role ? `Reaching **tier ${tier}** now gives ${role}.` : `Tier ${tier} no longer gives a role.`;
      }

      const settings = await getQuestSettings(guild.id);
      const embeds = [buildQuestSettingsEmbed(guild, settings)];
      if (note) embeds.unshift(successEmbed('Saved', note));
      await InteractionHelper.safeEditReply(interaction, { embeds });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'quests' });
    }
  },
};
