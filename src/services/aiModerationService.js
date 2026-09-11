import { logger } from '../utils/logger.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { QuarantineService } from './quarantineService.js';
import { createEmbed } from '../utils/embeds.js';
import { NexusAI } from '../../nexus-ai.js';
import axios from 'axios';

// Talks to the same real, deployed Nexus AI RaidShield engine as nexusAiService.js, through the
// official SDK instead of a duplicated raw fetch + local heuristic classifier - the central
// engine is the source of truth for threat classification, not a copy of its logic living here.
const nexusClient = new NexusAI({
  apiKey: process.env.NEXUS_API_KEY,
  baseUrl: process.env.NEXUS_API_URL,
});

// Split into two separate limits after checking the actual server-side cost of each: RaidShield's
// TEXT classification (Nexus-AI-'s server.ts, /api/v1/raidshield) is pure synchronous rule
// matching (evaluateRaidShieldRules in ruleEngine.ts) - no LLM call at all, sub-millisecond
// server-side compute. Only messages with an IMAGE attachment trigger a real Ollama vision-model
// call, which is genuinely slow and constrained by the server's Ollama concurrency limit.
//
// A single shared 'ai-mod-global' limit of 14/60s (found live: a genuine gap - during exactly the
// kind of message burst RaidShield exists to catch, e.g. a raid, this ceiling gets exhausted and
// every message past it is skipped with ZERO analysis, no fallback, no alert) was almost
// certainly calibrated assuming every check costs a slow LLM round-trip, which is only true for
// the image case. Text-only checks (the overwhelming majority of traffic) can sustain a much
// higher rate without risking the server at all. Image checks stay conservative since they're
// genuinely LLM-backed and the server's own Ollama concurrency cap (OLLAMA_MAX_CONCURRENT,
// separately confirmed to now gate vision calls too) is the real constraint there.
//
// This does not eliminate the possibility of hitting a ceiling entirely (a truly enormous burst
// still could), but it moves the ceiling to reflect the ACTUAL cost of each check instead of a
// blanket conservative guess, closing the gap for the realistic case. RaidDetectionService (join
// bursts, cross-channel spam, name/invite similarity) runs as a fully separate, always-on,
// non-AI-dependent check regardless of this limit - this is specifically about the AI CONTENT
// classifier's own coverage, not raid protection as a whole.
// Found by a code review: these were flat, guild-agnostic string constants
// ('ai-mod-global-text' / 'ai-mod-global-image'), so checkRateLimit() — which keys purely off the
// string it's given, see rateLimiter.js — shared ONE bucket across every guild this bot is in.
// Any regular member in ANY guild could exhaust the entire global text bucket (90 one-character
// messages in under 60s costs nothing and isn't even blocked by permissions), and for the next
// 60s every OTHER guild's real traffic — including an actual coordinated raid — got skipped with
// zero AI analysis. Now built per-guild in processMessage() below (`ai-mod-text:${guildId}`),
// so one guild's traffic can never starve another's.
const AI_RATE_LIMIT_KEY_TEXT_PREFIX = 'ai-mod-text';
const AI_RATE_LIMIT_ATTEMPTS_TEXT = 90;
const AI_RATE_LIMIT_KEY_IMAGE_PREFIX = 'ai-mod-image';
const AI_RATE_LIMIT_ATTEMPTS_IMAGE = 20;
const AI_RATE_LIMIT_WINDOW_MS = 60000;

const MIN_CONTENT_LENGTH = 4;

const IMAGE_CACHE_MAX_SIZE = 100;
const IMAGE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const imageCache = new Map();

const CONTEXT_MESSAGES_LIMIT = 5;

function getCachedImage(url) {
  const cached = imageCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > IMAGE_CACHE_TTL_MS) {
    imageCache.delete(url);
    return null;
  }
  return cached.data;
}

function setCachedImage(url, data) {
  if (imageCache.size >= IMAGE_CACHE_MAX_SIZE) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey) imageCache.delete(oldestKey);
  }
  imageCache.set(url, { data, timestamp: Date.now() });
}

