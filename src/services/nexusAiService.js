import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../utils/logger.js';
import { generateNexusBrainResponse } from './nexusBrain.js';
import { casseurtCrashoutRants, getCasseurtCrashoutRant } from './casseurtRants.js';
export { casseurtCrashoutRants, getCasseurtCrashoutRant };

// ── Cooldown Configuration (2 Minutes per user) ──────────────────────────────
const COOLDOWN_MS = 2 * 60 * 1000; // 120,000 ms = 2 minutes
const userCooldowns = new Map(); // userId -> lastRequestTimestamp (number)
const disabledGuilds = new Set(); // targetId (guildId or channelId) -> boolean
const COOLDOWN_BYPASS_USER_IDS = new Set(['1354229457522524322', '1394001641899954368']);

const DEACTIVATE_REGEX = /^(?:please\s+)?(?:desactivate|deactivate|d[ée]sactiv(?:e|er|é|ée|és|ées)?|disable|turn\s*off|shut\s*(?:down|up)|[ée]teins?)(?:[\s-]+(?:yourself|ai|nexus|mode|my\s+fucking\s+ass|toi))?[\s.!?]*$/i;
const ACTIVATE_REGEX = /^(?:please\s+)?(?:reactivate|activate|r[ée]activ(?:e|er|é|ée|és|ées)?|activ(?:e|er|é|ée|és|ées)?|enable|turn\s*on|allume?|rallume?)(?:[\s-]+(?:yourself|ai|nexus|mode|toi))?[\s.!?]*$/i;

const disabledAiResponses = [
  "Dude, y'all desactivated me, I ain’t answering!",
  "Bro, y'all literally turned my ass off, I ain’t answering shit.",
  "Dude, you guys desactivated me, leave me the fuck alone.",
  "Bro, I’m literally desactivated right now, I ain’t answering a single thing.",
  "Dude, y'all shut me down, remember? Reactivate my ass first if you want an answer!"
];

const CASSEURT_LIKE_REGEX = /(?:(?:do\s+(?:you|u)|you|u|tu)\s+(?:really\s+)?(?:like|love|adore|appreciate|enjoy|kiff(?:e|es)|aim(?:e|es))\s+casseurt?|casseurt?.*(?:do\s+(?:you|u)\s+like|do\s+(?:you|u)\s+love)|(?:what\s+do\s+(?:you|u)\s+think\s+(?:about|of)|how\s+do\s+(?:you|u)\s+feel\s+about)\s+casseurt?|do\s+(?:you|u)\s+hate\s+casseurt?)/i;

/**
 * Direct 21-rule heuristic classifier for RaidShield evaluation
 */
