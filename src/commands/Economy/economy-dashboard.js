import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed, errorEmbed, dashboardEmbed, roleOr, onOff, bulletList } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getEconomyConfig } from '../../services/economy.js';

export function buildDashboardEmbed(config, guild = null) {
  const c = config.currencyEmoji;
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const packs = (config.packs || []).map((p) => `${p.emoji} **${p.name}** — ${n(p.price)} ${c}`);
  const shop = (config.shopItems || []).map((item) => `${item.emoji || (item.type === 'role' ? '🏷️' : '✨')} **${item.name}** — ${n(item.price)} ${c}${item.type === 'role' ? ' · role' : ''}`);
  const workHrs = Math.round((config.workCooldown || 14400000) / 3600000 * 10) / 10;
  const robMins = Math.round((config.robCooldown || 1800000) / 60000);
  const msgSecs = Math.round((config.messageCoinsRateLimit || 60000) / 1000);

  return dashboardEmbed({
    guild,
    feature: 'Economy',
    icon: c || '🪙',
    color: 'economy',
    enabled: Boolean(config.enabled),
    summary: `Currency: **${config.currencyName}** ${c}`,
    fields: [
      { name: '📅 Daily', value: `**${n(config.dailyAmount)}** ${c}\n+${n(config.dailyStreakBonus)}/streak day (max 30)`, inline: true },
      { name: '💼 Work', value: `**${n(config.workMin || 50)}–${n(config.workMax || 250)}** ${c}\nevery ${workHrs}h`, inline: true },
      { name: '💬 Chatting', value: `${onOff(config.messageCoinsEnabled)} · **${n(config.coinsPerMessage || 5)}** ${c}\nonce per ${msgSecs}s`, inline: true },
      { name: '🦹 Rob', value: `**${config.robSuccessRate ?? 45}%** success\nevery ${robMins}m`, inline: true },
      { name: '🎰 Jackpots', value: config.jackpotChannelId ? `<#${config.jackpotChannelId}>\nbets ≥ ${n(config.jackpotMinBet || 100)} ${c}` : '*Silent*', inline: true },
      { name: '🔔 Shop alerts', value: roleOr(config.adminNotifyRoleId), inline: true },
      { name: `📦 Packs (${packs.length})`, value: bulletList(packs, 8), inline: false },
      { name: `🛒 Shop — ${config.shopTitle || 'Server Shop'} (${shop.length})`, value: bulletList(shop, 8), inline: false },
    ],
    hint: 'Use the buttons below · changes save immediately',
  });
}

export function buildDashboardRows(config, guildId) {
  const gid = guildId || config._guildId || 'guild';
  const hasItems = (config.shopItems || []).length > 0;
  const hasPacks = (config.packs || []).length > 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:toggle:${gid}`)
      .setLabel(config.enabled ? 'Disable Economy' : 'Enable Economy')
      .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_currency:${gid}`)
      .setLabel('Edit Currency')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_daily:${gid}`)
      .setLabel('Edit Daily Reward')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_work:${gid}`)
      .setLabel('Edit Work')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_rob:${gid}`)
      .setLabel('Edit Rob')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_msg_coins:${gid}`)
      .setLabel('Edit Message Coins')
      .setStyle(ButtonStyle.Primary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:add_pack:${gid}`)
      .setLabel('Add Pack')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:remove_pack:${gid}`)
      .setLabel('Remove Pack')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasPacks),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:set_admin_role:${gid}`)
      .setLabel('Set Admin Role')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:set_jackpot_channel:${gid}`)
      .setLabel('🎰 Jackpot Channel')
      .setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:add_shop_item:${gid}`)
      .setLabel('Add Shop Item')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:remove_shop_item:${gid}`)
      .setLabel('Remove Shop Item')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasItems),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_item_price:${gid}`)
      .setLabel('Edit Item Price')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasItems),
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:edit_shop_style:${gid}`)
      .setLabel('Edit Shop Style')
      .setStyle(ButtonStyle.Secondary)
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`econ_dashboard:refresh:${gid}`)
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3, row4, row5];
}

export default {
  data: new SlashCommandBuilder()
    .setName('economy-dashboard')
    .setDescription('(Admin) Open the economy configuration dashboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, { ephemeral: true });
    if (!deferSuccess) return;

    try {
      const guildId = interaction.guildId;
      const config = await getEconomyConfig(guildId);
      config._guildId = guildId;

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildDashboardEmbed(config, interaction.guild)],
        components: buildDashboardRows(config, guildId),
      });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'economy-dashboard' });
    }
  },
};
