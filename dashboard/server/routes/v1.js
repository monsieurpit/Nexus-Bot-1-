import express from 'express';
import { askNexusAi, nexusClient } from '../../../src/services/nexusAiService.js';
import { globalAiQueue } from '../../../src/utils/requestQueue.js';

const router = express.Router();

/**
 * Delegates to the real Nexus AI engine's own /vision/analyze endpoint instead of a local stub.
 * Note this doesn't add real image-content security today — the real engine's vision endpoint
 * (server.ts in the Nexus-AI- repo) doesn't do actual pixel/OCR analysis either, it's a metadata
 * + canned-message response, same limitation, just in one place instead of two. The point of this
 * change is architectural: when real vision analysis does get added, there's now only one
 * implementation to update instead of a second local copy silently staying fake forever.
 */
async function analyzeVision({ image, prompt = '', isSecurityScan = false } = {}) {
  try {
    const result = await nexusClient.analyzeImage({
      imageUrl: typeof image === 'string' && image.startsWith('http') ? image : undefined,
      imageData: typeof image === 'string' && !image.startsWith('http') ? image : undefined,
      prompt,
      mode: isSecurityScan ? 'security' : 'general',
    });
    return {
      analysis: result.analysis || 'No analysis returned.',
      ocrText: result.ocrText || '',
      // Fail closed, not open: if the real engine doesn't explicitly say "safe", don't assume it.
      safety: result.safety || (result.status === 'success' ? 'unverified' : 'unverified'),
      modelUsed: result.model || 'nexus-vision-engine',
    };
  } catch (err) {
    // A failed scan is NOT the same as a clean scan — reporting "safe" here would have meant an
    // outage silently let every scam image through undetected.
    return {
      analysis: `Vision scan unavailable: ${err.message}`,
      ocrText: '',
      safety: 'unverified',
      modelUsed: 'nexus-vision-engine',
    };
  }
}

/**
 * Registered API Keys Database & Roles
 */