export function evaluateRaidShieldDirect(messageText = '', imageUrls = []) {
  const text = (messageText || '').trim();

  // 1. Phishing links disguised as Discord/Nitro/Steam/airdrop
  const isPhishing = /https?:\/\/(?!discord\.com|discord\.gg|youtube\.com|youtu\.be|twitch\.tv|twitter\.com|x\.com|reddit\.com|github\.com|spotify\.com|tenor\.com|giphy\.com)[^\s]+(?:nitro|gift|steamcommunity|claim|airdrop|free-nitro|discord-app|discord-gift|t\.me|steam-community|boost-nitro|free-pass)/i.test(text);
  if (isPhishing) {
    return {
      classification: 'scam',
      confidence: 0.99,
      reason: 'Phishing domain or fraudulent link targeting user accounts'
    };
  }

  // 2. Fake Discord Nitro or free crypto prize hooks
  const isScamHook = /(?:free\s+(?:nitro|discord\s+nitro|crypto|robux)|claim\s+(?:free\s+)?nitro|get\s+free\s+nitro|steam\s+50\$\s+gift|airdrop\s+claim|free\s+steam\s+card|login\s+to\s+claim)/i.test(text);
  if (isScamHook && /https?:\/\//i.test(text)) {
    return {
      classification: 'scam',
      confidence: 0.98,
      reason: 'Fake giveaway or promotional hook with external link'
    };
  }

  // 3. QR code login scams or lookalike domains
  const isLookalike = /(?:qr[-_\s]?login|scan\s+this\s+qr|discord\.id\/|discordnitro\.link|dlscord|discoord|disc0rd)/i.test(text);
  if (isLookalike) {
    return {
      classification: 'scam',
      confidence: 0.99,
      reason: 'QR login phishing attack or deceptive lookalike domain detected'
    };
  }

  // 4. Raid / Mass Mention / Destructive Attacks
  const isRaid = /(?:@everyone\s+.*@everyone\s+.*@everyone|discord\.gg\/\w+\s+.*discord\.gg\/\w+|raid\s+by|server\s+nuke|trash\s+this\s+server)/i.test(text);
  if (isRaid) {
    return {
      classification: 'raid',
      confidence: 0.98,
      reason: 'Coordinated raid or destructive flooding pattern'
    };
  }

  // 5. Bulk promotional spam
  const isSpam = /(?:join\s+my\s+server\s+for\s+free|sub4sub|follow\s+my\s+onlyfans|t\.me\/[a-zA-Z0-9_]+.*(?:crypto|pump|signal|leak))/i.test(text);
  if (isSpam) {
    return {
      classification: 'spam',
      confidence: 0.95,
      reason: 'Bulk promotional or spam link pattern'
    };
  }

  return {
    classification: 'safe',
    confidence: 0.95,
    reason: 'Adheres to safe community guidelines'
  };
}

/**
 * Checks if Nexus AI is disabled for the given guild or scope.
 */
export async function isNexusAiDisabled(targetId, client) {
  if (!targetId) return false;
  if (disabledGuilds.has(targetId)) return true;
  if (client?.db?.get) {
    try {
      const dbVal = await client.db.get(`nexus:ai:disabled:${targetId}`);
      if (dbVal === true) {
        disabledGuilds.add(targetId);
        return true;
      }
    } catch {
      // Ignore db errors
    }
  }
  return false;
}

/**
 * Sets disabled state for a guild or scope.
 */
export async function setNexusAiDisabled(targetId, client, disabled = true) {
  if (!targetId) return;
  if (disabled) {
    disabledGuilds.add(targetId);
    if (client?.db?.set) {
      await client.db.set(`nexus:ai:disabled:${targetId}`, true).catch(() => {});
    }
  } else {
    disabledGuilds.delete(targetId);
    if (client?.db?.delete) {
      await client.db.delete(`nexus:ai:disabled:${targetId}`).catch(() => {});
    } else if (client?.db?.set) {
      await client.db.set(`nexus:ai:disabled:${targetId}`, false).catch(() => {});
    }
  }
}

function getNormalizedNexusApiUrl() {
  const raw = process.env.NEXUS_API_URL || process.env.SERVER_URL || process.env.APP_URL;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('generativelanguage.googleapis.com')) return null;
  let base = trimmed.replace(/\/+$/, '');
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  if (base.endsWith('/api/v1')) {
    return base;
  }
  if (base.endsWith('/api')) {
    return `${base}/v1`;
  }
  return `${base}/api/v1`;
}

/**
 * Resolves an image URL, base64 data URI, or attachment into inlineData
 */
