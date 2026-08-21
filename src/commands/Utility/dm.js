import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendDirectMessage } from '../../services/dmService.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message to a server member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to receive the direct message')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The plain text message to send')
        .setRequired(true)
    ),

  async execute(interaction, guildConfig, client) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const messageContent = interaction.options.getString('message');

    if (targetUser.bot) {
      const embed = new EmbedBuilder()
        .setColor(getColor('error'))
        .setTitle('❌ Invalid Target')
        .setDescription('You cannot send direct messages to bot accounts.');
      return await interaction.editReply({ embeds: [embed] });
    }

    try {
      const result = await sendDirectMessage(client, interaction.user, targetUser, messageContent);

      if (result.success) {
        const embed = new EmbedBuilder()
          .setColor(getColor('success'))
          .setTitle('✉️ Direct Message Sent')
          .setDescription(`Successfully sent your message to **${targetUser.tag}**.\n\nAny reply from ${targetUser} will be automatically forwarded back to your DMs.`)
          .addFields({
            name: 'Message Content',
            value: messageContent.length > 1000 ? messageContent.substring(0, 1000) + '...' : messageContent
          })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      } else {
        const embed = new EmbedBuilder()
          .setColor(getColor('error'))
          .setTitle('❌ Delivery Failed')
          .setDescription(`Could not send direct message to **${targetUser.tag}**.\n\n*Reason: ${result.error || 'User has direct messages closed or has blocked the bot.'}*`);

        return await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error(`Error in /dm command execution by ${interaction.user.tag}:`, error);
      const embed = new EmbedBuilder()
        .setColor(getColor('error'))
        .setTitle('❌ Command Error')
        .setDescription('An unexpected error occurred while attempting to send the direct message.');

      return await interaction.editReply({ embeds: [embed] });
    }
  }
};
