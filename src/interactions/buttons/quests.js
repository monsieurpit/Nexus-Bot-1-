// Buttons on quest messages: quests:<claim|season|board|refresh>:<ownerId>, and on the public
// daily post quests:mine / quests:leaderboard (anyone can press; answered privately).
// Persistent (routed by customId), so they keep working after a restart.
import { MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { renderQuestBoard, renderSeason, claimAndRender } from '../../services/quests/questViews.js';

export default {
  name: 'quests',
  async execute(interaction, client, args) {
    const [action, ownerId] = args;
    try {
      if (ownerId && interaction.user.id !== ownerId) {
        return interaction.reply({
          embeds: [createEmbed({
            title: '📜 Not your quests',
            description: `These belong to <@${ownerId}>. Run \`/quests progress\` to see your own board, or \`/quests season\` for the leaderboard.`,
            color: 'info',
          })],
          flags: MessageFlags.Ephemeral,
        });
      }
      const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id);

      // Buttons on the public daily post: answer privately with the presser's own view.
      if (action === 'mine' || action === 'leaderboard') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const payload = action === 'mine'
          ? await renderQuestBoard(client, interaction.guild, member, interaction.user)
          : await renderSeason(client, interaction.guild, member);
        await interaction.editReply(payload);
        return;
      }

      await interaction.deferUpdate();

      if (action === 'claim') {
        const { board, celebration } = await claimAndRender(client, interaction.guild, member);
        await interaction.editReply(board);
        if (celebration) await interaction.followUp(celebration);
        return;
      }
      if (action === 'season') {
        await interaction.editReply(await renderSeason(client, interaction.guild, member));
        return;
      }
      // board / refresh
      await interaction.editReply(await renderQuestBoard(client, interaction.guild, member, interaction.user));
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', customId: interaction.customId });
    }
  },
};
