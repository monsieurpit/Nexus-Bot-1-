import { SlashCommandBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { voiceManager } from '../../services/voiceService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave current voice channel')
    .setDMPermission(false),

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) return;

      const result = voiceManager.leaveVoice(interaction.guildId);

      if (!result.left) {
        return await InteractionHelper.safeEditReply(
          interaction,
          { embeds: [errorEmbed('I am not currently connected to any voice channel in this server.')] }
        );
      }

      const embed = successEmbed(
        result.channelName
          ? `Disconnected from voice channel **#${result.channelName}**.`
          : 'Disconnected from voice channel.',
        '🔇 Left Voice Channel'
      );

      return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      logger.error('[Leave Command] Error executing leave command:', error);
      return await handleInteractionError(interaction, error, 'leave');
    }
  }
};
