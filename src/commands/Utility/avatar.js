import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    allowDM: true,
    data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Display a user's avatar image")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription(
          "The user whose avatar you want to see (defaults to you)",
        ),
    ),

  async execute(interaction) {
    try {
      const user = interaction.options.getUser("target") || interaction.user;
      const avatarUrl = user.displayAvatarURL({ size: 2048 });
      const fmt = (extension) => user.displayAvatarURL({ size: 2048, extension, forceStatic: extension !== 'gif' });
      const animated = typeof user.avatar === 'string' && user.avatar.startsWith('a_');
      const links = ['png', 'jpg', 'webp', ...(animated ? ['gif'] : [])]
        .map((ext) => `[${ext.toUpperCase()}](${fmt(ext)})`)
        .join(' · ');

      // A server-specific avatar, when the member set one.
      const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;
      const serverAvatar = member?.avatar ? member.displayAvatarURL({ size: 2048 }) : null;

      const embed = createEmbed({
        author: { name: user.tag || user.username, iconURL: user.displayAvatarURL({ size: 64 }) },
        title: `🖼️ ${user.globalName || user.username}'s avatar`,
        description: `Download: ${links}${serverAvatar ? `\nThis member also has a [server avatar](${serverAvatar}) (shown as thumbnail).` : ''}`,
        color: 'primary',
        image: avatarUrl,
        thumbnail: serverAvatar,
      });

      await InteractionHelper.safeReply(interaction, { embeds: [embed] });
      logger.info(`Avatar command executed`, {
        userId: interaction.user.id,
        targetUserId: user.id,
        guildId: interaction.guildId
      });
    } catch (error) {
      logger.error(`Avatar command execution failed`, {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'avatar'
      });
      await handleInteractionError(interaction, error, {
        commandName: 'avatar',
        source: 'avatar_command'
      });
    }
  }
};


