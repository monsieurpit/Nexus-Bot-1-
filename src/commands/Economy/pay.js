import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, field, formatNumber } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { transferCoins, getEconomyConfig } from '../../services/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send coins to another member')
    .setDMPermission(false)
    .addUserOption(opt =>
      opt.setName('user').setDescription('Who to pay').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('Amount to send (minimum 1)').setRequired(true).setMinValue(1)
    ),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    try {
      const guildId = interaction.guildId;
      const fromId = interaction.user.id;
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const config = await getEconomyConfig(guildId);

      if (target.bot) {
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed("Can't pay a bot", 'Bots have no use for coins — pick a member instead.')],
        });
      }

      const result = await transferCoins(guildId, fromId, target.id, amount);

      if (!result.success) {
        if (result.reason === 'self') {
          return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Can't pay yourself", 'Choose another member to send coins to.')],
          });
        }
        if (result.reason === 'funds') {
          return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Not enough coins', `You only have **${formatNumber(result.have || 0)}** ${config.currencyEmoji} in your wallet.`)],
          });
        }
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Transfer failed', 'Amounts must be whole, positive numbers. Nothing was sent.')],
        });
      }

      const embed = createEmbed({
        title: `${config.currencyEmoji} Payment sent`,
        description: `${interaction.user} → ${target}`,
        color: 'economy',
        thumbnail: target.displayAvatarURL({ size: 128 }),
        fields: [
          field('Amount', `**${formatNumber(amount)}** ${config.currencyEmoji}`, true),
          field('Your balance', `**${formatNumber(result.fromTotal)}** ${config.currencyEmoji}`, true),
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'pay' });
    }
  },
};
