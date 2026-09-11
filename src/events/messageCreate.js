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
import { handleNexusAiMessage } from '../services/nexusAiService.js';
import { recordChannelMessage } from '../services/channelHistoryService.js';
import { recordWeeklyStat } from '../services/weeklySummaryService.js';
import { handleDirectMessage } from '../services/dmService.js';
import { capturePrediction } from '../services/predictionService.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    // Declared here, outside the try block, so the finally clause below can see it regardless
    // of which of the try body's early returns (bot author, DM) fires before the patch below is
    // even reached — a `const` declared inside try{} isn't visible from a sibling finally{}.
    let originalReply;
    try {
      if (message.author.bot) return;

      if (!message.guild) {
        await handleDirectMessage(message, client).catch(err =>
          logger.error('Error handling direct message:', err)
        );
        return;
      }

      recordWeeklyStat(client, message.guild.id, 'messagesSent').catch(() => null);

      // Ensure only one reply is ever sent per message across all services.
      // Monkey-patch message.reply so the first call wins and subsequent ones are no-ops.
      // The flag is set synchronously before the async Discord API call so that any
      // concurrent callers see hasReplied = true immediately, eliminating race conditions.
      //
      // Found by a code review: this used to never be undone, permanently overwriting .reply on
      // the actual, Discord.js-cached Message object (not a local copy) - after this handler ran
      // once, ANY future code that fetched this exact message from `channel.messages.cache` by
      // id and called .reply() on it would get a silent no-op forever, since the closure's own
      // repliedMessages WeakMap already had this message flagged. Restored in the finally clause
      // below instead, so the patch only lives for the duration of this one invocation - real
      // dedup while this handler's async work is in flight, no permanent mutation of a shared
      // object afterward.
      const repliedMessages = new WeakMap();
      originalReply = message.reply.bind(message);
      message.reply = (...args) => {
        if (repliedMessages.has(message)) return Promise.resolve(null);
        repliedMessages.set(message, true);
        return originalReply(...args);
      };

      // Check if message is a Nexus AI question prompt (e.g. "Nexus what is...")
      const wasNexusAiQuery = await handleNexusAiMessage(message).catch(err => {
        logger.error('Error in Nexus AI message handler:', err);
        return false;
      });

      // Resolve ticket status ONCE — reused by all services that must stay
      // silent in ticket channels (scam detection, AI mod, swear roasts, etc.)
      const isTicketChannel = !!(await getTicketData(message.guild.id, message.channel.id).catch(() => null));

      // Non-reply services run in parallel (leveling, moderation, slowmode)
      await Promise.all([
        handleLeveling(message, client),
        handleMessageCoins(message).catch(err =>
          logger.debug('Error in message coins handler:', err)
        ),
        RaidDetectionService.processMessage(message, client).catch(err =>
          logger.debug('Error in raid detection message processing:', err)
        ),
        // Scam detection — skip in ticket channels or if it was a Nexus AI query
        (isTicketChannel || wasNexusAiQuery) ? Promise.resolve() :
          handleScamDetection(message, client).catch(err =>
            logger.debug('Error in scam detection:', err)
          ),
        // AI moderation — skip in ticket channels or if it was a Nexus AI query
        (isTicketChannel || wasNexusAiQuery) ? Promise.resolve() :
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
      await handleAfk(message, client).catch(err =>
        logger.debug('Error in AFK handling:', err)
      );

      // Reply-based personality services — silent in ticket channels and if Nexus AI already responded
      if (!isTicketChannel && !wasNexusAiQuery) {
        await handleChaosTriggers(message).catch(err =>
          logger.debug('Error in chaos trigger handler:', err)
        );
      }

      // Nexus's "brain" — record this message into its channel's rolling history AFTER
      // handleNexusAiMessage already ran above, not before: that ordering means a message that
      // itself triggers Nexus sees the channel's history as it stood BEFORE this message (so
      // it isn't handed its own current question as if it were prior context), while still
      // being available to every message that comes after it. Every real message counts, not
      // just ones addressed to Nexus — that's the whole point, ambient awareness of the channel
      // instead of only its own Q&A turns.
      recordChannelMessage(message.channel.id, {
        authorId: message.author.id,
        username: message.author.username,
        content: message.content,
        isBot: false,
      });
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    } finally {
      // Only restore if the patch actually ran (an early return above the patch point, e.g. a
      // bot author or a DM, never touched message.reply at all, so there's nothing to undo).
      if (originalReply) {
        message.reply = originalReply;
      }
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

async function handleAfk(message, client) {
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
        await message.reply({
          content: lines.join('\n').slice(0, 2000),
          allowedMentions: { parse: [] }
        }).catch(() => null);
      }
    }
  } catch (error) {
    logger.debug('Error handling AFK for message:', error);
  }
}
