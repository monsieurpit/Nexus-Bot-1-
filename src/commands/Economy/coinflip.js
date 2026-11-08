import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, field, formatNumber } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { playCoinflip, getEconomyConfig } from '../../services/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Bet coins on a coin flip — double or nothing!')
    .setDMPermission(false)
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Amount to bet').setRequired(true).setMinValue(10)
    )
    .addStringOption(opt =>
      opt.setName('choice')
        .setDescription('Heads or tails?')
        .setRequired(true)
        .addChoices(
          { name: '🪙 Heads', value: 'heads' },
          { name: '🔵 Tails', value: 'tails' }
        )
    ),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    try {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const amount = interaction.options.getInteger('amount');
      const choice = interaction.options.getString('choice');
      const config = await getEconomyConfig(guildId);

      const result = await playCoinflip(guildId, userId, amount, choice);

      const cur = (n) => `**${formatNumber(n)}** ${config.currencyEmoji}`;
      if (!result.success) {
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Not enough coins', `You can't bet ${cur(amount)} — check your wallet with \`/coins\`.`)],
        });
      }

      const face = (side) => (side === 'heads' ? '🪙 Heads' : '🔵 Tails');
      const embed = createEmbed({
        title: result.won ? '🎉 You called it!' : '💸 Not this time',
        description: `The coin spins… and lands on **${face(result.result)}**.`,
        color: result.won ? 'success' : 'error',
        fields: [
          field('Your call', face(choice), true),
          field(result.won ? 'Won' : 'Lost', result.won ? `+${cur(amount)}` : `-${cur(amount)}`, true),
          field('Balance', cur(result.newTotal), true),
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'coinflip' });
    }
  },
};