async function fetchRecentMessages(channel, beforeMessageId) {
  try {
    const messages = await channel.messages.fetch({
      limit: CONTEXT_MESSAGES_LIMIT,
      before: beforeMessageId
    });
    const formatted = [];
    for (const msg of messages.values()) {
      if (msg.author.bot) continue;
      const content = msg.content?.trim();
      if (content && content.length >= MIN_CONTENT_LENGTH) {
        formatted.push({
          messageId: msg.id,
          authorId: msg.author.id,
          username: msg.author.username,
          displayName: msg.member?.displayName || msg.author.globalName || msg.author.username,
          content: content.slice(0, 200),
          timestamp: msg.createdTimestamp
        });
      }
    }
    return formatted.sort((a, b) => b.timestamp - a.timestamp).slice(0, CONTEXT_MESSAGES_LIMIT);
  } catch (error) {
    logger.debug('Failed to fetch recent messages for context:', error.message);
    return [];
  }
}

function formatMessageIdentity(message) {
  const author = message.author;
  return {
    messageId: message.id,
    authorId: author?.id || 'unknown',
    username: author?.username || 'unknown',
    displayName: message.member?.displayName || author?.globalName || author?.username || 'unknown',
    channelId: message.channel?.id || 'unknown'
  };
}

async function analyzeContent(text, imageUrls = [], recentMessages = [], currentMessage = null) {
  const imageUrl = (imageUrls && imageUrls[0]) || '';

  // The image cache (getCachedImage/setCachedImage) used to be fully implemented but never
  // actually called anywhere — every image-bearing message paid the real vision-model round-trip
  // even when the exact same attachment URL (a re-posted scam image, or a message people keep
  // reacting to / re-sharing) had already been scanned in the last 30 minutes. Wired in here so
  // repeat scans of the same URL are free and don't eat into AI_RATE_LIMIT_KEY_IMAGE's budget.
  if (imageUrl) {
    const cached = getCachedImage(imageUrl);
    if (cached) {
      logger.debug('[AI Moderation] Image classification served from cache', { imageUrl });
      return cached;
    }
  }

  logger.info('🔍 Nexus AI RaidShield: Starting threat analysis', {
    textLength: text?.length ?? 0,
    imageCount: imageUrls.length,
    contextMessages: recentMessages.length
  });

  // Query the real, central Nexus AI RaidShield engine via the SDK. If it's unreachable,
  // fail open to "safe" rather than duplicating its 21-rule classifier locally - a stale
  // local copy would drift from the real engine's fixes and rules over time.
  try {
    const result = await nexusClient.checkSecurity({
      messageText: text,
      authorId: currentMessage?.authorId || '',
      imageUrl
    });
    if (result && result.classification) {
      const classified = {
        classification: result.classification,
        confidence: typeof result.confidence === 'number' ? result.confidence : 0.95,
        reason: result.reason || 'Verified via central Nexus AI RaidShield engine'
      };
      if (imageUrl) setCachedImage(imageUrl, classified);
      return classified;
    }
  } catch (err) {
    logger.debug(`[AI Moderation] Central RaidShield call failed, defaulting to safe: ${err.message}`);
  }

  return {
    classification: 'safe',
    confidence: 0.95,
    reason: 'Adheres to safe server guidelines'
  };
}

function getActionForClassification(aiConfig, classification) {
  const actions = aiConfig.actions || {};
  return actions[classification] || 'quarantine';
}

