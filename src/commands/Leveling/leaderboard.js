import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, NexusBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getLeaderboard, getLevelingConfig, getXpForLevel } from '../../services/leveling.js';
import { getEconomyConfig, getEconomyLeaderboard } from '../../services/economy.js';
import { getQLeaderboard } from '../../services/questionService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("View the server leaderboard")
    .setDMPermission(false)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Which leaderboard to view (default: levels)')
        .setRequired(false)
        .addChoices(
          { name: '⚔️ Levels', value: 'levels' },
          { name: '💰 Richest', value: 'coins' },
          { name: '🧠 Trivia', value: 'trivia' },
        )
    ),
  category: 'Leveling',

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);
      const type = interaction.options.getString('type') || 'levels';
      const n = (v) => Number(v || 0).toLocaleString('en-US');
      const medal = (i) => ['🥇', '🥈', '🥉'][i] || `\`#${String(i + 1).padStart(2, ' ')}\``;

      // One layout for every board. Mentions render on their own, so no per-row member fetch
      // (that used to cost 10 Discord API calls per /leaderboard).
      const board = ({ title, color, rows, empty, footer }) => {
        const me = rows.findIndex((r) => r.userId === interaction.user.id);
        const lines = rows.map((r, i) => `${medal(i)} <@${r.userId}> · ${r.text}`);
        return createEmbed({
          author: { name: interaction.guild.name, iconURL: interaction.guild.iconURL?.({ size: 64 }) || undefined },
          title,
          description: rows.length
            ? lines.join('\n') + (me >= 0 ? `\n\n✨ You're **#${me + 1}** on this board!` : '')
            : empty,
          color,
          footer,
        });
      };

      // ── Levels leaderboard ──────────────────────────────────────────────
      if (type === 'levels') {
        const levelingConfig = await getLevelingConfig(client, interaction.guildId);
        if (!levelingConfig?.enabled) {
          return InteractionHelper.safeEditReply(interaction, {
            embeds: [createEmbed({ title: '📈 Leveling is off', description: 'The leveling system is disabled on this server.', color: 'gray' })],
          });
        }

        const leaderboard = await getLeaderboard(client, interaction.guildId, 10);
        const embed = board({
          title: '📈 Level leaderboard',
          color: 'leveling',
          rows: leaderboard.map((u) => ({ userId: u.userId, text: `**Level ${u.level}** · ${n(u.xp)}/${n(getXpForLevel(u.level))} XP` })),
          empty: 'Nobody has earned XP yet — start chatting to claim the top spot!',
        });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

      // ── Coins leaderboard ───────────────────────────────────────────────
      if (type === 'coins') {
        const econConfig = await getEconomyConfig(interaction.guildId);
        const top = await getEconomyLeaderboard(interaction.guildId, 10);
        const embed = board({
          title: `${econConfig.currencyEmoji} Richest members`,
          color: 'economy',
          rows: top.map(({ userId, coins }) => ({ userId, text: `**${n(coins)}** ${econConfig.currencyEmoji}` })),
          empty: 'Nobody has any coins yet! Use `/daily` or `/work` to get started.',
          footer: 'Wallet balances',
        });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

      // ── Trivia leaderboard ──────────────────────────────────────────────
      if (type === 'trivia') {
        const top = await getQLeaderboard(interaction.guildId, 10);
        const embed = board({
          title: '🧠 Trivia leaderboard',
          color: 'community',
          rows: top.map(({ userId, score }) => ({ userId, text: `**${n(score)}** correct answer${score !== 1 ? 's' : ''}` })),
          empty: 'No scores yet! Use `/question` to start competing.',
          footer: top.length ? `${top.length} player${top.length !== 1 ? 's' : ''} on the board` : null,
        });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

    } catch (error) {
      logger.error('Leaderboard command error:', error);
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'leaderboard' });
    }
  }
};
