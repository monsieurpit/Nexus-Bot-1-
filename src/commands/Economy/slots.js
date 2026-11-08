import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, field, formatNumber } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { playSlots, getEconomyConfig } from '../../services/economy.js';

export default {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine and test your luck!')
    .setDMPermission(false)
    .addIntegerOption(opt =>
      opt.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(10)
    ),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    try {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const bet = interaction.options.getInteger('bet');
      const config = await getEconomyConfig(guildId);

      const result = await playSlots(guildId, userId, bet);

      if (!result.success) {
        return InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Not enough coins', `You can't bet **${formatNumber(bet)}** ${config.currencyEmoji} — check your wallet with \`/coins\`.`)],
        });
      }

      const cur = (n) => `**${formatNumber(n)}** ${config.currencyEmoji}`;
      const outcomes = {
        jackpot: { title: '🎰 JACKPOT!', line: `**7️⃣ 7️⃣ 7️⃣** — ${result.multiplier}× payout`, color: 'economy' },
        three_match: { title: '🎉 Three of a kind!', line: `${result.multiplier}× payout`, color: 'success' },
        two_match: { title: '😅 Two of a kind', line: '0.5× consolation', color: 'warning' },
        lose: { title: '🎰 No match', line: 'Better luck next spin', color: 'error' },
      };
      const o = outcomes[result.outcome] || outcomes.lose;
      const net = result.netChange;

      const embed = createEmbed({
        title: o.title,
        // Big emoji reels on one line read like a real machine.
        description: `# ${result.reels.join(' │ ')}\n${o.line}`,
        color: o.color,
        fields: [
          field('Bet', cur(bet), true),
          field(net >= 0 ? 'Won' : 'Lost', `${net >= 0 ? '+' : '-'}${cur(Math.abs(net))}`, true),
          field('Balance', cur(result.newTotal), true),
        ],
        footer: '🍒×2 · 🍋×2.5 · 🍇×3 · ⭐×5 · 💎×8 · 7️⃣×15',
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });

      // ── Jackpot server announcement ────────────────────────────────────────
      if (result.outcome === 'jackpot' && config.jackpotChannelId && bet >= (config.jackpotMinBet ?? 100)) {
        try {
          // Fetch from guild channels only — prevents cross-guild message routing
          const channel = await interaction.guild?.channels.fetch(config.jackpotChannelId).catch(() => null);
          if (channel?.isTextBased() && channel.guildId === guildId) {
            await channel.send({
              embeds: [createEmbed({
                title: '🎰 JACKPOT! 🎰',
                description:
                  `🎊 ${interaction.user} just hit the **7️⃣7️⃣7️⃣ JACKPOT** on the slot machine!\n\n` +
                  `💰 They won **+${Math.abs(result.netChange).toLocaleString()} ${config.currencyEmoji}** ` +
                  `from a **${bet.toLocaleString()} ${config.currencyEmoji}** bet!\n\n` +
                  `✨ **${result.multiplier}x payout!** Think you can do it too? Try \`/slots\`!`,
                color: 'economy',
                thumbnail: interaction.user.displayAvatarURL({ size: 128 }),
                footer: 'Jackpot winner',
              })],
            });
          }
        } catch { /* never fail the command because of an announcement */ }
      }

    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'slots' });
    }
  },
};