// Returns the action actually taken, which may differ from the requested `action` — every call
// site (sendAiAlert, in particular) must use THIS return value for what it reports, never the
// input `action` string. Found by a code review: kick/ban/timeout used to silently no-op when
// member.kickable/bannable/moderatable was false (bot's role below the target's, or missing the
// underlying permission) with no log line at all, and the 'quarantine' case never checked
// QuarantineService.triggerQuarantine's own { success, reason } return — it can silently no-op
// when the core Raid Shield toggle (/raidshield toggle) is off even though AI moderation has its
// own, independent enable flag. In both cases the message still got deleted and the staff alert
// still claimed the configured action succeeded, so staff believed a threat was contained when
// the member kept every role and could act again immediately.
async function executeAction(action, message, client, aiResult, aiConfig) {
  const guild = message.guild;
  const authorId = message.author?.id;
  if (!authorId) {
    logger.error('AI moderation refused to act because the message has no author ID', {
      messageId: message.id,
      guildId: guild?.id
    });
    return { action: 'none', reason: 'no_author_id' };
  }

  const member = message.member?.id === authorId
    ? message.member
    : await guild.members.fetch(authorId).catch(() => null);
  if (!member) return { action: 'none', reason: 'member_not_found' };
  if (member.id !== authorId) {
    logger.error('AI moderation refused to act because the resolved member did not match the message author', {
      messageId: message.id,
      expectedAuthorId: authorId,
      resolvedMemberId: member.id
    });
    return { action: 'none', reason: 'member_mismatch' };
  }

  let outcome = { action: 'none', reason: 'unknown_action' };

  switch (action) {
    case 'quarantine': {
      const result = await QuarantineService.triggerQuarantine({
        guild,
        client,
        suspects: [member],
        reason: `ai_${aiResult.classification}`,
        metadata: {
          aiClassification: aiResult.classification,
          aiConfidence: aiResult.confidence,
          aiReason: aiResult.reason,
          messageContent: message.content?.slice(0, 500) || '[no text]',
          messageId: message.id,
          authorId,
          authorUsername: message.author.username,
          channelId: message.channel.id,
          detectedAt: new Date().toISOString(),
          tripReasons: [`ai_${aiResult.classification}`]
        }
      });
      if (result?.success) {
        outcome = { action: 'quarantine' };
      } else if (result?.reason === 'disabled') {
        // Quarantine requires the core Raid Shield toggle to be on; AI moderation can be enabled
        // independently of it. Fall back to a real, always-available action instead of doing
        // nothing while claiming otherwise.
        logger.warn(`AI moderation: quarantine unavailable (Raid Shield core is disabled) for ${authorId} in guild ${guild.id}, falling back to timeout`);
        if (member.moderatable) {
          await member.timeout(600000, `AI Moderation: ${aiResult.classification} (${aiResult.reason}) — quarantine unavailable, Raid Shield disabled`).catch(() => null);
          outcome = { action: 'timeout', reason: 'quarantine_disabled_fallback' };
        } else {
          outcome = { action: 'failed', reason: 'quarantine_disabled_and_not_moderatable' };
        }
      } else {
        logger.warn(`AI moderation: quarantine failed for ${authorId} in guild ${guild.id}: ${result?.reason}`);
        outcome = { action: 'failed', reason: result?.reason || 'quarantine_failed' };
      }
      break;
    }
    case 'kick': {
      if (member.kickable) {
        await member.kick(`AI Moderation: ${aiResult.classification} (${aiResult.reason})`);
        outcome = { action: 'kick' };
      } else {
        logger.warn(`AI moderation: cannot kick ${authorId} in guild ${guild.id} — not kickable (role hierarchy or missing permission)`);
        outcome = { action: 'failed', reason: 'not_kickable' };
      }
      break;
    }
    case 'ban': {
      if (member.bannable) {
        await guild.members.ban(member.id, {
          reason: `AI Moderation: ${aiResult.classification} (${aiResult.reason})`,
          deleteMessageSeconds: 86400
        });
        outcome = { action: 'ban' };
      } else {
        logger.warn(`AI moderation: cannot ban ${authorId} in guild ${guild.id} — not bannable (role hierarchy or missing permission)`);
        outcome = { action: 'failed', reason: 'not_bannable' };
      }
      break;
    }
    case 'delete': {
      outcome = { action: 'delete' };
      break;
    }
    case 'timeout': {
      if (member.moderatable) {
        await member.timeout(600000, `AI Moderation: ${aiResult.classification} (${aiResult.reason})`);
        outcome = { action: 'timeout' };
      } else {
        logger.warn(`AI moderation: cannot timeout ${authorId} in guild ${guild.id} — not moderatable (role hierarchy or missing permission)`);
        outcome = { action: 'failed', reason: 'not_moderatable' };
      }
      break;
    }
    default:
      break;
  }

  if (outcome.action !== 'delete' && message.deletable) {
    await message.delete().catch(() => null);
  }

  return outcome;
}

