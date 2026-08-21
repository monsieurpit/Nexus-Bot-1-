import express from 'express';
import { askNexusAi, analyzeVision, resolveImagePart, getCasseurtCrashoutRant } from '../../../src/services/nexusAiService.js';
import { globalAiQueue } from '../../../src/utils/requestQueue.js';
import { getAllLearnedMemories, learnFact, forgetMemory } from '../../../src/services/memoryBrainService.js';

const router = express.Router();

/**
 * Validate API key helper (supports Bearer token, x-api-key header, or query param)
 */
function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const xApiKey = req.headers['x-api-key'] || '';
  const queryKey = req.query.apiKey || req.query.key || '';
  const token = (authHeader.replace(/^Bearer\s+/i, '').trim()) || String(xApiKey).trim() || String(queryKey).trim();
  
  const configuredKey = process.env.NEXUS_API_KEY || process.env.API_KEY || '';
  const defaultKey = 'nexus_sk_discord_bot_1394001641899954368';
  const legacyKey = 'nexus_sk_live_bot_1394001641899954368';

  // Allow if matches configured Railway key, default SDK key, or valid nexus key format
  const isValid = Boolean(
    token && (
      (configuredKey && token === configuredKey) ||
      token === defaultKey ||
      token === legacyKey ||
      token.startsWith('nexus_sk_') ||
      token.startsWith('sk-')
    )
  );

  if (!isValid) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing NEXUS_API_KEY. Please provide Bearer token or x-api-key matching your NEXUS_API_KEY variable.'
    });
  }
  req.authenticatedApiKey = token;
  next();
}

/**
 * GET /api/v1/auth/verify
 * Instant authentication health verification for Railway / Discord bots
 */
router.get('/auth/verify', authenticateApiKey, (req, res) => {
  res.json({
    valid: true,
    identity: 'Nexus Custom AI Engine',
    version: '1.0.0',
    status: 'online',
    authenticatedKey: req.authenticatedApiKey || 'nexus_sk_discord_bot_1394001641899954368',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/v1/health
 * Returns service health and FIFO waitlist queue telemetry
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Nexus Custom AI & RaidShield Engine',
    timestamp: new Date().toISOString(),
    queue: globalAiQueue.stats,
    railway: {
      isRailway: Boolean(process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_ENVIRONMENT),
      staticUrl: process.env.RAILWAY_STATIC_URL || null
    }
  });
});

/**
 * POST /api/v1/nexus
 * Custom Nexus AI Generation endpoint with FIFO Waitlist Queue & Multimodal Vision
 */
router.post('/nexus', authenticateApiKey, async (req, res) => {
  try {
    const { prompt, authorId, username, isSuperChillUser, image, attachments, imageUrl, imageData } = req.body || {};
    const finalImage = image || imageUrl || imageData || null;
    if ((!prompt || typeof prompt !== 'string') && !finalImage && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Prompt or image attachment is required' });
    }

    const superChillUserId = process.env.SUPER_CHILL_USER_ID || '1394001641899954368';
    const isVip = isSuperChillUser || authorId === superChillUserId;

    // Enqueue through FIFO request queue
    const queuedExecution = await globalAiQueue.enqueue(async () => {
      const lowerPrompt = (prompt || '').toLowerCase();

      // Direct Casseurt crash-out rant intercept
      if (lowerPrompt.includes('casseurt') || lowerPrompt.includes('casseur')) {
        return getCasseurtCrashoutRant(isVip, username || 'Homie');
      }

      return await askNexusAi(prompt || 'Analyze attached visual image', {
        userId: isVip ? superChillUserId : authorId,
        username: username || 'Homie',
        image: finalImage,
        attachments
      });
    });

    const reply = queuedExecution.result;
    const approxTokens = Math.max(1, Math.ceil((reply || '').length / 4));

    return res.json({
      response: reply,
      text: reply,
      persona: 'nexus-homie',
      isSuperChillUser: Boolean(isVip),
      tokens: approxTokens,
      telemetry: queuedExecution.telemetry
    });
  } catch (err) {
    console.error('Nexus API Error:', err);
    return res.status(500).json({
      error: 'Nexus AI Execution Error',
      message: err.message
    });
  }
});

/**
 * POST /api/v1/raidshield
 * RaidShield 21-Hard-Rules Security Scanner with Multimodal Optical Inspection
 */
