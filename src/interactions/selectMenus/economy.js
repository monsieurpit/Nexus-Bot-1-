import { EmbedBuilder } from 'discord.js';
import { getEconomyConfig, purchaseShopItem, refundShopPurchase } from '../../services/economy.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';

async function handleShopBuy(interaction, guildId) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const itemId = interaction.values[0];
    const userId = interaction.user.id;
    const config = await getEconomyConfig(guildId);

    // Don't charge for a role the member already has (they used to pay again for nothing).
    const preItem = (config.shopItems || []).find(i => i.id === itemId);
    if (preItem?.type === 'role' && preItem.roleId && interaction.member?.roles?.cache?.has(preItem.roleId)) {
      return interaction.editReply({
        embeds: [errorEmbed('ℹ️ Already Owned', `You already have <@&${preItem.roleId}> — you were not charged.`)],
      });
    }

    const result = await purchaseShopItem(guildId, userId, itemId);

    if (!result.success) {
      if (result.reason === 'not_found') {
        return interaction.editReply({
          embeds: [errorEmbed('❌ Item Not Found', 'This item no longer exists in the shop.')],
        });
      }
      if (result.reason === 'funds') {
        return interaction.editReply({
          embeds: [errorEmbed(
            '❌ Insufficient Funds',
            `You need **${result.need.toLocaleString()} ${config.currencyEmoji}** but only have **${result.have.toLocaleString()} ${config.currencyEmoji}**.`
          )],
        });
      }
      return interaction.editReply({ embeds: [errorEmbed('❌ Purchase Failed', 'Something went wrong. Please try again.')] });
    }

    const { item, remaining } = result;

    const itemEmoji = item.emoji || (item.type === 'role' ? '🏷️' : '✨');

    // ── Role item: try to assign automatically ────────────────────────────────
    if (item.type === 'role' && item.roleId) {
      let roleGiven = false;
      let roleError = null;

      try {
        const member = interaction.member ||
          await interaction.guild.members.fetch(userId).catch(() => null);

        if (member) {
          const role = interaction.guild.roles.cache.get(item.roleId) ||
            await interaction.guild.roles.fetch(item.roleId).catch(() => null);

          if (role) {
            await member.roles.add(role, `Shop purchase: ${item.name}`);
            roleGiven = true;
          } else {
            roleError = 'role_not_found';
          }
        } else {
          roleError = 'member_not_found';
        }
      } catch (err) {
        roleError = err.code === 50013 ? 'missing_permissions' : 'unknown';
        logger.warn(`[Shop] Failed to add role ${item.roleId} to ${userId}:`, err.message);
      }

      if (roleGiven) {
        return interaction.editReply({
          embeds: [successEmbed(
            `${itemEmoji} Purchase Successful!`,
            `You bought **${item.name}** for **${item.price.toLocaleString()} ${config.currencyEmoji}**.\n` +
            `The role has been added to your profile!\n\n` +
            `**Remaining balance:** ${remaining.toLocaleString()} ${config.currencyEmoji}`
          )],
        });
      }

      // The bot couldn't give the role: refund automatically (members used to be charged and told
      // "an admin has been notified" even when no admin role was configured) and tell staff why.
      const refunded = await refundShopPurchase(guildId, userId, item.price)
        .then(() => true)
        .catch((err) => { logger.error(`[Shop] Refund failed for ${userId} (${item.price}):`, err); return false; });
      await notifyAdmin(interaction, config, item, userId, roleError, refunded);
      const why = {
        role_not_found: 'the role no longer exists',
        member_not_found: 'your member profile could not be loaded',
        missing_permissions: 'I am not allowed to give that role (it is above my highest role, or I lack Manage Roles)',
      }[roleError] || 'an unexpected Discord error';
      return interaction.editReply({
        embeds: [errorEmbed(
          `${itemEmoji} Delivery Failed`,
          `I couldn't give you **${item.name}** because ${why}.\n` +
          (refunded
            ? `Your **${item.price.toLocaleString()} ${config.currencyEmoji}** were refunded.`
            : `⚠️ The automatic refund also failed — please contact staff (item \`${item.id}\`).`)
        )],
      });
    }

    // ── Custom item: always ping admin ────────────────────────────────────────
    const notified = await notifyAdmin(interaction, config, item, userId, null);
    return interaction.editReply({
      embeds: [successEmbed(
        `${itemEmoji} Purchase Successful!`,
        `You bought **${item.name}** for **${item.price.toLocaleString()} ${config.currencyEmoji}**.\n` +
        (notified
          ? `An admin has been notified to deliver your item.\n\n`
          : `Please let a staff member know so they can deliver it (no admin notification role is configured).\n\n`) +
        (item.deliveryNote ? `**What to expect:** ${item.deliveryNote}\n\n` : '') +
        `**Remaining balance:** ${remaining.toLocaleString()} ${config.currencyEmoji}`
      )],
    });
  } catch (err) {
    logger.error('[Shop] handleShopBuy error:', err);
    try {
      await interaction.editReply({ embeds: [errorEmbed('❌ Error', 'An unexpected error occurred.')] });
    } catch {}
  }
}

// Returns true only when a notification was actually posted.
async function notifyAdmin(interaction, config, item, userId, errorReason, refunded = false) {
  const adminRoleId = config.adminNotifyRoleId;
  if (!adminRoleId) return false;

  try {
    const itemEmoji = item.emoji || (item.type === 'role' ? '🏷️' : '✨');
    const reasonNote = errorReason
      ? (refunded
        ? `\n⚠️ Automatic delivery failed (\`${errorReason}\`) — the member was refunded; fix the item's role setup.`
        : `\n⚠️ Automatic delivery failed (\`${errorReason}\`) and the refund failed — please deliver or refund manually.`)
      : '';
    const deliveryNote = item.deliveryNote ? `\n📋 **Delivery note:** ${item.deliveryNote}` : '';
    const typeInfo = item.type === 'role' && item.roleId
      ? `\n🏷️ **Role:** <@&${item.roleId}> (\`${item.roleId}\`)`
      : '';

    const embed = createEmbed({ timestamp: false })
      .setTitle(`🛒 Shop Purchase — Admin Notification`)
      .setColor(getColor('economy'))
      .setDescription(
        `<@${userId}> purchased **${itemEmoji} ${item.name}** and requires manual delivery.` +
        typeInfo +
        deliveryNote +
        reasonNote
      )
      .setFooter({ text: `User ID: ${userId} • Item ID: ${item.id}` })
      .setTimestamp();

    await interaction.channel.send({
      content: `<@&${adminRoleId}>`,
      embeds: [embed],
      allowedMentions: { roles: [adminRoleId] },
    });
    return true;
  } catch (err) {
    logger.warn('[Shop] Failed to send admin notification:', err.message);
    return false;
  }
}

export default [
  {
    name: 'shop_buy',
    async execute(interaction, _client, args) {
      const guildId = args[0] || interaction.guildId;
      await handleShopBuy(interaction, guildId);
    },
  },
];
