import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { enableAutoSlowmode, disableAutoSlowmode, getAutoSlowmodeConfig } from '../../services/autoSlowmodeService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('slowmode-auto')
    .setDescription('Automatically set slowmode when message spikes are detected')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable auto-slowmode for this server')
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable auto-slowmode for this server')
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Check whether auto-slowmode is currently enabled')
    )
    .addSubcommand(sub =>
      sub.setName('test').setDescription('Test slowmode permissions and send a demonstration alert in this channel')
    ),

  async execute(interaction) {
    try {
      const sub     = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (sub === 'enable') {
        const success = await enableAutoSlowmode(guildId);
        if (success) {
          return interaction.reply({
            embeds: [{
              color: 0x57F287,
              title: '✅ Auto-Slowmode Enabled',
              description: 'The bot is now monitoring all text channels for message spikes.\n\n' +
                '**Automatic Reaction Tiers:**\n' +
                '• **5–9 messages in 5s** → **1s** slowmode applied\n' +
                '• **10+ messages in 5s** → **5s** slowmode applied\n\n' +
                '⏱️ Slowmode is automatically lifted after **30 seconds** of calm activity.',
              timestamp: new Date().toISOString()
            }]
          });
        }
        return interaction.reply({ content: 'Failed to enable auto-slowmode. Please try again.', flags: 64 });
      }

      if (sub === 'disable') {
        const success = await disableAutoSlowmode(guildId);
        if (success) {
          return interaction.reply({
            embeds: [{
              color: 0xED4245,
              title: '🔇 Auto-Slowmode Disabled',
              description: 'The bot will no longer automatically adjust channel slowmode.',
              timestamp: new Date().toISOString()
            }]
          });
        }
        return interaction.reply({ content: 'Failed to disable auto-slowmode. Please try again.', flags: 64 });
      }

      if (sub === 'status') {
        const config = await getAutoSlowmodeConfig(guildId);
        return interaction.reply({
          embeds: [{
            color: config.enabled ? 0x57F287 : 0xED4245,
            title: '🐢 Auto-Slowmode Status',
            fields: [
              { name: 'Status', value: config.enabled ? '✅ **Enabled**' : '🔇 **Disabled**', inline: true },
              { name: 'Threshold', value: '5 msgs / 5s', inline: true },
              { name: 'Cooldown', value: '30s calm window', inline: true }
            ],
            footer: {
              text: config.enabled
                ? 'Active — watching all channels for message spikes.'
                : 'Use /slowmode-auto enable to turn it on.'
            },
            timestamp: new Date().toISOString()
          }],
          flags: 64
        });
      }

      if (sub === 'test') {
        const channel = interaction.channel;
        if (!channel || typeof channel.setRateLimitPerUser !== 'function') {
          return interaction.reply({ content: 'Cannot test slowmode in this channel type.', flags: 64 });
        }

        const botMember = interaction.guild.members.me;
        if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({
            content: '❌ **Permission Error:** The bot is missing the **Manage Channels** permission in this channel to control slowmode.',
            flags: 64
          });
        }

        await interaction.deferReply();
        // Set test slowmode
        await channel.setRateLimitPerUser(5, 'AutoSlowmode Test Verification');

        await interaction.editReply({
          content: '🐢 **Auto-Slowmode Test:** Applied **5s** test slowmode to this channel. Removing in 10 seconds...'
        });

        setTimeout(async () => {
          await channel.setRateLimitPerUser(0, 'AutoSlowmode Test Completed').catch(() => null);
          await channel.send({
            content: '✅ **Auto-Slowmode Test Complete:** Slowmode successfully verified and returned to 0s!'
          }).catch(() => null);
        }, 10000);
      }
    } catch (error) {
      logger.error('Error in slowmode-auto command:', error);
      await interaction.reply({
        content: 'An error occurred while updating the auto-slowmode setting.',
        flags: 64
      }).catch(() => null);
    }
  }
};