async function sendAiAlert(message, client, aiResult, action, aiConfig) {
  const { RaidDetectionService } = await import('./raidDetectionService.js');
  const config = await RaidDetectionService.getRaidConfig(client, message.guild.id);
  const channelId = aiConfig.alertChannelId || config.notificationChannelId;
  if (!channelId) return;

  const alertChannel = message.guild.channels.cache.get(channelId);
  if (!alertChannel?.isTextBased()) return;

  const classificationEmoji = {
    scam: '🎣',
    spam: '📩',
    bot: '🤖',
    raid: '🚨'
  };

  // `action` here is the REAL outcome returned by executeAction() — not the configured/requested
  // action — so a permission failure or a disabled quarantine correctly shows as failed/fallback
  // instead of always claiming the configured action succeeded.
  const actionLabels = {
    quarantine: 'Quarantined / En Cuarentena',
    kick: 'Kicked / Expulsado',
    ban: 'Banned / Baneado',
    delete: 'Message Deleted / Mensaje Eliminado',
    timeout: 'Timed Out / Silenciado',
    failed: '⚠️ Action FAILED — check bot role position/permissions / Acción FALLIDA — revisa el rol/permisos del bot',
    none: '⚠️ No action taken / Ninguna acción tomada'
  };

  const embed = createEmbed({
    title: `${classificationEmoji[aiResult.classification] || '⚠️'} AI Moderation Alert / Alerta de Moderación IA`,
    description: `A message was flagged by AI analysis.\nUn mensaje fue marcado por el análisis de IA.`,
    color: aiResult.classification === 'raid' ? 'error' : 'warning',
    fields: [
      {
        name: 'Author / Autor',
        value: `${message.author} (\`${message.author.username}\` | ${message.author.id})`,
        inline: true
      },
      {
        name: 'Channel / Canal',
        value: `${message.channel}`,
        inline: true
      },
      {
        name: 'Classification / Clasificación',
        value: `**${aiResult.classification.toUpperCase()}** (${Math.round(aiResult.confidence * 100)}% confidence)`,
        inline: true
      },
      {
        name: 'AI Reason / Razón IA',
        value: (aiResult.reason || 'No reason provided').slice(0, 1024),
        inline: false
      },
      {
        name: 'Action Taken / Acción Tomada',
        value: actionLabels[action] || action,
        inline: true
      },
      {
        name: 'Message Content / Contenido',
        value: (message.content || '[No text / Sin texto]').slice(0, 1024),
        inline: false
      },
      {
        name: 'Message ID / ID del Mensaje',
        value: `\`${message.id}\``,
        inline: false
      }
    ]
  });

  const isScam = aiResult.classification === 'scam';
  const pingContent = (isScam && config.alertRoleId) ? `<@&${config.alertRoleId}>` : null;
  await alertChannel.send({
    content: pingContent,
    embeds: [embed],
    allowedMentions: { roles: (isScam && config.alertRoleId) ? [config.alertRoleId] : [] }
  }).catch(err => logger.debug('Failed to send AI alert:', err.message));
}

export class AiModerationService {
  static async getAiConfig(client, guildId) {
    try {
      const { getGuildConfig } = await import('../utils/database.js');
      const config = await getGuildConfig(client, guildId);
      return {
        enabled: config?.raidShield?.aiModeration?.enabled ?? false,
        confidenceThreshold: config?.raidShield?.aiModeration?.confidenceThreshold ?? 0.90,
        scanImages: config?.raidShield?.aiModeration?.scanImages ?? true,
        alertChannelId: config?.raidShield?.aiModeration?.alertChannelId ?? null,
        trustedRoles: config?.raidShield?.aiModeration?.trustedRoles ?? [],
        enableContext: config?.raidShield?.aiModeration?.enableContext ?? true,
        actions: {
          scam: config?.raidShield?.aiModeration?.actions?.scam ?? 'quarantine',
          spam: config?.raidShield?.aiModeration?.actions?.spam ?? 'quarantine',
          bot: config?.raidShield?.aiModeration?.actions?.bot ?? 'quarantine',
          raid: config?.raidShield?.aiModeration?.actions?.raid ?? 'quarantine',
          ...(config?.raidShield?.aiModeration?.actions || {})
        }
      };
    } catch (error) {
      logger.error('Error getting AI moderation config:', error);
      // Matches the happy-path default (0.90) instead of the looser 0.80 this used to fall back
      // to - a transient DB error is exactly the wrong moment to make AI moderation MORE
      // trigger-happy than normal. Note: since `enabled: false` below already short-circuits
      // processMessage() before confidenceThreshold is ever read, this specific mismatch had no
      // actual behavioral impact today - fixed anyway so the two branches don't silently drift
      // further apart, and so this doesn't become a real bug if `enabled` here ever changes.
      return {
        enabled: false,
        confidenceThreshold: 0.90,
        scanImages: true,
        alertChannelId: null,
        trustedRoles: [],
        enableContext: true,
        actions: { scam: 'quarantine', spam: 'quarantine', bot: 'quarantine', raid: 'quarantine' }
      };
    }
  }

