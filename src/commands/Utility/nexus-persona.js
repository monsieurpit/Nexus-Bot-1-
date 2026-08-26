import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { setUserPersona, clearUserPersona, getUserPersona, USER_SELECTABLE_PERSONAS } from '../../services/nexusAiService.js';

const PERSONA_INFO = {
  'nexus-homie': { label: 'Nexus (Homie)', desc: 'The default — casual, friendly, natural swearing' },
  'crashout-bot': { label: 'Crashout Bot', desc: 'Unhinged, chaotic, zero filter' },
  'roast-master': { label: 'Roast Master', desc: 'Savage comebacks and roasts on demand' },
  'chill-mod': { label: 'Chill Mod', desc: 'Calm, level-headed, low-drama tone' },
  'code-architect': { label: 'Code Architect', desc: 'Sharp, technical, programming-focused' },
  'deep-researcher': { label: 'Deep Researcher', desc: 'Thorough, detail-oriented answers' },
  'gemini-core': { label: 'Core Intelligence', desc: 'Balanced, broadly capable reasoning' },
  'socratic-mentor': { label: 'Socratic Mentor', desc: 'Teaches by asking guiding questions' },
  'creative-synthesizer': { label: 'Creative Synthesizer', desc: 'Imaginative, expressive, story-minded' },
};

export default {
  data: new SlashCommandBuilder()
    .setName('nexus-persona')
    .setDescription('Pick which Nexus AI personality answers your messages')
    .addStringOption((option) => {
      option
        .setName('persona')
        .setDescription('The persona to use (leave out to check your current one, "reset" to clear it)')
        .setRequired(false);
      for (const id of USER_SELECTABLE_PERSONAS) {
        option.addChoices({ name: `${PERSONA_INFO[id].label} — ${PERSONA_INFO[id].desc}`, value: id });
      }
      option.addChoices({ name: 'Reset to server default', value: 'reset' });
      return option;
    }),

  async execute(interaction) {
    try {
      const client = interaction.client;
      const userId = interaction.user.id;
      const choice = interaction.options.getString('persona');

      if (!choice) {
        const current = await getUserPersona(client, userId);
        const embed = createEmbed({
          title: '🤖 Your Nexus Persona',
          description: current
            ? `You're currently set to **${PERSONA_INFO[current]?.label || current}**.\nUse \`/nexus-persona\` again with a different choice to switch, or pick "Reset to server default" to clear it.`
            : "You haven't picked a persona — Nexus is answering you with the server default. Use `/nexus-persona` and pick one to customize it.",
          color: 'info',
        });
        await InteractionHelper.safeReply(interaction, { embeds: [embed], flags: 64 });
        return;
      }

      if (choice === 'reset') {
        await clearUserPersona(client, userId);
        await InteractionHelper.safeReply(interaction, {
          content: "Reset — I'll answer you with the server default persona from now on.",
          flags: 64,
        });
        return;
      }

      const saved = await setUserPersona(client, userId, choice);
      if (!saved) {
        await InteractionHelper.safeReply(interaction, {
          content: 'Could not save your persona choice right now. Please try again later.',
          flags: 64,
        });
        return;
      }

      const info = PERSONA_INFO[choice];
      const embed = createEmbed({
        title: '✅ Persona Updated',
        description: `From now on, I'll talk to you as **${info.label}** — ${info.desc}.\nThis only changes how I answer you personally, not for anyone else in the server.`,
        color: 'success',
      });
      await InteractionHelper.safeReply(interaction, { embeds: [embed], flags: 64 });

      logger.info('Nexus persona preference updated', { userId, persona: choice });
    } catch (error) {
      logger.error('nexus-persona command execution failed', {
        error: error.message,
        stack: error.stack,
        userId: interaction.user?.id,
        commandName: 'nexus-persona',
      });
      await handleInteractionError(interaction, error, {
        commandName: 'nexus-persona',
        source: 'nexus_persona_command',
      });
    }
  },
};
