import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, field, formatNumber } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { claimDaily, getEconomyConfig } from '../../services/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily coin reward (resets every 24 hours)')
    .setDMPermission(false),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    try {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const config = await getEconomyConfig(guildId);
      const result = await claimDaily(guildId, userId);

      const cur = (n) => `**${formatNumber(n)}** ${config.currencyEmoji}`;

      if (!result.success) {
        const embed = createEmbed({
          title: '⏳ Daily already claimed',
          description: `Come back <t:${Math.floor(result.nextDaily / 1000)}:R> for your next reward.`,
          color: 'warning',
          fields: [field('Resets at', `<t:${Math.floor(result.nextDaily / 1000)}:t>`, true)],
        });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

      // Streak flames grow with the streak (capped so the line stays short).
      const flames = '🔥'.repeat(Math.min(result.streak, 7));
      const embed = createEmbed({
        title: `${config.currencyEmoji} Daily reward claimed!`,
        description: `${interaction.user}, you collected ${cur(result.earned)}.`,
        color: 'economy',
        thumbnail: interaction.user.displayAvatarURL({ size: 128 }),
        fields: [
          field('Base reward', cur(result.earned - (result.streakBonus || 0)), true),
          field('Streak bonus', result.streakBonus ? `+${cur(result.streakBonus)}` : '—', true),
          field('New balance', cur(result.newTotal), true),
          field('Streak', `${flames} **${result.streak}** day${result.streak === 1 ? '' : 's'}`, true),
          field('Next claim', `<t:${Math.floor((Date.now() + 86400000) / 1000)}:R>`, true),
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'daily' });
    }
  },
};
