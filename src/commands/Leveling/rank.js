




import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, NexusBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getUserLevelData, getLevelingConfig, getXpForLevel } from '../../services/leveling.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, formatProgressBar } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Check your or another user's rank and level")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to check the rank of')
        .setRequired(false)
    )
    .setDMPermission(false),
  category: 'Leveling',

  





  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);

      const levelingConfig = await getLevelingConfig(client, interaction.guildId);
      if (!levelingConfig?.enabled) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            createEmbed({
              title: '📈 Leveling is off',
              description: 'The leveling system is disabled on this server. Admins can turn it on with `/level`.',
              color: 'gray',
            })
          ],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetUser = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);

      if (!member) {
        throw new NexusBotError(
          `User ${targetUser.id} not found in guild`,
          ErrorTypes.USER_INPUT,
          'Could not find the specified user in this server.'
        );
      }

      const userData = await getUserLevelData(client, interaction.guildId, targetUser.id);

      const safeUserData = {
        level: userData?.level ?? 0,
        xp: userData?.xp ?? 0,
        totalXp: userData?.totalXp ?? 0
      };

      // XP is stored as progress WITHIN the current level, and xpSystem levels up once it reaches
      // getXpForLevel(level) — the bar used level + 1 and showed members needing ~50% more XP than
      // they actually did (and threw outright at the max level).
      const xpNeeded = getXpForLevel(safeUserData.level);
      const remaining = Math.max(0, xpNeeded - safeUserData.xp);
      const n = (v) => Number(v).toLocaleString('en-US');

      const embed = createEmbed({
        author: { name: `${member.displayName}'s rank`, iconURL: member.displayAvatarURL({ size: 64 }) },
        title: `Level ${safeUserData.level}`,
        description: `${formatProgressBar(safeUserData.xp, xpNeeded, 16)}\n*${n(remaining)} XP to level ${safeUserData.level + 1}*`,
        color: 'leveling',
        thumbnail: member.displayAvatarURL({ size: 256 }),
        fields: [
          { name: '⭐ Level progress', value: `**${n(safeUserData.xp)}** / ${n(xpNeeded)} XP`, inline: true },
          { name: '✨ Total XP', value: `**${n(safeUserData.totalXp)}**`, inline: true },
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.debug(`Rank checked for user ${targetUser.id} in guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Rank command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'rank'
      });
    }
  }
};







function createProgressBar(percentage, length = 10) {
  if (percentage < 0 || percentage > 100) {
    percentage = Math.max(0, Math.min(100, percentage));
  }
  const filled = Math.round((percentage / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}