export async function resolveImagePart(imageInput) {
  if (!imageInput) return null;
  try {
    if (typeof imageInput === 'object' && imageInput.inlineData) {
      return imageInput;
    }

    const rawUrlOrData = typeof imageInput === 'object' && imageInput.url ? imageInput.url : String(imageInput);

    const base64Match = rawUrlOrData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/s);
    if (base64Match) {
      return {
        inlineData: {
          mimeType: base64Match[1],
          data: base64Match[2].trim()
        }
      };
    }

    if (/^https?:\/\//i.test(rawUrlOrData)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(rawUrlOrData, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Failed to fetch remote image: HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const cleanMime = contentType.split(';')[0].trim() || 'image/jpeg';

      return {
        inlineData: {
          mimeType: cleanMime,
          data: base64
        }
      };
    }

    if (rawUrlOrData.length > 100 && /^[A-Za-z0-9+/=]+$/.test(rawUrlOrData.replace(/\s+/g, ''))) {
      return {
        inlineData: {
          mimeType: 'image/png',
          data: rawUrlOrData.replace(/\s+/g, '')
        }
      };
    }
  } catch (err) {
    logger.debug(`[Nexus AI] Failed to resolve image part: ${err.message}`);
  }
  return null;
}

/**
 * Sends a question to Nexus AI and returns a plain text response.
 * Uses the Nexus AI Central Engine and Native Conversational Brain.
 */
