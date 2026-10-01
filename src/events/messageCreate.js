import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { awardMessageCoins } from '../services/economy.js';
import { RaidDetectionService } from '../services/raidDetectionService.js';
import { handleScamDetection } from '../services/scamDetectionService.js';
import { getTicketData } from '../utils/database.js';
import { AiModerationService } from '../services/aiModerationService.js';
import { getAfk, clearAfk } from '../services/afkService.js';
import { handleAutoSlowmode } from '../services/autoSlowmodeService.js';
import { handleChaosTriggers } from '../services/chaosTriggerService.js';
import { handleStickyNote } from '../services/stickyNoteService.js';
import { handleNexusAiMessage, resolveNexusTrigger } from '../services/nexusAiService.js';
import { recordChannelMessage } from '../services/channelHistoryService.js';
import { recordWeeklyStat } from '../services/weeklySummaryService.js';
import { handleDirectMessage } from '../services/dmService.js';
import { capturePrediction } from '../services/predictionService.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {
      if (message.author.bot) return;

      if (!message.guild) {
        await handleDirectMessage(message, client).catch(err =>
          logger.error('Error handling direct message:', err)
        );
        return;
      }

      recordWeeklyStat(client, message.guild.id, 'messagesSent').catch(() => null);

      // Nexus's "brain" — every real message goes into its channel's rolling history (ambient
      // awareness of the channel, not just its own Q&A turns). Recorded first, synchronously, so
      // the history stays in real chronological order (question before Nexus's answer); the Nexus
      // handler excludes this exact message from the context it sends, so it is never handed its
      // own current question as if it were prior context.
      recordChannelMessage(message.channel.id, {
        messageId: message.id,
        authorId: message.author.id,
        username: message.author.username,
        content: message.content,
        isBot: false,
      });

      const isNexusQuery = Boolean(resolveNexusTrigger(message));

      // Resolve ticket status ONCE — reused by all services that must stay
      // silent in ticket channels (scam detection, AI mod, chaos roasts, etc.)
      const isTicketChannel = !!(await getTicketData(message.guild.id, message.channel.id).catch(() => null));

      // The Nexus AI answer can take a long time (the engine may need minutes under load), so it
      // runs concurrently instead of blocking every other service. Security checks ALWAYS run,
      // even on messages addressed to Nexus — otherwise prefixing a scam with "nexus" bypassed
      // scam detection and AI moderation entirely.
      const nexusTask = isNexusQuery
        ? handleNexusAiMessage(message).catch(err => {
            logger.error('Error in Nexus AI message handler:', err);
            return false;
          })
        : Promise.resolve(false);

      await Promise.all([
        handleLeveling(message, client),
        handleMessageCoins(message).catch(err =>
          logger.debug('Error in message coins handler:', err)
        ),
        RaidDetectionService.processMessage(message, client).catch(err =>
          logger.debug('Error in raid detection message processing:', err)
        ),
        isTicketChannel ? Promise.resolve() :
          handleScamDetection(message, client).catch(err =>
            logger.debug('Error in scam detection:', err)
          ),
        isTicketChannel ? Promise.resolve() :
          AiModerationService.processMessage(message, client).catch(err =>
            logger.debug('Error in AI moderation:', err)
          ),
        handleAutoSlowmode(message).catch(err =>
          logger.debug('Error in auto-slowmode handling:', err)
        ),
        handleStickyNote(message, client).catch(err =>
          logger.debug('Error in sticky note handling:', err)
        ),
        capturePrediction(message, client).catch(err =>
          logger.debug('Error capturing football prediction:', err)
        ),
      ]);

      // AFK runs everywhere — useful even inside tickets
      const afkReplied = await handleAfk(message, client).catch(err => {
        logger.debug('Error in AFK handling:', err);
        return false;
      });

      // Reply-based personality triggers — silent in ticket channels, on messages addressed to
      // Nexus (Nexus answers those itself), and when the AFK handler already replied, so a single
      // message never gets a pile of different bot replies.
      if (!isTicketChannel && !isNexusQuery && !afkReplied) {
        await handleChaosTriggers(message).catch(err =>
          logger.debug('Error in chaos trigger handler:', err)
        );
      }

      await nexusTask;
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

