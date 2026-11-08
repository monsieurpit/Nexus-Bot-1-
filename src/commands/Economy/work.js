import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, field, formatNumber } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { claimWork, getEconomyConfig } from '../../services/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work a random job to earn coins (4-hour cooldown)')
    .setDMPermission(false),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    try {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const config = await getEconomyConfig(guildId);
      const result = await claimWork(guildId, userId);

      const cur = (n) => `**${formatNumber(n)}** ${config.currencyEmoji}`;
      if (!result.success) {
        const embed = createEmbed({
          title: '⏳ Still on shift',
          description: `You're tired — you can work again <t:${Math.floor(result.nextWork / 1000)}:R>.`,
          color: 'warning',
        });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

      const nextShift = Math.floor((Date.now() + (config.workCooldown || 4 * 60 * 60 * 1000)) / 1000);
      const embed = createEmbed({
        title: `${result.emoji} Shift complete`,
        description: `You worked as a **${result.job}** and got paid ${cur(result.earned)}.`,
        color: 'economy',
        fields: [
          field('Earned', `+${cur(result.earned)}`, true),
          field('Balance', cur(result.newTotal), true),
          field('Next shift', `<t:${nextShift}:R>`, true),
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'work' });
    }
  },
};
