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
    .setName('voice')
    .setDescription('Manage voice channel connections')
    .setDMPermission(false)
    .addSubcommand(subcommand =>
      subcommand
        .setName('join')
        .setDescription('Join a voice channel')
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
        )
        .addBooleanOption(option =>
          option
            .setName('mute')
            .setDescription('Mute the bot (default: false)')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('leave')
        .setDescription('Leave current voice channel')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View current voice status')
    ),

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) return;

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'join') {
        let channel = interaction.options.getChannel('channel');
        const selfDeaf = interaction.options.getBoolean('deafen') ?? true;
        const selfMute = interaction.options.getBoolean('mute') ?? false;

        // If no channel explicitly provided, get the member's current voice channel
        if (!channel) {
          const memberVoiceState = interaction.member?.voice;
          if (!memberVoiceState?.channel) {
            return await InteractionHelper.safeEditReply(
              interaction,
              errorEmbed('You must either be in a voice channel or specify a target voice channel with the `channel` option.')
            );
          }
          channel = memberVoiceState.channel;
        }

        // Check bot permissions in target channel
        const permissions = channel.permissionsFor(interaction.client.user);
        if (!permissions?.has(PermissionFlagsBits.Connect)) {
          return await InteractionHelper.safeEditReply(
            interaction,
            errorEmbed(`I don't have permission to **Connect** to <#${channel.id}>.`)
          );
        }

        if (!permissions?.has(PermissionFlagsBits.Speak)) {
          logger.warn(`Bot lacks speak permission in voice channel ${channel.id}`);
        }

        const result = await voiceManager.joinVoice({
          channel,
          guild: interaction.guild,
          selfDeaf,
          selfMute
        });

        if (result.alreadyConnected) {
          return await InteractionHelper.safeEditReply(
            interaction,
            createEmbed({
              title: '🔊 Already Connected',
              description: `I am already connected to <#${channel.id}>!`,
              color: 'info'
            })
          );
        }

        const embed = successEmbed(
          `Successfully connected to <#${channel.id}>!`,
          '🔊 Joined Voice Channel'
        ).addFields(
          { name: 'Channel', value: `${channel.name} (\`${channel.id}\`)`, inline: true },
          { name: 'Deafened', value: selfDeaf ? 'Yes' : 'No', inline: true },
          { name: 'Muted', value: selfMute ? 'Yes' : 'No', inline: true }
        );

        return await InteractionHelper.safeEditReply(interaction, embed);
      }

      if (subcommand === 'leave') {
        const result = voiceManager.leaveVoice(interaction.guildId);

        if (!result.left) {
          return await InteractionHelper.safeEditReply(
            interaction,
            errorEmbed('I am not currently connected to any voice channel in this server.')
          );
        }

        const embed = successEmbed(
          result.channelName
            ? `Disconnected from voice channel **#${result.channelName}**.`
            : 'Disconnected from voice channel.',
          '🔇 Left Voice Channel'
        );

        return await InteractionHelper.safeEditReply(interaction, embed);
      }

      if (subcommand === 'status') {
        const status = voiceManager.getStatus(interaction.guildId, interaction.guild);

        if (!status.connected) {
          return await InteractionHelper.safeEditReply(
            interaction,
            createEmbed({
              title: '🔊 Voice Status',
              description: 'The bot is not currently connected to any voice channel in this server.',
              color: 'primary',
              fields: [
                { name: 'Status', value: 'Disconnected', inline: true }
              ]
            })
          );
        }

        const joinedTimeStr = status.joinedAt
          ? `<t:${Math.floor(status.joinedAt / 1000)}:R>`
          : 'Unknown';

        const embed = createEmbed({
          title: '🔊 Voice Status',
          description: `Currently connected to <#${status.channelId}>`,
          color: 'success',
          fields: [
            { name: 'Status', value: `\`${status.status}\``, inline: true },
            { name: 'Connected', value: joinedTimeStr, inline: true },
            { name: 'Deafened', value: status.selfDeaf ? 'Yes' : 'No', inline: true },
            { name: 'Muted', value: status.selfMute ? 'Yes' : 'No', inline: true },
            { name: 'Ping', value: status.ping !== null ? `${status.ping}ms` : 'N/A', inline: true }
          ]
        });

        return await InteractionHelper.safeEditReply(interaction, embed);
      }
    } catch (error) {
      logger.error('[Voice Command] Error executing voice command:', error);
      return await handleInteractionError(interaction, error, 'voice');
    }
  }
};