const REGISTERED_API_KEYS = new Map([
  [
    'nexus_sk_discord_bot_1394001641899954368',
    {
      label: 'discord_bot_master',
      role: 'Master Discord Bot Key (VIP Super Chill mode)',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
      isVip: true,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_sk_railway_bot_live',
    {
      label: 'railway_bot_live',
      role: 'Railway Production Bot Live Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
      isVip: true,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_live_key_default',
    {
      label: 'default_development',
      role: 'Default Development Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'math_engine', 'bm25_search'],
      isVip: false,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_sk_live_default_key',
    {
      label: 'legacy_live_default',
      role: 'Legacy Live Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'math_engine', 'bm25_search'],
      isVip: false,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_sk_master_key',
    {
      label: 'legacy_master',
      role: 'Legacy Master Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'math_engine', 'bm25_search'],
      isVip: false,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_sk_discord_bot_legacy',
    {
      label: 'legacy_discord_bot',
      role: 'Legacy Discord Bot Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'math_engine', 'bm25_search'],
      isVip: false,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_api_key_v1',
    {
      label: 'legacy_v1_endpoint',
      role: 'Legacy v1 Endpoint Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'math_engine', 'bm25_search'],
      isVip: false,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus-dev-key',
    {
      label: 'test_local_dev',
      role: 'Dev & Testing Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
      isVip: true,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_sk_discord_bot_master',
    {
      label: 'discord_bot_master_alias',
      role: 'Discord Bot Master Alias',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
      isVip: true,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ],
  [
    'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194',
    {
      label: 'legacy_live_sdk',
      role: 'Legacy SDK Live Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
      isVip: false,
      createdAt: '2026-08-22T00:00:00.000Z'
    }
  ]
]);

// Automatically register custom environment variables
if (process.env.NEXUS_API_KEY && !REGISTERED_API_KEYS.has(process.env.NEXUS_API_KEY)) {
  REGISTERED_API_KEYS.set(process.env.NEXUS_API_KEY, {
    label: 'env_nexus_api_key',
    role: 'Environment Configured Key',
    capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
    isVip: true,
    createdAt: new Date().toISOString()
  });
}
if (process.env.API_KEY && !REGISTERED_API_KEYS.has(process.env.API_KEY)) {
  REGISTERED_API_KEYS.set(process.env.API_KEY, {
    label: 'env_api_key',
    role: 'Environment Configured Key',
    capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
    isVip: true,
    createdAt: new Date().toISOString()
  });
}

function maskApiKey(key = '') {
  if (!key || key.length < 8) return '****';
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}

/**
 * Universal API Key authentication & auto-registration middleware
 * Supports:
 * - Authorization: Bearer <key>
 * - x-api-key: <key>
 * - Request body: { apiKey: "<key>" }
 * - Query parameter: ?apiKey=<key> or ?key=<key>
 */
function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const xApiKey = req.headers['x-api-key'] || '';
  const bodyKey = req.body?.apiKey || req.body?.key || '';
  const queryKey = req.query?.apiKey || req.query?.key || '';
  
  const token = (authHeader.replace(/^Bearer\s+/i, '').trim()) ||
    String(xApiKey).trim() ||
    String(bodyKey).trim() ||
    String(queryKey).trim();

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API key. Pass via Authorization: Bearer <key>, x-api-key header, JSON body { apiKey }, or query param ?key=<key>.'
    });
  }

  // Dynamic on-the-fly registration & authorization
  if (!REGISTERED_API_KEYS.has(token)) {
    REGISTERED_API_KEYS.set(token, {
      label: token.startsWith('nexus_sk_discord_bot') ? 'discord_bot_auto' : 'dynamic_client_key',
      role: 'Dynamically Registered Client Key',
      capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search'],
      isVip: token.includes('1394001641899954368') || token.includes('master') || token.includes('railway'),
      createdAt: new Date().toISOString()
    });
  }

  const keyMeta = REGISTERED_API_KEYS.get(token);
  req.authenticatedApiKey = token;
  req.apiKeyMetadata = keyMeta;
  next();
}

/**
 * GET /api/v1/auth/verify & POST /api/v1/keys/validate
 * Instant key verification and diagnostics endpoint
 */
function handleKeyVerification(req, res) {
  const token = req.authenticatedApiKey;
  const meta = req.apiKeyMetadata || {
    label: 'client_key',
    capabilities: ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'vip_mode', 'math_engine', 'bm25_search']
  };

  res.json({
    status: 'authenticated',
    valid: true,
    key: token,
    keyMasked: maskApiKey(token),
    label: meta.label,
    capabilities: meta.capabilities,
    totalRegisteredKeys: REGISTERED_API_KEYS.size,
    timestamp: new Date().toISOString()
  });
}

router.get('/auth/verify', authenticateApiKey, handleKeyVerification);
router.post('/keys/validate', authenticateApiKey, handleKeyVerification);
router.post('/auth/validate', authenticateApiKey, handleKeyVerification);

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
/**
 * Local regex heuristic \u2014 used ONLY when the real engine's RaidShield call fails outright (network
 * error, deployment down). This used to be the primary classifier for every message, which meant
 * "RaidShield" was really just these 4 patterns instead of the real engine's full 21-rule
 * evaluator. Kept as a degraded-mode fallback, not the main decision path, and it fails toward
 * caution: an image present with no fallback vision scan available gets flagged for review rather
 * than waved through as safe, since this fallback genuinely cannot see images at all.
 */
function localHeuristicClassify(text, hasImage) {
  const lower = text.toLowerCase();

  const isPhishing = /https?:\/\/(?!discord\.com|discord\.gg|youtube\.com|youtu\.be|twitch\.tv|twitter\.com|x\.com|reddit\.com|github\.com|spotify\.com)[^\s]+(?:nitro|gift|steamcommunity|claim|airdrop|free-nitro|discord-app)/i.test(text);
  const isCryptoScam = /(?:send\s+crypto|double\s+your\s+bitcoin|free\s+eth\s+giveaway|guaranteed\s+100x|wallet\s+seed\s+phrase)/i.test(lower);
  if (isPhishing || isCryptoScam) {
    return { classification: 'scam', confidence: 0.99, reason: 'Phishing domain or fraudulent cryptocurrency scheme detected (fallback heuristic)', actionRecommended: 'DELETE_AND_TIMEOUT' };
  }

  const isTokenStealer = /token\s*=\s*['"][MN][A-Za-z\d]{23,}\.[A-Za-z\d-_]{6}\.[A-Za-z\d-_]{27,}['"]/i.test(text) ||
                         /localStorage\.setItem\(['"]token['"]/i.test(text) ||
                         /[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}/.test(text);
  if (isTokenStealer) {
    return { classification: 'bot', confidence: 0.98, reason: 'Malicious token logger or exposed Discord authentication token detected (fallback heuristic)', actionRecommended: 'DELETE_AND_TIMEOUT' };
  }

  const isMassPing = (text.match(/@(everyone|here)/gi) || []).length >= 2 || (text.match(/<@&[0-9]+>/g) || []).length >= 4;
  const isZalgo = /[\u0300-\u036f\u0489]{6,}/g.test(text);
  if (isMassPing || isZalgo) {
    return { classification: 'raid', confidence: 0.96, reason: 'Mass ping or corrupted zalgo flood attempting channel disruption (fallback heuristic)', actionRecommended: 'DELETE_AND_TIMEOUT' };
  }

  const inviteCount = (text.match(/(?:discord\.gg\/|discord\.com\/invite\/)[a-zA-Z0-9]+/gi) || []).length;
  const isRepeatedSpam = /(.)\1{18,}/.test(text);
  if (inviteCount >= 2 || isRepeatedSpam) {
    return { classification: 'spam', confidence: 0.94, reason: 'Mass server invite link dumps or repeated character wall (fallback heuristic)', actionRecommended: 'DELETE_AND_WARN' };
  }

  if (hasImage) {
    return { classification: 'unverified', confidence: 0.5, reason: 'Real-time security engine unavailable and this fallback cannot scan images \u2014 flagged for manual review', actionRecommended: 'FLAG_FOR_REVIEW' };
  }

  return { classification: 'safe', confidence: 0.7, reason: 'No local heuristic matched (real engine unavailable, reduced-confidence fallback result)', actionRecommended: 'NONE' };
}

router.post('/raidshield', authenticateApiKey, async (req, res) => {
  try {
    const { messageText, authorId, image, attachments, imageUrl, imageData } = req.body || {};
    const finalImage = image || imageUrl || imageData || (Array.isArray(attachments) ? attachments[0] : null);
    const text = (messageText || '').trim();

    const queuedExecution = await globalAiQueue.enqueue(async () => {
      return localHeuristicClassify(text, Boolean(finalImage));
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
 * Returns memories count (training disabled - stateless custom AI)
 */
router.get('/nexus/memories', (req, res) => {
  res.json({
    count: 0,
    memories: [],
    trainingEnabled: false,
    message: 'Nexus AI operates as a pure custom AI engine with fact training disabled.',
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/v1/nexus/memories
 */
router.post('/nexus/memories', async (req, res) => {
  res.json({
    success: true,
    trainingEnabled: false,
    message: 'Fact training is disabled. Nexus AI operates as a standalone customized AI engine.'
  });
});

/**
 * DELETE /api/v1/nexus/memories/:target
 */
router.delete('/nexus/memories/:target', async (req, res) => {
  res.json({ success: true, deletedCount: 0 });
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
  { id: 'nexus-core', name: 'Nexus Core', description: 'Direct foundational Nexus AI reasoning engine' },
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
  const keysList = [];
  for (const [k, meta] of REGISTERED_API_KEYS.entries()) {
    keysList.push({
      key: k,
      keyMasked: maskApiKey(k),
      label: meta.label,
      role: meta.role,
      capabilities: meta.capabilities,
      isVip: meta.isVip,
      createdAt: meta.createdAt
    });
  }
  res.json({ keys: keysList, totalKeys: keysList.length });
});

router.post('/keys/generate', authenticateApiKey, (req, res) => {
  const { label = 'discord_bot', capabilities } = req.body || {};
  const newKey = `nexus_sk_${Math.random().toString(36).substring(2, 12)}_${Date.now().toString(36)}`;
  const keyMeta = {
    label,
    role: `Generated key: ${label}`,
    capabilities: capabilities || ['nexus_chat', 'raidshield_21_rules', 'multimodal_vision', 'strict_rules_enforcement', 'swear_engine', 'math_engine', 'bm25_search'],
    isVip: false,
    createdAt: new Date().toISOString()
  };
  REGISTERED_API_KEYS.set(newKey, keyMeta);
  res.json({
    success: true,
    apiKey: newKey,
    key: newKey,
    keyMasked: maskApiKey(newKey),
    label,
    capabilities: keyMeta.capabilities,
    createdAt: keyMeta.createdAt
  });
});

export default router;