  static async saveAiConfig(client, guildId, updates) {
    try {
      const { getGuildConfig, setGuildConfig } = await import('../utils/database.js');
      const config = await getGuildConfig(client, guildId);
      const current = config?.raidShield?.aiModeration || {};
      const aiModeration = { ...current, ...updates };
      if (updates.actions) {
        aiModeration.actions = { ...(current.actions || {}), ...updates.actions };
      }
      const raidShield = { ...config?.raidShield, aiModeration };
      await setGuildConfig(client, guildId, { ...config, raidShield });
      return true;
    } catch (error) {
      logger.error('Error saving AI moderation config:', error);
      return false;
    }
  }

  static async processMessage(message, client) {
    try {
      if (message.author.bot || !message.guild) return;

      if (message.webhookId) {
        logger.debug('Skipping webhook message');
        return;
      }

      logger.info('🎯 AI Moderation: Message received', {
        guildId: message.guild.id,
        userId: message.author.id,
        contentLength: message.content?.length ?? 0
      });

      const aiConfig = await this.getAiConfig(client, message.guild.id);

      if (!aiConfig.enabled) {
        logger.debug('AI moderation disabled for this guild');
        return;
      }

      logger.debug('🛡️ Nexus AI RaidShield: Processing message');

      const member = message.member?.id === message.author.id
        ? message.member
        : await message.guild.members.fetch(message.author.id).catch(() => null);
      if (!member) {
        logger.debug('AI moderation: could not resolve member, skipping to avoid false positive');
        return;
      }

      // Found by a code review: ManageMessages used to grant a blanket AI-moderation bypass, but
      // that permission is commonly handed out to "trusted member" / pin-in-this-channel roles
      // that have nothing to do with real moderation authority — a hijacked account holding one
      // of those roles became permanently invisible to RaidShield. Restricted to actual
      // moderation power (owner, Administrator, or the ability to remove people: Ban/Kick
      // Members); anything looser belongs in the purpose-built `trustedRoles` config below, which
      // a server can still use for exactly that case.
      if (
        member.id === message.guild.ownerId ||
        member.permissions.has('Administrator') ||
        member.permissions.has('BanMembers') ||
        member.permissions.has('KickMembers')
      ) {
        logger.debug('User has moderation permissions, skipping AI moderation');
        return;
      }
      if (aiConfig.trustedRoles?.length > 0) {
        const hasTrustedRole = aiConfig.trustedRoles.some(roleId => member.roles.cache.has(roleId));
        if (hasTrustedRole) {
          logger.debug('User has trusted role, skipping AI moderation');
          return;
        }
      }

      // Image detection moved ahead of the rate-limit gate below (it used to run after) so the
      // gate can apply the correct limit for what this specific message actually costs the
      // server, instead of one shared ceiling calibrated for the more expensive case.
      const text = message.content || '';
      const imageUrls = [];

      if (aiConfig.scanImages && message.attachments?.size > 0) {
        for (const attachment of message.attachments.values()) {
          const isImage = /\.(png|jpe?g|gif|webp)$/i.test(attachment.name || '') ||
            attachment.contentType?.startsWith('image/');
          if (isImage && attachment.url) {
            imageUrls.push(attachment.url);
          }
        }
      }

      // Length/attachment filter now runs BEFORE the rate-limit check (it used to run after,
      // so a trivial 1-3 character message still consumed a rate-limit slot it never needed).
      if (text.length < MIN_CONTENT_LENGTH && imageUrls.length === 0) {
        logger.debug('Message too short and no images, skipping');
        return;
      }

      const hasImage = imageUrls.length > 0;
      // Per-guild keys (see the constants' comment above) — one guild's traffic, malicious or
      // not, can no longer exhaust another guild's AI-moderation budget.
      const canProcess = hasImage
        ? await checkRateLimit(`${AI_RATE_LIMIT_KEY_IMAGE_PREFIX}:${message.guild.id}`, AI_RATE_LIMIT_ATTEMPTS_IMAGE, AI_RATE_LIMIT_WINDOW_MS)
        : await checkRateLimit(`${AI_RATE_LIMIT_KEY_TEXT_PREFIX}:${message.guild.id}`, AI_RATE_LIMIT_ATTEMPTS_TEXT, AI_RATE_LIMIT_WINDOW_MS);
      if (!canProcess) {
        // Warn rather than info-log: every message skipped here gets zero AI content analysis at
        // all, which matters for visibility even though RaidDetectionService's separate,
        // non-AI-dependent burst/spam/join checks are unaffected and keep running regardless.
        logger.warn(`⏱️ AI moderation rate limit exceeded (${hasImage ? 'image' : 'text'} queue) for guild ${message.guild.id}, skipping message with no analysis`, {
          guildId: message.guild.id,
          userId: message.author.id,
        });
        return;
      }

      let recentMessages = [];
      if (aiConfig.enableContext) {
        recentMessages = await fetchRecentMessages(message.channel, message.id);
      }

      const currentMessage = formatMessageIdentity(message);
      const result = await analyzeContent(text, imageUrls, recentMessages, currentMessage);

      if (!result) {
        logger.debug('No analysis result returned');
        return;
      }

      if (result.classification === 'safe') {
        logger.debug('Message classified as safe');
        return;
      }

      if (result.confidence < aiConfig.confidenceThreshold) {
        logger.debug(`Confidence ${result.confidence} below threshold ${aiConfig.confidenceThreshold}`);
        return;
      }

      const action = getActionForClassification(aiConfig, result.classification);

      logger.warn(`🚨 AI MODERATION TRIGGERED: ${result.classification.toUpperCase()} (${Math.round(result.confidence * 100)}%)`, {
        guildId: message.guild.id,
        userId: message.author.id,
        username: message.author.username,
        messageId: message.id,
        action: action,
        reason: result.reason
      });

      // executeAction runs BEFORE sendAiAlert (no longer Promise.all'd) and its real outcome is
      // what gets reported — previously the alert always echoed the configured `action` string
      // regardless of whether it actually happened (a failed kick/ban/timeout from insufficient
      // permissions, or a quarantine silently skipped because the core Raid Shield toggle was
      // off, both rendered as a normal success). Staff now see the truth.
      const outcome = await executeAction(action, message, client, result, aiConfig);
      await sendAiAlert(message, client, result, outcome.action, aiConfig);
    } catch (error) {
      logger.error('❌ Error in AI moderation processing:', error);
    }
  }

  static async processMessageEdit(oldMessage, newMessage, client) {
    if (!oldMessage || !newMessage) return;

    if (oldMessage.content === newMessage.content &&
        oldMessage.attachments?.size === newMessage.attachments?.size) {
      return;
    }

    if (newMessage.author?.bot || !newMessage.guild) return;

    if (newMessage.webhookId) {
      logger.debug('Skipping edited webhook message');
      return;
    }

    logger.info('🔄 AI Moderation: Processing edited message', {
      guildId: newMessage.guild.id,
      userId: newMessage.author.id,
      oldLength: oldMessage.content?.length ?? 0,
      newLength: newMessage.content?.length ?? 0
    });

    await this.processMessage(newMessage, client);
  }

  static clearImageCache() {
    imageCache.clear();
    logger.debug('Image analysis cache cleared');
  }

  static getImageCacheStats() {
    return {
      size: imageCache.size,
      maxSize: IMAGE_CACHE_MAX_SIZE,
      ttlMs: IMAGE_CACHE_TTL_MS
    };
  }
}
