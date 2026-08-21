/**
 * Nexus Autonomous Memory & Training Engine
 * Continuously analyzes Discord messages to extract pertinent facts, server lore,
 * entity relationships, and user preferences into persistent knowledge.
 */

import { logger } from '../utils/logger.js';
import database from './database.js';
import { detectSarcasm } from './sarcasmDetector.js';

const GLOBAL_KNOWLEDGE_KEY = 'nexus:brain:learned_knowledge';
const GUILD_KNOWLEDGE_PREFIX = 'nexus:brain:guild_knowledge:';

// In-memory memory cache for lightning-fast lookups
let inMemoryKnowledge = [];
let isInitialized = false;

/**
 * Initialize knowledge from persistent database
 */
export async function initializeMemoryEngine() {
  if (isInitialized) return;
  try {
    const saved = await database.get(GLOBAL_KNOWLEDGE_KEY, []);
    if (Array.isArray(saved)) {
      inMemoryKnowledge = saved;
    } else {
      inMemoryKnowledge = [];
    }
    isInitialized = true;
    logger.info(`[Nexus Memory] Initialized with ${inMemoryKnowledge.length} learned memories.`);
  } catch (err) {
    logger.warn('[Nexus Memory] Failed to load saved memories, starting fresh:', err.message);
    inMemoryKnowledge = [];
    isInitialized = true;
  }
}

// Auto-initialize on import
initializeMemoryEngine().catch(() => {});

/**
 * Save memory store to persistent database
 */
async function persistKnowledge() {
  try {
    // Keep top 1000 most relevant & recent memories
    if (inMemoryKnowledge.length > 1000) {
      inMemoryKnowledge = inMemoryKnowledge.slice(-1000);
    }
    await database.set(GLOBAL_KNOWLEDGE_KEY, inMemoryKnowledge);
  } catch (err) {
    logger.debug('[Nexus Memory] Error persisting knowledge:', err.message);
  }
}

/**
 * Teaches or updates a pertinent fact in Nexus's memory
 */
export async function learnFact({
  subject,
  relation = 'fact',
  fact,
  category = 'general',
  author = 'System',
  authorId = null,
  guildId = null,
  confidence = 0.85
}) {
  if (!subject || !fact || fact.length < 5) return null;

  await initializeMemoryEngine();

  const cleanSubject = subject.trim();
  const cleanFact = fact.trim();
  const lowerSubj = cleanSubject.toLowerCase();

  // Check if we already have an existing memory for this subject and relation
  const existingIdx = inMemoryKnowledge.findIndex(
    m => m.subject.toLowerCase() === lowerSubj && m.relation === relation
  );

  const memoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    subject: cleanSubject,
    relation,
    fact: cleanFact,
    category,
    author,
    authorId,
    guildId,
    confidence: Math.min(1.0, confidence),
    learnedAt: new Date().toISOString(),
    lastReinforced: new Date().toISOString(),
    timesReinforced: existingIdx !== -1 ? (inMemoryKnowledge[existingIdx].timesReinforced || 1) + 1 : 1
  };

  if (existingIdx !== -1) {
    inMemoryKnowledge[existingIdx] = {
      ...inMemoryKnowledge[existingIdx],
      fact: cleanFact,
      lastReinforced: memoryEntry.lastReinforced,
      timesReinforced: memoryEntry.timesReinforced,
      confidence: Math.min(1.0, inMemoryKnowledge[existingIdx].confidence + 0.05)
    };
  } else {
    inMemoryKnowledge.push(memoryEntry);
  }

  // Persist asynchronously
  persistKnowledge().catch(() => {});
  logger.info(`[Nexus Memory] 🧠 Learned fact about "${cleanSubject}": "${cleanFact.substring(0, 60)}..."`);
  return memoryEntry;
}

/**
 * Searches learned knowledge for relevant memories matching a query
 */
export function queryLearnedKnowledge(queryText = '') {
  if (!queryText || inMemoryKnowledge.length === 0) return [];
  const q = queryText.toLowerCase().trim();

  const matches = [];

  for (const memory of inMemoryKnowledge) {
    const subj = memory.subject.toLowerCase();
    const fact = memory.fact.toLowerCase();

    let score = 0;

    // Exact subject match
    if (q.includes(subj)) {
      score += 10;
    } else {
      // Partial token match on subject words (length >= 3)
      const subjTokens = subj.split(/\s+/).filter(t => t.length >= 3);
      for (const token of subjTokens) {
        if (q.includes(token)) score += 3;
      }
    }

    // Keyword hits inside the fact
    const queryTokens = q.split(/\s+/).filter(t => t.length >= 4);
    for (const qToken of queryTokens) {
      if (fact.includes(qToken) && !subj.includes(qToken)) {
        score += 1;
      }
    }

    if (score >= 3) {
      matches.push({ memory, score });
    }
  }

  // Sort by highest score and return top memories
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3).map(m => m.memory);
}

/**
 * Gets all learned memories (for dashboard or commands)
 */
