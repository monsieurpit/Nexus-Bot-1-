import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * Handle wipedata confirmation button
 * Deletes all user data from the database
 */
const wipedataConfirmHandler = {
  name: 'wipedata_yes',
  async execute(interaction, client) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const userId = interaction.user.id;
      const guildId = interaction.guildId;

      
      // The real keys this bot stores per-user data under. This used to try `level:…`, `xp:…`,
      // `user:…` etc. — formats nothing in the bot uses — so it deleted nothing while telling the
      // user their data was wiped. Moderation records (warnings, cases) are deliberately kept.
      const dataKeys = [
        `guild:${guildId}:leveling:users:${userId}`,
        `${guildId}:leveling:users:${userId}`, // legacy leveling key
        `economy:${guildId}:user:${userId}`,
        `economy:${guildId}:inventory:${userId}`,
        `guild:${guildId}:afk:${userId}`,
        `nexus:memory:${userId}`, // what Nexus AI remembers about this user
      ];

      let deletedCount = 0;
      const deleteErrors = [];

      for (const key of dataKeys) {
        try {
          // get() rather than exists(): on Firestore, exists() ignores the kv_data fallback copy.
          const existing = await client.db.get(key, null);
          if (existing !== null) {
            await client.db.delete(key);
            deletedCount++;
          }
        } catch (error) {
          logger.error(`Error deleting key ${key}:`, error);
          deleteErrors.push(key);
        }
      }

      const successMessage =
        `✅ **Your data has been successfully wiped!**\n\n` +
        `**Records Deleted:** ${deletedCount}\n\n` +
        `Your account has been reset to default values. You can now start fresh!\n\n` +
        `*Your levels/XP, coins, inventory, AFK status and what Nexus AI remembered about you have been removed. Moderation records are kept.*`;

      await interaction.editReply({
        embeds: [successEmbed(successMessage, '🗑️ Data Wipe Complete')],
        components: []
      });

      logger.info(`User ${interaction.user.tag} (${userId}) wiped their data in guild ${guildId} - Deleted ${deletedCount} records`);
      if (deleteErrors.length > 0) {
        logger.warn(`Data wipe completed with ${deleteErrors.length} deletion errors for user ${userId} in guild ${guildId}`);
      }

    } catch (error) {
      logger.error('Wipedata confirm button handler error:', error);
      
      await interaction.editReply({
        embeds: [errorEmbed('Data Wipe Failed', 'An error occurred while wiping your data. Please try again later or contact support.')],
        components: []
      });
    }
  }
};





const wipedataCancelHandler = {
  name: 'wipedata_no',
  async execute(interaction, client) {
    try {
      await interaction.update({
        embeds: [
          createEmbed({
            title: '❌ Data Wipe Cancelled',
            description: 'Your data has been preserved. Your account remains unchanged.',
            color: 'info'
          })
        ],
        components: []
      });

      logger.info(`User ${interaction.user.tag} (${interaction.user.id}) cancelled data wipe in guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Wipedata cancel button handler error:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Error', 'Could not cancel data wipe.')],
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};

export { wipedataConfirmHandler, wipedataCancelHandler };