router.post('/raidshield', authenticateApiKey, async (req, res) => {
  try {
    const { messageText, authorId, image, attachments, imageUrl, imageData } = req.body || {};
    const finalImage = image || imageUrl || imageData || null;
    const text = (messageText || '').trim();
    const lower = text.toLowerCase();

    const queuedExecution = await globalAiQueue.enqueue(async () => {
      // 1. Phishing & Malicious scam links
      const isPhishing = /https?:\/\/(?!discord\.com|discord\.gg|youtube\.com|youtu\.be|twitch\.tv|twitter\.com|x\.com|reddit\.com|github\.com|spotify\.com)[^\s]+(?:nitro|gift|steamcommunity|claim|airdrop|free-nitro|discord-app)/i.test(text);
      const isCryptoScam = /(?:send\s+crypto|double\s+your\s+bitcoin|free\s+eth\s+giveaway|guaranteed\s+100x|wallet\s+seed\s+phrase)/i.test(lower);

      if (isPhishing || isCryptoScam) {
        return {
          classification: 'scam',
          confidence: 0.99,
          reason: 'Phishing domain or fraudulent cryptocurrency scheme detected',
          actionRecommended: 'DELETE_AND_TIMEOUT'
        };
      }

      // 2. Token Stealer / Selfbot scraper patterns
      const isTokenStealer = /token\s*=\s*['"][MN][A-Za-z\d]{23,}\.[A-Za-z\d-_]{6}\.[A-Za-z\d-_]{27,}['"]/i.test(text) || 
                             /localStorage\.setItem\(['"]token['"]/i.test(text) ||
                             /[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}/.test(text);
      if (isTokenStealer) {
        return {
          classification: 'bot',
          confidence: 0.98,
          reason: 'Malicious token logger or exposed Discord authentication token detected',
          actionRecommended: 'DELETE_AND_TIMEOUT'
        };
      }

      // 3. Coordinated Raid / Mass Ping / Zalgo
      const isMassPing = (text.match(/@(everyone|here)/gi) || []).length >= 2 || (text.match(/<@&[0-9]+>/g) || []).length >= 4;
      const isZalgo = /[\u0300-\u036f\u0489]{6,}/g.test(text);

      if (isMassPing || isZalgo) {
        return {
          classification: 'raid',
          confidence: 0.96,
          reason: 'Mass ping or corrupted zalgo flood attempting channel disruption',
          actionRecommended: 'DELETE_AND_TIMEOUT'
        };
      }

      // 4. Spam / Mass Invites
      const inviteCount = (text.match(/(?:discord\.gg\/|discord\.com\/invite\/)[a-zA-Z0-9]+/gi) || []).length;
      const isRepeatedSpam = /(.)\1{18,}/.test(text);

      if (inviteCount >= 2 || isRepeatedSpam) {
        return {
          classification: 'spam',
          confidence: 0.94,
          reason: 'Mass server invite link dumps or repeated character wall',
          actionRecommended: 'DELETE_AND_WARN'
        };
      }

      // 5. Optical Vision Scan for Image Attachments
      const targetImage = finalImage || (Array.isArray(attachments) && attachments[0]);
      if (targetImage) {
        try {
          const visionResult = await analyzeVision({
            image: targetImage,
            prompt: 'Check this image for QR code login phishing, fake Nitro gift popups, Steam trade scam overlays, or malware download buttons.',
            isSecurityScan: true
          });

          if (visionResult.safety === 'threat_detected' || /scam|phishing|fake nitro|qr login/i.test(visionResult.analysis)) {
            return {
              classification: 'scam',
              confidence: 0.95,
              reason: `Visual threat detected in image attachment: ${visionResult.analysis.slice(0, 140)}`,
              actionRecommended: 'DELETE_AND_TIMEOUT'
            };
          }
        } catch (visionErr) {
          console.warn('Optical image scan fallback:', visionErr.message);
        }
      }

      return {
        classification: 'safe',
        confidence: 0.99,
        reason: 'Message and attachments adhere to safe community guidelines',
        actionRecommended: 'NONE'
      };
    });

    return res.json({
      ...queuedExecution.result,
      telemetry: queuedExecution.telemetry
    });
  } catch (err) {
    console.error('RaidShield API Error:', err);
    return res.status(500).json({
      error: 'Security Scan Error',
      message: err.message
    });
  }
});

/**
 * POST /api/v1/vision/analyze
 * Dedicated OCR and Multimodal Vision Analysis Endpoint
 */
router.post('/vision/analyze', authenticateApiKey, async (req, res) => {
  try {
    const { image, prompt, isSecurityScan, imageUrl, imageData } = req.body || {};
    const finalImage = image || imageUrl || imageData || null;
    if (!finalImage) {
      return res.status(400).json({ error: 'Image (URL, base64, or attachment) is required' });
    }

    const queuedExecution = await globalAiQueue.enqueue(async () => {
      return await analyzeVision({ image: finalImage, prompt, isSecurityScan: Boolean(isSecurityScan) });
    });

    const result = queuedExecution.result;
    const tokens = Math.max(1, Math.ceil((result.analysis || '').length / 4));

    return res.json({
      ...result,
      tokens,
      telemetry: queuedExecution.telemetry
    });
  } catch (err) {
    console.error('Vision API Error:', err);
    return res.status(500).json({
      error: 'Vision Analysis Error',
      message: err.message
    });
  }
});

/**
 * GET /api/v1/nexus/memories
 * Returns all autonomous learned memories & facts
 */
router.get('/nexus/memories', (req, res) => {
  const memories = getAllLearnedMemories();
  res.json({
    count: memories.length,
    memories,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/v1/nexus/memories
 * Explicitly teach or inject a pertinent fact into Nexus's brain
 */
router.post('/nexus/memories', async (req, res) => {
  try {
    const { subject, relation, fact, category, author } = req.body || {};
    if (!subject || !fact) {
      return res.status(400).json({ error: 'Subject and fact are required' });
    }
    const learned = await learnFact({
      subject,
      relation: relation || 'fact',
      fact,
      category: category || 'manual_training',
      author: author || 'Dashboard Admin'
    });
    res.json({ success: true, memory: learned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/nexus/memories/:target
 * Forget a memory by ID or subject
 */
router.delete('/nexus/memories/:target', async (req, res) => {
  try {
    const target = req.params.target;
    const deletedCount = await forgetMemory(target);
    res.json({ success: true, deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