export function getAllLearnedMemories() {
  return inMemoryKnowledge;
}

/**
 * Forgets a memory by subject or ID
 */
export async function forgetMemory(target = '') {
  await initializeMemoryEngine();
  const cleanTarget = target.toLowerCase().trim();

  const initialCount = inMemoryKnowledge.length;
  inMemoryKnowledge = inMemoryKnowledge.filter(
    m => m.id !== target && m.subject.toLowerCase() !== cleanTarget
  );

  const deletedCount = initialCount - inMemoryKnowledge.length;
  if (deletedCount > 0) {
    await persistKnowledge();
  }
  return deletedCount;
}

/**
 * Analyzes a Discord message in real-time to extract pertinent knowledge.
 * Filters out noise, junk, spam, single words, and captures real knowledge.
 */
export async function analyzeMessageForKnowledge(message) {
  if (!message || !message.content || message.author?.bot) return null;

  const content = message.content.trim();
  // Skip commands or short messages
  if (content.startsWith('/') || content.startsWith('!') || content.length < 12) return null;

  const username = message.author.username || 'Member';
  const userId = message.author.id;
  const guildId = message.guild?.id || null;

  // ── 1. Explicit Training Commands: "nexus remember that...", "nexus learn...", "nexus know that..."
  const explicitMatch = content.match(/^(?:nexus|hey\s+nexus)[,\s:]+(?:please\s+)?(?:remember|learn|know|note|record)(?:\s+that|\s+this)?\s*[:\s]+(.+)$/i);
  if (explicitMatch) {
    const rawFact = explicitMatch[1].trim();
    // Parse subject from fact
    const parsed = parseFactSentence(rawFact);
    if (parsed) {
      return await learnFact({
        subject: parsed.subject,
        relation: parsed.relation,
        fact: parsed.fact,
        category: 'explicit_training',
        author: username,
        authorId: userId,
        guildId,
        confidence: 0.98
      });
    } else {
      return await learnFact({
        subject: rawFact.split(/\s+/).slice(0, 3).join(' '),
        relation: 'fact',
        fact: rawFact,
        category: 'explicit_training',
        author: username,
        authorId: userId,
        guildId,
        confidence: 0.90
      });
    }
  }

  // ── 2. Automatic Knowledge & Fact Extraction (Natural Chat Analysis)
  // Avoid common conversational chatter or sarcastic mockery that is NOT pertinent knowledge
  if (isEphemeralChatter(content)) return null;

  // Sarcasm Guard: never memorize sarcastic or ironic jokes as factual truth
  const sarcasmCheck = detectSarcasm(content);
  if (sarcasmCheck.isSarcastic) {
    logger.debug(`[Nexus Memory] Ignored sarcastic message from learning: "${content}" (${sarcasmCheck.type})`);
    return null;
  }

  const parsedFact = parseFactSentence(content);
  if (parsedFact && isPertinentInformation(parsedFact)) {
    return await learnFact({
      subject: parsedFact.subject,
      relation: parsedFact.relation,
      fact: parsedFact.fact,
      category: parsedFact.category,
      author: username,
      authorId: userId,
      guildId,
      confidence: 0.80
    });
  }

  // ── 3. User Preferences & Profiles ("My favorite X is Y", "I work at X", "I main X in Valorant")
  const prefMatch = content.match(/^(?:my|mon)\s+(favorite|favourite|préféré|main)\s+([a-zA-Z0-9_\s]+)\s+(?:is|c'est)\s+(.+)$/i);
  if (prefMatch) {
    const trait = prefMatch[2].trim();
    const val = prefMatch[3].trim();
    if (trait.length > 2 && val.length > 1) {
      return await learnFact({
        subject: `${username}'s ${trait}`,
        relation: 'user_preference',
        fact: `${username}'s favorite ${trait} is ${val}`,
        category: 'user_profile',
        author: username,
        authorId: userId,
        guildId,
        confidence: 0.95
      });
    }
  }

  return null;
}

/**
 * Sentence parser to extract subject, relation and clean fact
 */
function parseFactSentence(text) {
  const clean = text.replace(/^(?:did\s+you\s+know(?:\s+that)?|fun\s+fact[:\s]*|today\s+is|fyi[:\s]*)/i, '').trim();

  // Pattern: "<Subject> is/was/are/were <Predicate>" (e.g. "Robert Lewandowski is a striker for Barcelona")
  const isMatch = clean.match(/^([A-Z0-9][a-zA-Z0-9_'\s]{1,35})\s+(is|was|are|were|has|plays\s+for|works\s+at|lives\s+in)\s+(.+)$/);
  if (isMatch) {
    const subject = isMatch[1].trim();
    const relation = isMatch[2].trim().toLowerCase();
    const predicate = isMatch[3].trim();
    
    // Ignore junk like "I is...", "He is..."
    if (['i', 'you', 'he', 'she', 'it', 'they', 'we', 'this', 'that', 'there', 'here', 'what', 'who'].includes(subject.toLowerCase())) {
      return null;
    }

    return {
      subject,
      relation,
      fact: `${subject} ${relation} ${predicate}`,
      category: categorizeFact(subject, predicate)
    };
  }

  // Pattern: "The <Subject> of <Entity> is <Value>" (e.g. "The birthday of Lewandowski is August 21")
  const propMatch = clean.match(/^(?:the\s+)?(birthday|anniversary|owner|creator|capital|leader|ip|release\s+date|start\s+time)\s+of\s+([a-zA-Z0-9_\s]{2,30})\s+(?:is|was)\s+(.+)$/i);
  if (propMatch) {
    const relation = propMatch[1].trim().toLowerCase();
    const subject = propMatch[2].trim();
    const val = propMatch[3].trim();
    return {
      subject,
      relation,
      fact: `The ${relation} of ${subject} is ${val}`,
      category: 'entity_attribute'
    };
  }

  // Pattern: "<Entity>'s <Attribute> is <Value>" (e.g. "Lewandowski's birthday is August 21")
  const possMatch = clean.match(/^([A-Za-z0-9_\s]{2,30})'s\s+(birthday|anniversary|owner|creator|capital|team|club|position|favorite\s+\w+)\s+(?:is|was)\s+(.+)$/i);
  if (possMatch) {
    const subject = possMatch[1].trim();
    const relation = possMatch[2].trim().toLowerCase();
    const val = possMatch[3].trim();
    return {
      subject,
      relation,
      fact: `${subject}'s ${relation} is ${val}`,
      category: 'entity_attribute'
    };
  }

  return null;
}

/**
 * Determines whether a piece of information is pertinent and high-signal
 */
function isPertinentInformation({ subject, fact }) {
  if (!subject || !fact) return false;
  if (subject.length < 3 || subject.length > 50) return false;
  if (fact.length < 10 || fact.length > 300) return false;

  const sLower = subject.toLowerCase();
  const fLower = fact.toLowerCase();

  // Block junk subjects
  const bannedSubjects = [
    'someone', 'anyone', 'nobody', 'everybody', 'everything', 'nothing',
    'something', 'anything', 'whatever', 'my day', 'my mood', 'the server',
    'this message', 'the chat', 'my ass', 'my bad', 'my god'
  ];
  if (bannedSubjects.includes(sLower)) return false;

  // Pertinent high-value keywords (sports, tech, servers, games, events, rules, definitions, facts)
  const pertinentSignals = [
    'born', 'birthday', 'striker', 'player', 'club', 'team', 'game', 'release',
    'founded', 'created', 'author', 'developer', 'language', 'server', 'ip',
    'port', 'event', 'tournament', 'champion', 'championship', 'record',
    'score', 'rule', 'owner', 'ceo', 'president', 'capital', 'version',
    'features', 'update', 'season', 'won', 'winner', 'played', 'ranked',
    'fc', 'nba', 'premier league', 'la liga', 'discord', 'minecraft', 'valorant'
  ];

  const hasSignal = pertinentSignals.some(sig => fLower.includes(sig) || sLower.includes(sig));
  // If it's a well-formed factual statement with capitalized entities, it's pertinent
  const hasCapitalizedEntity = /[A-Z][a-z]+/.test(subject);

  return hasSignal || hasCapitalizedEntity;
}

/**
 * Filter out transient conversational chatter that should not pollute AI memory
 */
function isEphemeralChatter(text) {
  const t = text.toLowerCase().trim();
  return (
    /^(?:lol|lmao|xd|gg|wp|ok|okay|k|nice|cool|nah|yea|yeah|yes|no|bruh|bro|oof|wth|wtf|stfu|fml|idc|idk|brb|gtg|afk|cya|bye|hi|hello|hey|sup)[\s!.,?]*$/.test(t) ||
    /^(?:i(?:'m|\s+am)\s+(?:tired|sleepy|bored|eating|hungry|going|leaving|back|here|busy|playing|crying|laughing|fine))/.test(t) ||
    /^(?:good\s+(?:morning|night|afternoon|evening)|how\s+are\s+you|what\s+are\s+you\s+doing)/.test(t) ||
    /^(?:can\s+someone|anyone\s+here|is\s+anyone\s+online)/.test(t)
  );
}

/**
 * Categorize the fact
 */
function categorizeFact(subject, predicate) {
  const combined = `${subject} ${predicate}`.toLowerCase();
  if (combined.includes('football') || combined.includes('striker') || combined.includes('barca') || combined.includes('madrid') || combined.includes('goal') || combined.includes('nba') || combined.includes('champion')) return 'sports';
  if (combined.includes('game') || combined.includes('minecraft') || combined.includes('gta') || combined.includes('valorant') || combined.includes('fortnite')) return 'gaming';
  if (combined.includes('code') || combined.includes('javascript') || combined.includes('python') || combined.includes('api') || combined.includes('server') || combined.includes('database')) return 'tech';
  if (combined.includes('rule') || combined.includes('moderator') || combined.includes('admin') || combined.includes('ban') || combined.includes('channel')) return 'server_lore';
  return 'general_knowledge';
}
