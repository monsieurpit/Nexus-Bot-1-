import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Get detailed information about the server"),

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) {
        logger.warn(`ServerInfo interaction defer failed`, {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          commandName: 'serverinfo'
        });
        return;
      }

      const guild = interaction.guild;
      const owner = await guild.fetchOwner().catch(() => null);
      const created = Math.floor(guild.createdTimestamp / 1000);

      const channels = guild.channels.cache;
      const count = (types) => channels.filter((c) => types.includes(c.type)).size;
      // ChannelType: 0 text, 2 voice, 4 category, 5 announcement, 13 stage, 15 forum
      const text = count([0, 5, 15]);
      const voice = count([2, 13]);
      const categories = count([4]);
      const humans = guild.members.cache.filter((m) => !m.user.bot).size;
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const verification = ["None", "Low", "Medium", "High", "Highest"][guild.verificationLevel] ?? "Unknown";

      const embed = createEmbed({
        author: { name: "Server overview", iconURL: guild.iconURL({ size: 64 }) || undefined },
        title: guild.name,
        description: (guild.description ? `${guild.description}\n\n` : "") + `ID \`${guild.id}\``,
        color: "primary",
        thumbnail: guild.iconURL({ size: 256 }),
        image: guild.bannerURL?.({ size: 1024 }) || null,
        fields: [
          { name: "👑 Owner", value: owner ? `${owner.user}` : "*Unknown*", inline: true },
          { name: "📅 Created", value: `<t:${created}:D> (<t:${created}:R>)`, inline: true },
          { name: "🔐 Verification", value: verification, inline: true },
          {
            name: `👥 Members (${guild.memberCount.toLocaleString("en-US")})`,
            // Human/bot split only when the member cache is complete enough to be honest.
            value: humans + bots >= guild.memberCount * 0.9 ? `${humans.toLocaleString("en-US")} humans · ${bots} bots` : `${guild.memberCount.toLocaleString("en-US")} total`,
            inline: true,
          },
          { name: `💬 Channels (${channels.size})`, value: `${text} text · ${voice} voice · ${categories} categories`, inline: true },
          { name: "🎭 Roles", value: `${Math.max(0, guild.roles.cache.size - 1)}`, inline: true },
          { name: "💎 Boosts", value: `Level ${guild.premiumTier} · ${guild.premiumSubscriptionCount ?? 0} boost${guild.premiumSubscriptionCount === 1 ? "" : "s"}`, inline: true },
          { name: "😀 Emojis", value: `${guild.emojis?.cache?.size ?? 0}`, inline: true },
        ],
      });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.info(`ServerInfo command executed`, {
        userId: interaction.user.id,
        guildId: guild.id,
        guildName: guild.name,
        memberCount: guild.memberCount
      });
    } catch (error) {
      logger.error(`ServerInfo command execution failed`, {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'serverinfo'
      });
      await handleInteractionError(interaction, error, {
        commandName: 'serverinfo',
        source: 'serverinfo_command'
      });
    }
  },
};