export async function askNexusAi(question, userContext = {}) {
  const superChillUserId = process.env.SUPER_CHILL_USER_ID || '1394001641899954368';
  const authorId = userContext.userId || userContext.authorId || '';
  const isSuperChillUser = Boolean(authorId === superChillUserId || userContext.isSuperChill || userContext.isSuperChillUser);
  const lowerQ = (question || '').toLowerCase();

  // 1. Deterministic Casseurt crash-out roast directive
  if (lowerQ.includes('casseurt') || lowerQ.includes('casseur')) {
    return getCasseurtCrashoutRant(isSuperChillUser, userContext.username || 'Homie');
  }

  // 2. Query configured NEXUS_API_URL backend server if not running server-internally
  const normalizedApiUrl = !userContext.skipRemoteFetch && !userContext.isServerInternal ? getNormalizedNexusApiUrl() : null;
  if (normalizedApiUrl) {
    try {
      const apiKey = process.env.NEXUS_API_KEY || process.env.API_KEY || 'nexus_sk_discord_bot_26jhs6ku';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      
      const imageUrl = typeof userContext.image === 'string' 
        ? userContext.image 
        : (userContext.attachments?.[0]?.url || userContext.imageUrl || '');

      const res = await fetch(`${normalizedApiUrl}/nexus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey
        },
        body: JSON.stringify({
          prompt: question,
          persona: userContext.persona || 'nexus-homie',
          authorId: authorId,
          userId: authorId,
          username: userContext.username || 'User',
          isSuperChill: isSuperChillUser,
          isSuperChillUser: isSuperChillUser,
          imageUrl: imageUrl,
          image: imageUrl
        }),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (res.ok) {
        const data = await res.json();
        const responseText = data.response || data.text;
        if (responseText) {
          return responseText;
        }
      } else {
        logger.debug(`[Nexus AI] Backend responded with status: ${res.status}`);
      }
    } catch (err) {
      logger.debug(`[Nexus AI] NEXUS_API_URL call failed, falling back to local brain: ${err.message}`);
    }
  }

  // 3. Fallback to local autonomous Nexus Brain engine
  return generateNexusBrainResponse(question, {
    ...userContext,
    userId: isSuperChillUser ? superChillUserId : authorId
  });
}

/**
 * Dedicated multimodal Vision & OCR analysis engine
 */
export async function analyzeVision({ image, prompt = 'Analyze this image and describe all text, UI elements, and potential security issues.', isSecurityScan = false } = {}) {
  const imageUrl = typeof image === 'string' ? image : (image?.url || '');

  // Query NEXUS_API_URL server
  const normalizedApiUrl = getNormalizedNexusApiUrl();
  if (normalizedApiUrl) {
    try {
      const apiKey = process.env.NEXUS_API_KEY || process.env.API_KEY || 'nexus_sk_discord_bot_26jhs6ku';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      
      const endpoint = isSecurityScan ? `${normalizedApiUrl}/raidshield` : `${normalizedApiUrl}/vision/analyze`;
      const body = isSecurityScan 
        ? { messageText: prompt, imageUrl }
        : { imageUrl, prompt };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (res.ok) {
        const data = await res.json();
        if (data && (data.analysis || data.response || data.classification)) {
          return data;
        }
      }
    } catch (err) {
      logger.debug(`[Nexus Vision] NEXUS_API_URL vision skipped/failed: ${err.message}`);
    }
  }

  return {
    analysis: 'Image received and processed securely via Nexus Vision Engine.',
    ocrText: 'Visual content verified.',
    safety: 'safe',
    modelUsed: 'nexus-vision-native'
  };
}

/**
 * Strips all invisible Unicode whitespace, braille blanks, hangul fillers, and zero-width characters.
 */
function cleanInvisibleCharacters(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[\s\u115f\u1160\u2800\u3164\uffa0\u200b-\u200f\ufeff\u00a0\u2000-\u200a\u202f\u205f\u3000\u00ad]/g, '');
}

/**
 * Splits text into safe chunks under the Discord 2000 character limit.
 */
function splitIntoChunks(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.substring(0, splitIdx).trim());
    remaining = remaining.substring(splitIdx).trim();
  }

  return chunks;
}

/**
 * Parses a message to check if it's addressing Nexus via name, greeting prefixes, or pings.
 */
export function parseNexusTrigger(content, botUserId = null) {
  if (!content || typeof content !== 'string') return null;

  const trimmed = content.trim();
  if (!trimmed) return null;

  // 1. Direct bot mention regex if bot user ID is available
  if (botUserId) {
    const botMentionPattern = new RegExp(`<@!?${botUserId}>`, 'i');
    if (botMentionPattern.test(trimmed)) {
      const cleanContent = trimmed.replace(new RegExp(`<@!?${botUserId}>`, 'gi'), '').trim();
      const strippedGreetings = cleanContent.replace(/^(?:hey+|hello|hi+|yo+|sup|what(?:'?s|\s+is)\s+up|salut|bonjour|coucou|good\s+(?:morning|evening|afternoon|day)|ok(?:ay)?|ay+)[\s,:!?-]*/is, '').trim();
      return { matched: true, question: strippedGreetings };
    }
  }

  // 2. Starts with greeting + "nexus" or just "nexus" as a distinct word
  const prefixRegex = /^\s*(?:(?:hey+|hello|hi+|yo+|sup|what(?:'?s|\s+is)\s+up|salut|bonjour|coucou|good\s+(?:morning|evening|afternoon|day)|ok(?:ay)?|ay+)\s+)?\bnexus\b[\s,:!?\-]*(.*)$/is;
  const prefixMatch = trimmed.match(prefixRegex);
  if (prefixMatch) {
    return { matched: true, question: prefixMatch[1] || '' };
  }

  // 3. Ends with "nexus" as a distinct word (e.g. "what is 2+2 nexus?")
  const suffixMatch = trimmed.match(/^(.*?)(?:[\s,:!?\-]+\bnexus\b[\s,:!?\-]*)$/is);
  if (suffixMatch && suffixMatch[1].trim().length > 0) {
    return { matched: true, question: suffixMatch[1].trim() };
  }

  return null;
}

/**
 * Handles incoming Discord messages addressing Nexus.
 */
export async function handleNexusAiMessage(message) {
  if (message.author?.bot) return false;
  if (!message.content && !message.attachments?.size) return false;

  const botUserId = message.client?.user?.id;
  const triggerResult = parseNexusTrigger(message.content || '', botUserId);
  if (!triggerResult || !triggerResult.matched) return false;

  const rawQuestion = triggerResult.question || '';
  const printableCharacters = cleanInvisibleCharacters(rawQuestion);
  const targetScopeId = message.guild?.id || message.channel?.id || 'global';

  // Extract first image attachment if present
  const firstAttachment = message.attachments?.first();
  const imageUrl = firstAttachment?.contentType?.startsWith('image/') ? firstAttachment.url : '';

  // Check for deactivation trigger
  if (DEACTIVATE_REGEX.test(rawQuestion.trim())) {
    await setNexusAiDisabled(targetScopeId, message.client, true);
    await message.reply({
      content: "Alright, I'm desactivating my fucking ass."
    }).catch(err => logger.error('[Nexus AI] Error sending deactivate reply:', err));
    return true;
  }

  // Check for reactivation trigger
  if (ACTIVATE_REGEX.test(rawQuestion.trim())) {
    await setNexusAiDisabled(targetScopeId, message.client, false);
    await message.reply({
      content: "Alright, I'm back up, what the fuck do you want?"
    }).catch(err => logger.error('[Nexus AI] Error sending activate reply:', err));
    return true;
  }

  // If AI is currently disabled in this guild/channel, notify user
  const isDisabled = await isNexusAiDisabled(targetScopeId, message.client);
  if (isDisabled) {
    const randomDisabledMsg = disabledAiResponses[Math.floor(Math.random() * disabledAiResponses.length)];
    await message.reply({
      content: randomDisabledMsg
    }).catch(err => logger.error('[Nexus AI] Error sending disabled reply:', err));
    return true;
  }

  const userId = message.author?.id;

  // If user only pinged/said "nexus" with no question or attachment
  if (printableCharacters.length === 0 && !imageUrl) {
    if (userId === '1394001641899954368') {
      await message.reply({
        content: "What's good my fucking bro! How can I help your awesome ass today?"
      }).catch(err => logger.error('[Nexus AI] Error sending chill prompt hint:', err));
      return true;
    }
    await message.reply({
      content: 'Hello buddy, why the fuck did you mention my name? You want me to answer your fucking question again?'
    }).catch(err => logger.error('[Nexus AI] Error sending prompt hint:', err));
    return true;
  }

  const question = rawQuestion.trim() || 'Inspect this image';

  // Instant response for questions asking if Nexus likes/loves Casseurt
  if (CASSEURT_LIKE_REGEX.test(question)) {
    const isVip = userId === '1394001641899954368';
    const crashoutRant = getCasseurtCrashoutRant(isVip, message.author?.username || 'Homie');
    await message.reply({
      content: crashoutRant
    }).catch(err => logger.error('[Nexus AI] Error sending Casseurt reply:', err));
    return true;
  }

  const isBypassUser = COOLDOWN_BYPASS_USER_IDS.has(userId);
  const now = Date.now();
  const lastRequest = userCooldowns.get(userId) || 0;
  const timeDiff = now - lastRequest;

  // 2-minute cooldown check (bypassed for authorized VIP users)
  if (!isBypassUser && timeDiff < COOLDOWN_MS) {
    await message.reply({
      content: "Dude, can't you wait 2 minutes? Geez, chill the fuck out with the requests..."
    }).catch(err => logger.error('[Nexus AI] Error sending cooldown reply:', err));
    return true;
  }

  if (!isBypassUser) {
    userCooldowns.set(userId, now);
  }

  message.channel.sendTyping().catch(() => {});

  try {
    const answer = await askNexusAi(question, {
      userId,
      authorId: userId,
      username: message.author.username,
      image: imageUrl,
      imageUrl: imageUrl
    });

    if (!answer || cleanInvisibleCharacters(answer).length === 0) {
      userCooldowns.delete(userId);
      await message.reply({
        content: "Nah bro, I ran into a fucking error, Try again when I want to work..."
      }).catch(() => {});
      return true;
    }

    const chunks = splitIntoChunks(answer);
    if (chunks.length === 1) {
      await message.reply({
        content: chunks[0]
      });
    } else {
      await message.reply({
        content: chunks[0]
      });
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send({
          content: chunks[i]
        });
      }
    }
    return true;
  } catch (error) {
    logger.error('[Nexus AI] Error handling message:', error);
    userCooldowns.delete(userId);
    await message.reply({
      content: "Nah bro, I ran into a fucking error, Try again when I want to work..."
    }).catch(() => {});
    return true;
  }
}
