import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import { logger } from '../utils/logger.js';

/**
 * Voice Connection Manager for Discord.js
 */
class VoiceManager {
  constructor() {
    this.connections = new Map(); // guildId -> metadata { channelId, joinedAt, selfDeaf, selfMute }
  }

  /**
   * Joins a voice channel in a guild.
   * @param {Object} options
   * @param {import('discord.js').VoiceBasedChannel} options.channel
   * @param {import('discord.js').Guild} options.guild
   * @param {boolean} [options.selfDeaf=true]
   * @param {boolean} [options.selfMute=false]
   */
  async joinVoice({ channel, guild, selfDeaf = true, selfMute = false }) {
    if (!channel || !guild) {
      throw new Error('Valid channel and guild are required to join voice.');
    }

    const existing = getVoiceConnection(guild.id);
    if (existing && existing.joinConfig.channelId === channel.id) {
      return {
        connection: existing,
        alreadyConnected: true,
        channel
      };
    }

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf,
        selfMute
      });

      this.connections.set(guild.id, {
        channelId: channel.id,
        channelName: channel.name,
        joinedAt: Date.now(),
        selfDeaf,
        selfMute
      });

      // Handle connection status changes
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
          ]);
          // Seems to be reconnecting to a new channel
        } catch (error) {
          // Unrecoverable disconnect
          logger.info(`[Voice] Disconnected from voice in guild ${guild.id}`);
          connection.destroy();
          this.connections.delete(guild.id);
        }
      });

      connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.connections.delete(guild.id);
      });

      // Wait until connection is ready with a 15-second timeout
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

      logger.info(`[Voice] Successfully joined voice channel #${channel.name} (${channel.id}) in guild ${guild.name}`);
      return {
        connection,
        alreadyConnected: false,
        channel
      };
    } catch (error) {
      logger.error(`[Voice] Failed to join voice channel #${channel.name}:`, error);
      const conn = getVoiceConnection(guild.id);
      if (conn) {
        conn.destroy();
      }
      this.connections.delete(guild.id);
      throw error;
    }
  }

  /**
   * Leaves the voice channel in a guild.
   * @param {string} guildId
   */
  leaveVoice(guildId) {
    const connection = getVoiceConnection(guildId);
    const meta = this.connections.get(guildId);
    if (!connection) {
      this.connections.delete(guildId);
      return { left: false, message: 'Bot is not currently connected to any voice channel.' };
    }

    try {
      connection.destroy();
      this.connections.delete(guildId);
      logger.info(`[Voice] Disconnected from voice in guild ${guildId}`);
      return {
        left: true,
        channelId: meta?.channelId,
        channelName: meta?.channelName
      };
    } catch (error) {
      logger.error(`[Voice] Error leaving voice in guild ${guildId}:`, error);
      this.connections.delete(guildId);
      throw error;
    }
  }

  /**
   * Gets current voice status for a guild.
   * @param {string} guildId
   * @param {import('discord.js').Guild} [guild]
   */
  getStatus(guildId, guild = null) {
    const connection = getVoiceConnection(guildId);
    const meta = this.connections.get(guildId);

    if (!connection) {
      return {
        connected: false,
        status: 'Disconnected'
      };
    }

    const channelId = connection.joinConfig.channelId || meta?.channelId;
    const channel = guild?.channels?.cache?.get(channelId);

    return {
      connected: true,
      status: connection.state.status,
      channelId,
      channelName: channel?.name || meta?.channelName || 'Unknown Channel',
      joinedAt: meta?.joinedAt || null,
      selfDeaf: connection.joinConfig.selfDeaf ?? meta?.selfDeaf ?? true,
      selfMute: connection.joinConfig.selfMute ?? meta?.selfMute ?? false,
      ping: connection.ping?.ws ?? null
    };
  }
}

export const voiceManager = new VoiceManager();
