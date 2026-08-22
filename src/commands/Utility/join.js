import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { voiceManager } from '../../services/voiceService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current VC or a specified VC')
    .setDMPermission(false)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Voice channel to join')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    )
    .addBooleanOption(option =>
      option
        .setName('deafen')
        .setDescription('Deafen the bot (default: true)')
    ),

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) return;

      let channel = interaction.options.getChannel('channel');
      const selfDeaf = interaction.options.getBoolean('deafen') ?? true;

      // Default to the user's voice channel
      if (!channel) {
        const memberVoiceState = interaction.member?.voice;
        if (!memberVoiceState?.channel) {
          return await InteractionHelper.safeEditReply(
            interaction,
            { embeds: [errorEmbed('You must either be in a voice channel or specify a target voice channel with the `channel` option.')] }
          );
        }
        channel = memberVoiceState.channel;
      }

      // Check bot permissions
      const permissions = channel.permissionsFor(interaction.client.user);
      if (!permissions?.has(PermissionFlagsBits.Connect)) {
        return await InteractionHelper.safeEditReply(
          interaction,
          { embeds: [errorEmbed(`I don't have permission to **Connect** to <#${channel.id}>.`)] }
        );
      }

      const result = await voiceManager.joinVoice({
        channel,
        guild: interaction.guild,
        selfDeaf,
        selfMute: false
      });

      if (result.alreadyConnected) {
        return await InteractionHelper.safeEditReply(
          interaction,
          {
            embeds: [createEmbed({
              title: '🔊 Already Connected',
              description: `I am already in <#${channel.id}>!`,
              color: 'info'
            })]
          }
        );
      }

      const embed = successEmbed(
        `Successfully joined <#${channel.id}>!`,
        '🔊 Joined Voice Channel'
      ).addFields(
        { name: 'Channel', value: `${channel.name} (\`${channel.id}\`)`, inline: true },
        { name: 'Deafened', value: selfDeaf ? 'Yes' : 'No', inline: true }
      );

      return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      logger.error('[Join Command] Error executing join command:', error);
      return await handleInteractionError(interaction, error, 'join');
    }
  }
};
