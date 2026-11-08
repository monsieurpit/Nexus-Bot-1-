import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Get detailed information about a user")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user to inspect (defaults to you)"),
    ),

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) {
        logger.warn(`UserInfo interaction defer failed`, {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          commandName: 'userinfo'
        });
        return;
      }

      const user = interaction.options.getUser("target") || interaction.user;
      // Cache-only lookups showed members as "Not in server" whenever they weren't cached.
      const member = interaction.guild.members.cache.get(user.id)
        || await interaction.guild.members.fetch(user.id).catch(() => null);

      const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
      const created = ts(user.createdAt ?? user.createdTimestamp);
      const joined = member?.joinedAt || member?.joinedTimestamp ? ts(member.joinedAt ?? member.joinedTimestamp) : null;

      const roles = member
        ? [...member.roles.cache.values()]
            .filter((r) => r.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
        : [];
      const roleList = roles.length
        ? roles.slice(0, 12).map((r) => `${r}`).join(" ") + (roles.length > 12 ? ` *+${roles.length - 12} more*` : "")
        : "*No roles*";

      const badges = [
        user.bot ? "🤖 Bot" : null,
        interaction.guild.ownerId === user.id ? "👑 Server owner" : null,
        member?.permissions?.has?.("Administrator") && interaction.guild.ownerId !== user.id ? "🛡️ Administrator" : null,
        member?.premiumSince ? "💎 Server booster" : null,
        member?.communicationDisabledUntilTimestamp > Date.now() ? "🔇 Timed out" : null,
      ].filter(Boolean);

      const highest = member?.roles?.highest;
      const embed = createEmbed({
        author: { name: user.tag || user.username, iconURL: user.displayAvatarURL({ size: 64 }) },
        title: member?.displayName && member.displayName !== user.username ? member.displayName : user.globalName || user.username,
        description: `${user} · \`${user.id}\`${badges.length ? `\n${badges.join("  ·  ")}` : ""}`,
        color: highest?.color ? highest.color : "primary",
        thumbnail: user.displayAvatarURL({ size: 256 }),
        fields: [
          { name: "📅 Account created", value: `<t:${created}:D> (<t:${created}:R>)`, inline: true },
          { name: "📥 Joined server", value: joined ? `<t:${joined}:D> (<t:${joined}:R>)` : "*Not a member*", inline: true },
          { name: "⭐ Top role", value: highest && highest.id !== interaction.guild.id ? `${highest}` : "*None*", inline: true },
          ...(member ? [{ name: `🎭 Roles (${roles.length})`, value: roleList, inline: false }] : []),
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.info(`UserInfo command executed`, {
        userId: interaction.user.id,
        targetUserId: user.id,
        guildId: interaction.guildId
      });
    } catch (error) {
      logger.error(`UserInfo command execution failed`, {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'userinfo'
      });
      await handleInteractionError(interaction, error, {
        commandName: 'userinfo',
        source: 'userinfo_command'
      });
    }
  },
};




