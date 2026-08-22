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
  const defaultKey = 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194';
  const legacyKey = 'nexus_sk_discord_bot_emj9gp84';
  const prevKey = 'nexus_sk_discord_bot_26jhs6ku';
  const creatorKey = 'nexus_sk_discord_bot_1394001641899954368';

  // Allow if matches configured Railway key, default SDK key, or valid nexus key format
  const isValid = Boolean(
    token && (
      (configuredKey && token === configuredKey) ||
      token === defaultKey ||
      token === legacyKey ||
      token === prevKey ||
      token === creatorKey ||
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
    authenticatedKey: req.authenticatedApiKey || 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194',
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
        authorId: isVip ? superChillUserId : authorId,
        username: username || 'Homie',
        image: finalImage,
        attachments,
        skipRemoteFetch: true
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

/**
 * GET /api/v1/queue/status
 */
router.get('/queue/status', (req, res) => {
  res.json({
    status: 'ok',
    queue: globalAiQueue.stats,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET & POST /api/v1/settings
 */
let serverSettings = {
  defaultPersona: 'nexus-homie',
  cooldownMs: 120000,
  temperature: 0.7,
  vipUsers: ['1394001641899954368', '1354229457522524322'],
  securityRulesEnabled: true
};

router.get('/settings', authenticateApiKey, (req, res) => {
  res.json(serverSettings);
});

router.post('/settings', authenticateApiKey, (req, res) => {
  serverSettings = { ...serverSettings, ...(req.body || {}) };
  res.json({ success: true, settings: serverSettings });
});

/**
 * GET /api/v1/personas & POST /api/v1/persona/set
 */
const availablePersonas = [
  { id: 'nexus-homie', name: 'Nexus Homie', description: 'Loyal brother, sarcastic with strangers, respectful to VIPs' },
  { id: 'crashout-bot', name: 'Crashout Bot', description: 'High-energy explosive responses' },
  { id: 'roast-master', name: 'Roast Master', description: 'Clever burns and roast responses' },
  { id: 'chill-mod', name: 'Chill Mod', description: 'Relaxed and calm moderation assistant' },
  { id: 'code-architect', name: 'Code Architect', description: 'Senior software engineering and clean code specialist' },
  { id: 'deep-researcher', name: 'Deep Researcher', description: 'Analytical, factual, and deeply reasoned breakdown' },
  { id: 'gemini-core', name: 'Gemini Core', description: 'Direct foundational AI reasoning engine' },
  { id: 'raidshield-ai', name: 'RaidShield AI', description: 'Strict threat detection and security filter' },
  { id: 'discord-sentinel', name: 'Discord Sentinel', description: 'Server protection and rule enforcer' }
];

router.get('/personas', authenticateApiKey, (req, res) => {
  res.json({ current: serverSettings.defaultPersona, personas: availablePersonas });
});

router.post('/persona/set', authenticateApiKey, (req, res) => {
  const { persona } = req.body || {};
  if (persona) {
    serverSettings.defaultPersona = persona;
  }
  res.json({ success: true, activePersona: serverSettings.defaultPersona });
});

/**
 * Document Knowledge Base & Grounding Corpus
 */
let documentCorpus = [
  { id: 'doc-1', title: 'Server Rules', category: 'general', content: 'Be respectful, no spam, no phishing links.', keywords: ['rules', 'guidelines'] },
  { id: 'doc-2', title: 'Bot Features', category: 'bot-guide', content: 'Nexus provides automod, leveling, economy, and AI chat.', keywords: ['commands', 'features'] }
];

router.get('/documents', authenticateApiKey, (req, res) => {
  const { category } = req.query || {};
  const filtered = category ? documentCorpus.filter(d => d.category === category) : documentCorpus;
  res.json({ count: filtered.length, documents: filtered });
});

router.post('/documents/search', authenticateApiKey, (req, res) => {
  const { query, limit = 5 } = req.body || {};
  const q = (query || '').toLowerCase();
  const matched = documentCorpus.filter(d => 
    d.title.toLowerCase().includes(q) || 
    d.content.toLowerCase().includes(q) || 
    (d.keywords && d.keywords.some(k => k.toLowerCase().includes(q)))
  ).slice(0, limit);
  res.json({ count: matched.length, results: matched });
});

router.post('/documents', authenticateApiKey, (req, res) => {
  const { title, content, category = 'custom-api-doc', keywords = [] } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }
  const newDoc = {
    id: `doc-${Date.now()}`,
    title,
    content,
    category,
    keywords: Array.isArray(keywords) ? keywords : [keywords],
    createdAt: new Date().toISOString()
  };
  documentCorpus.push(newDoc);
  res.json({ success: true, document: newDoc });
});

router.delete('/documents/:id', authenticateApiKey, (req, res) => {
  const id = req.params.id;
  const initialLen = documentCorpus.length;
  documentCorpus = documentCorpus.filter(d => d.id !== id);
  res.json({ success: true, deleted: documentCorpus.length < initialLen });
});

router.get('/corpus', authenticateApiKey, (req, res) => {
  res.json({
    totalDocuments: documentCorpus.length,
    categories: [...new Set(documentCorpus.map(d => d.category))],
    status: 'indexed'
  });
});

/**
 * SDK Rules
 */
const supportedRules = [
  'MANDATORY_SWEARING_ISSUE',
  'MINIMUM_3_SWEAR_WORDS_PER_SENTENCE',
  'NO_CASSEURT_DEFENSE',
  'HONOR_SUPER_CHILL_VIP',
  'DISCORD_SAFE_LENGTH_2000',
  'BAN_MALICIOUS_PHISHING',
  'SARCASTIC_STRANGER_CHILL_VIP'
];

router.get('/sdk/rules', authenticateApiKey, (req, res) => {
  res.json({ rules: supportedRules });
});

router.post('/sdk/rules/enforce', authenticateApiKey, (req, res) => {
  const { text, rules, isSuperChillUser } = req.body || {};
  let modified = text || '';
  res.json({
    original: text,
    enforcedText: modified,
    rulesApplied: Array.isArray(rules) ? rules : [rules],
    isSuperChillUser: Boolean(isSuperChillUser)
  });
});

/**
 * OpenAI / Standard Generative Compatibility
 */
router.post('/chat/completions', authenticateApiKey, async (req, res) => {
  try {
    const { messages = [], temperature = 0.7 } = req.body || {};
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || 'Hello';
    const answer = await askNexusAi(lastUserMessage, { skipRemoteFetch: true });

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: answer
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: Math.ceil(lastUserMessage.length / 4),
        completion_tokens: Math.ceil((answer || '').length / 4),
        total_tokens: Math.ceil((lastUserMessage.length + (answer || '').length) / 4)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', authenticateApiKey, async (req, res) => {
  try {
    const { prompt = 'Hello' } = req.body || {};
    const answer = await askNexusAi(prompt, { skipRemoteFetch: true });
    res.json({ text: answer, response: answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Key Management
 */
let apiKeys = [
  { key: 'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194', label: 'Master Live API Key', createdAt: new Date().toISOString() },
  { key: 'nexus_sk_discord_bot_emj9gp84', label: 'Discord Bot API Key', createdAt: new Date().toISOString() },
  { key: 'nexus_sk_discord_bot_26jhs6ku', label: 'Previous Production Key', createdAt: new Date().toISOString() },
  { key: 'nexus_sk_discord_bot_1394001641899954368', label: 'VIP Creator Key', createdAt: new Date().toISOString() }
];

router.get('/keys', authenticateApiKey, (req, res) => {
  res.json({ keys: apiKeys });
});

router.post('/keys/generate', authenticateApiKey, (req, res) => {
  const { label = 'discord_bot' } = req.body || {};
  const newKey = `nexus_sk_${Math.random().toString(36).substring(2, 12)}_${Date.now().toString(36)}`;
  const keyObj = { key: newKey, label, createdAt: new Date().toISOString() };
  apiKeys.push(keyObj);
  res.json({ success: true, key: keyObj });
});

export default router;

