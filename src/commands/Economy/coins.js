import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, field, formatNumber } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserBalance, getUserInventory, getEconomyConfig } from '../../services/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('coins')
    .setDescription("Check your coin balance or another member's balance")
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The member to check (leave empty for yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    try {
      const target = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guildId;
      const config = await getEconomyConfig(guildId);
      const balance = await getUserBalance(guildId, target.id);
      const inv = await getUserInventory(guildId, target.id);

      const isSelf = target.id === interaction.user.id;
      const packCount = (inv.packs || []).length;

      const workCooldown = config.workCooldown || 4 * 60 * 60 * 1000;
      const workReady = !balance.lastWork || (Date.now() - balance.lastWork) >= workCooldown;
      const workText = workReady
        ? '✅ Ready!'
        : `<t:${Math.floor((balance.lastWork + workCooldown) / 1000)}:R>`;

      const robCooldown = config.robCooldown || 30 * 60 * 1000;
      const robReady = !balance.lastRob || (Date.now() - balance.lastRob) >= robCooldown;
      const robText = robReady
        ? '✅ Ready!'
        : `<t:${Math.floor((balance.lastRob + robCooldown) / 1000)}:R>`;

      const bankCoins = balance.bankCoins || 0;
      const wallet = balance.coins || 0;
      const cur = (n) => `**${formatNumber(n)}** ${config.currencyEmoji}`;
      const dailyAt = balance.lastDaily ? balance.lastDaily + 86400000 : 0;
      const dailyText = !dailyAt || dailyAt <= Date.now() ? '✅ Ready' : `<t:${Math.floor(dailyAt / 1000)}:R>`;
      const streak = balance.dailyStreak || 0;

      const embed = createEmbed({
        author: { name: isSelf ? 'Your wallet' : `${target.displayName}'s wallet`, iconURL: target.displayAvatarURL({ size: 64 }) },
        title: `${config.currencyEmoji} ${formatNumber(wallet + bankCoins)} ${config.currencyName}`,
        description: `Net worth across wallet and bank.`,
        color: 'economy',
        thumbnail: target.displayAvatarURL({ size: 128 }),
        fields: [
          field('👝 Wallet', cur(wallet), true),
          field('🏦 Bank', cur(bankCoins), true),
          field('📦 Packs', `**${packCount}**`, true),
          field('🔥 Streak', `**${streak}** day${streak === 1 ? '' : 's'}`, true),
          field('⏰ Daily', dailyText, true),
          field('💼 Work', workText.replace('✅ Ready!', '✅ Ready'), true),
          ...(isSelf ? [field('🦹 Rob', robText.replace('✅ Ready!', '✅ Ready'), true)] : []),
        ],
        footer: wallet > 0 ? 'Tip: /bank deposit protects coins from /rob' : null,
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'coins' });
    }
  },
};