async function handleMessageCoins(message) {
  if (!message.content || message.content.trim().length === 0) return;
  await awardMessageCoins(message.guild.id, message.author.id);
}

async function handleLeveling(message, client) {
  try {
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
    const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
    if (!canProcess) return;

    const levelingConfig = await getLevelingConfig(client, message.guild.id);
    if (!levelingConfig?.enabled) return;

    if (levelingConfig.ignoredChannels?.includes(message.channel.id)) return;

    // Cache or fetch member safely once for both role validation and XP distribution
    let member = message.member;
    if (!member) {
      member = await message.guild.members.fetch(message.author.id).catch(() => null);
    }

    if (levelingConfig.ignoredRoles?.length > 0 && member) {
      if (member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) {
        return;
      }
    }

    if (!message.content || message.content.trim().length === 0) return;

    const userData = await getUserLevelData(client, message.guild.id, message.author.id);
    
    const cooldownTime = levelingConfig.xpCooldown || 60;
    const now = Date.now();
    const timeSinceLastMessage = now - (userData.lastMessage || 0);
    
    if (timeSinceLastMessage < cooldownTime * 1000) return;

    const minXP = levelingConfig.xpRange?.min || levelingConfig.xpPerMessage?.min || 15;
    const maxXP = levelingConfig.xpRange?.max || levelingConfig.xpPerMessage?.max || 25;

    const safeMinXP = Math.max(1, minXP);
    const safeMaxXP = Math.max(safeMinXP, maxXP);

    const xpToGive = Math.floor(Math.random() * (safeMaxXP - safeMinXP + 1)) + safeMinXP;

    let finalXP = xpToGive;
    if (levelingConfig.xpMultiplier && levelingConfig.xpMultiplier > 1) {
      finalXP = Math.floor(finalXP * levelingConfig.xpMultiplier);
    }

    // Pass the confirmed member object
    const result = await addXp(client, message.guild, member, finalXP);
    
    if (result?.success && result?.leveledUp) {
      logger.info(
        `${message.author.tag} leveled up to level ${result.level} in ${message.guild.name}`
      );
    }
  } catch (error) {
    logger.error('Error handling leveling for message:', error);
  }
}

// Returns true when it replied to the message (so the caller can skip other reply-based triggers).
async function handleAfk(message, client) {
  let replied = false;
  try {
    const guildId = message.guild.id;

    // 1. The author returns from AFK
    const authorAfk = await getAfk(guildId, message.author.id);
    if (authorAfk) {
      await clearAfk(guildId, message.author.id);
      const backReply = await message.reply({
        content: `👋 Welcome back ${message.author}, I removed your AFK status.`,
        allowedMentions: { repliedUser: false }
      }).catch(() => null);

      if (backReply) {
        replied = true;
        setTimeout(() => backReply.delete().catch(() => {}), 10000);
      }
    }

    // 2. Notify when AFK users are mentioned (Processed concurrently)
    if (message.mentions.users.size > 0) {
      const mentionPromises = Array.from(message.mentions.users.values()).map(async (user) => {
        if (user.bot || user.id === message.author.id) return null;

        const afk = await getAfk(guildId, user.id);
        if (afk) {
          const since = afk.since ? ` (since <t:${Math.floor(afk.since / 1000)}:R>)` : '';
          return `💤 **${user.username}** is AFK${since}: ${afk.message}`;
        }
        return null;
      });

      const lines = (await Promise.all(mentionPromises)).filter(Boolean);

      if (lines.length > 0) {
        const notice = await message.reply({
          content: lines.join('\n').slice(0, 2000),
          allowedMentions: { parse: [] }
        }).catch(() => null);
        if (notice) replied = true;
      }
    }
  } catch (error) {
    logger.debug('Error handling AFK for message:', error);
  }
  return replied;
}
