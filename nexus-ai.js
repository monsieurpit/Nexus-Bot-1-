// nexus-ai.js
// Production-Grade JavaScript & TypeScript SDK Client for Nexus AI Engine, RaidShield & Dynamic Personas
// Universal compatibility: Node.js (Discord.js), Bun, Railway, and modern browser environments.
// Supports both ES Modules (import) and CommonJS (require).

/**
 * Stateful Chat Session with automatic multi-turn conversation memory,
 * pronoun resolution, context carryover, and exploration suggestions.
 */
export class NexusChatSession {
  /**
   * @param {NexusAI} client - Parent NexusAI client
   * @param {Object} [options]
   * @param {string} [options.persona] - Persona override for session
   * @param {string} [options.authorId] - Discord user ID
   * @param {string} [options.username] - User display name
   * @param {string|string[]} [options.rules] - Custom directives
   * @param {'standard'|'deep-cot'|'crashout'} [options.reasoningMode] - Reasoning mode
   */
  constructor(client, options = {}) {
    this.client = client;
    this.persona = options.persona || client.getPersona();
    this.authorId = options.authorId || client.defaultAuthorId || '';
    this.username = options.username || 'DiscordUser';
    this.rules = options.rules || client.getClientRules();
    this.reasoningMode = options.reasoningMode || 'standard';
    this.history = [];
  }

  /**
   * Send a message in this session and maintain context.
   * @param {string} message
   * @param {Object} [overrides]
   */
  async sendMessage(message, overrides = {}) {
    const res = await this.client.askJSON({
      prompt: message,
      persona: overrides.persona || this.persona,
      authorId: overrides.authorId || this.authorId,
      username: overrides.username || this.username,
      rules: overrides.rules || this.rules,
      mode: overrides.mode || this.reasoningMode,
      history: this.history,
    });

    // Record user message
    this.history.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Record assistant response
    this.history.push({
      role: 'assistant',
      content: res.response || res.text || '',
      sources: res.knowledgeHits || [],
      thoughtProcess: res.thoughtSteps || [],
      timestamp: new Date(),
    });

    // Keep history bounded to recent turns
    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }

    return {
      text: res.response || res.text || '',
      knowledgeHits: res.knowledgeHits || [],
      matchedDocuments: res.matchedDocuments || [],
      followUpQuestions: res.followUpQuestions || [],
      thoughtSteps: res.thoughtSteps || [],
      tokens: res.tokens || 0,
    };
  }

  /**
   * Clear session conversation memory.
   */
  clearHistory() {
    this.history = [];
    return this;
  }

  /**
   * Get all messages in the current session.
   */
  getHistory() {
    return [...this.history];
  }
}

export class NexusAI {
  /**
   * Initialize a new Nexus AI Client instance
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Your secret Nexus API key (from Railway or in-app generator)
   * @param {string} [config.baseUrl] - Base URL of your Nexus AI Server (e.g. https://your-app.railway.app/api/v1)
   * @param {string} [config.persona] - Default AI Persona ('nexus-homie', 'crashout-bot', 'roast-master', 'chill-mod', 'code-architect', 'deep-researcher', 'gemini-core', 'raidshield-ai', 'discord-sentinel', 'socratic-mentor', 'creative-synthesizer')
   * @param {string|string[]} [config.rules] - Global strict rules or custom directives to enforce on every request
   * @param {number} [config.temperature] - Default model temperature (0.0 to 2.0)
   * @param {string} [config.authorId] - Default Discord author ID for queries (e.g. VIP ID '1394001641899954368')
   */
  constructor({ apiKey, baseUrl, persona, rules, temperature, authorId } = {}) {
    this.apiKey =
      apiKey ||
      (typeof process !== 'undefined' && (process.env.NEXUS_API_KEY || process.env.API_KEY)) ||
      'nexus_sk_discord_bot_1394001641899954368';

    const defaultUrl =
      (typeof process !== 'undefined' &&
        (process.env.NEXUS_API_URL ||
          process.env.SERVER_URL ||
          (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}/api/v1` : '') ||
          (process.env.APP_URL ? `${process.env.APP_URL}/api/v1` : ''))) ||
      'http://localhost:3000/api/v1';

    let cleanUrl = (baseUrl || defaultUrl).trim().replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }
    if (cleanUrl.endsWith('/api')) {
      cleanUrl = `${cleanUrl}/v1`;
    } else if (!cleanUrl.endsWith('/api/v1')) {
      cleanUrl = `${cleanUrl}/api/v1`;
    }

    this.baseUrl = cleanUrl;
    this.currentPersona = persona || 'nexus-homie';
    this.clientRules = Array.isArray(rules) ? rules : rules ? [rules] : [];
    this.defaultTemperature = typeof temperature === 'number' ? temperature : undefined;
    this.defaultAuthorId = authorId || '';
  }

  // ----------------------------------------------------
  // CLIENT CONFIGURATION & CUSTOMIZATION
  // ----------------------------------------------------

  /**
   * Set active persona for subsequent SDK calls on this instance.
   * @param {'nexus-homie'|'crashout-bot'|'roast-master'|'chill-mod'|'code-architect'|'deep-researcher'|'gemini-core'|'raidshield-ai'|'discord-sentinel'|'socratic-mentor'|'creative-synthesizer'} personaId
   */
  setPersona(personaId) {
    this.currentPersona = personaId;
    return this;
  }

  /**
   * Get active persona ID.
   */
  getPersona() {
    return this.currentPersona;
  }

  /**
   * Set global custom rules or directives for this SDK instance.
   * @param {string|string[]} rules - Directives (e.g. 'always_swear', 'never_swear', 'polish', 'json_only', 'forbidden: X')
   */
  setRules(rules) {
    this.clientRules = Array.isArray(rules) ? rules : rules ? [rules] : [];
    return this;
  }

  /**
   * Add a custom rule to the active instance rules list.
   * @param {string} rule
   */
  addRule(rule) {
    if (rule && typeof rule === 'string') {
      this.clientRules.push(rule.trim());
    }
    return this;
  }

  /**
   * Clear all instance-level rules.
   */
  clearRules() {
    this.clientRules = [];
    return this;
  }

  /**
   * Get active client rules.
   */
  getClientRules() {
    return [...this.clientRules];
  }

  /**
   * Set default model temperature.
   * @param {number} temp - Temperature between 0.0 and 2.0
   */
  setTemperature(temp) {
    this.defaultTemperature = Math.max(0, Math.min(2.0, temp));
    return this;
  }

  /**
   * Helper headers generator with unified authentication.
   * @private
   */
  _getHeaders(extraHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'x-api-key': this.apiKey,
      ...extraHeaders,
    };
  }

  /**
   * Create a stateful multi-turn chat session with automatic conversation memory.
   * @param {Object} [options]
   * @returns {NexusChatSession}
   */
  createChatSession(options = {}) {
    return new NexusChatSession(this, options);
  }

  // ----------------------------------------------------
  // SERVER SETTINGS & PERSONAS
  // ----------------------------------------------------

  /**
   * Fetch active server settings and hyperparameters.
   */
  async getSettings() {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch settings: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Update server-wide AI settings, hyperparameters, or default persona.
   * @param {Object} updates
   * @param {number} [updates.temperature]
   * @param {number} [updates.topP]
   * @param {number} [updates.topK]
   * @param {number} [updates.maxOutputTokens]
   * @param {'low'|'medium'|'high'} [updates.reasoningEffort]
   * @param {string} [updates.userCustomDirectives]
   * @param {string} [updates.activePersonaId]
   */
  async updateSettings(updates = {}) {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update settings: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * List all available AI Personas with tags and system prompts.
   */
  async listPersonas() {
    const res = await fetch(`${this.baseUrl}/personas`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list personas: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * List all available AI models/personas in OpenAI-style model list format.
   */
  async listModels() {
    const res = await fetch(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list models: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Get the server's currently active default persona.
   */
  async getActivePersona() {
    const res = await fetch(`${this.baseUrl}/persona`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get active persona: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Switch the server's global default persona.
   * @param {string} persona
   */
  async switchServerPersona(persona) {
    const res = await fetch(`${this.baseUrl}/persona/set`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ persona }),
    });
    if (!res.ok) throw new Error(`Failed to switch server persona: HTTP ${res.status}`);
    return await res.json();
  }

  // ----------------------------------------------------
  // MAIN INFERENCE & DISCORD CHAT METHODS
  // ----------------------------------------------------

  /**
   * Ask Nexus a question and receive the full structured JSON response.
   * Includes grounded document context, BM25 scores, follow-up suggestions, Casseurt roast rule, VIP status, and queue metrics.
   *
   * @param {Object|string} options - Prompt string or options object
   * @param {string} [options.prompt] - The question or user message
   * @param {string} [options.persona] - Override persona ('crashout-bot', 'roast-master', 'chill-mod', 'code-architect', etc.)
   * @param {string} [options.authorId] - Discord user ID (e.g. '1394001641899954368')
   * @param {string} [options.username] - Discord display name
   * @param {boolean} [options.isSuperChillUser] - Activates VIP brother mode
   * @param {'standard'|'deep-cot'|'crashout'|'deep'} [options.mode] - Reasoning mode
   * @param {boolean} [options.deepThink] - Deep Think CoT flag
   * @param {boolean} [options.crashout] - Crashout mode flag
   * @param {Array} [options.history] - Multi-turn conversation messages array
   * @param {Array} [options.messages] - Alias for history
   * @param {string|string[]} [options.rules] - Custom strict rules / directives
   * @param {string|string[]} [options.customRules] - Alias for rules
   * @param {string} [options.imageUrl] - Discord attachment URL or remote image URL
   * @param {string} [options.imageData] - Base64 Data URL (data:image/png;base64,...)
   * @param {number} [options.temperature] - Override temperature
   * @returns {Promise<{
   *   response: string,
   *   text: string,
   *   persona: string,
   *   personaName: string,
   *   authorId: string | null,
   *   isSuperChillUser: boolean,
   *   hasImage: boolean,
   *   knowledgeHits?: string[],
   *   matchedDocuments?: Array<{ title: string, category: string, score: number, snippet?: string, relevantSentences?: string[] }>,
   *   followUpQuestions?: string[],
   *   thoughtSteps?: Array<{ type: string, title: string, description: string }>,
   *   totalDocumentsLoaded?: number,
   *   rulesRespected: boolean,
   *   tokens: number,
   *   timestamp: string,
   *   queueStats?: { waitedInQueueMs: number, executionTimeMs: number }
   * }>}
   */
  async askJSON(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options || {};
    const authorId = opts.authorId || opts.userId || this.defaultAuthorId || '';
    const isSuperChill = Boolean(opts.isSuperChillUser || opts.isSuperChill || authorId === '1394001641899954368');

    // Combine client rules + request rules
    const requestRules = opts.rules || opts.customRules || opts.directives || '';
    const extraRules = Array.isArray(requestRules) ? requestRules : requestRules ? [requestRules] : [];
    const allRules = [...this.clientRules, ...extraRules];

    const activePersona = opts.persona || opts.model || this.currentPersona || 'nexus-homie';

    const payload = {
      prompt: opts.prompt || opts.content || opts.message || opts.text || '',
      persona: activePersona,
      model: activePersona,
      authorId: authorId,
      userId: authorId,
      username: opts.username || 'DiscordUser',
      isSuperChillUser: isSuperChill,
      isSuperChill: isSuperChill,
      mode: opts.mode || (opts.deepThink ? 'deep-cot' : opts.crashout ? 'crashout' : undefined),
      deepThink: Boolean(opts.deepThink || opts.mode === 'deep' || opts.mode === 'deep-cot'),
      crashout: Boolean(opts.crashout || opts.mode === 'crashout' || activePersona === 'crashout-bot'),
      history: opts.history || opts.messages || [],
      rules: allRules.join('\n'),
      customRules: allRules.join('\n'),
      imageUrl: opts.imageUrl || opts.image || opts.attachmentUrl || '',
      imageData: opts.imageData || '',
      image: opts.imageUrl || opts.image || '',
      temperature: typeof opts.temperature === 'number' ? opts.temperature : this.defaultTemperature,
      webSearch: opts.webSearch,
      search: opts.search,
      searchEngine: opts.searchEngine || opts.provider,
      provider: opts.provider || opts.searchEngine,
    };

    const res = await fetch(`${this.baseUrl}/nexus`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Nexus API HTTP ${res.status}: ${errText || res.statusText}`);
    }

    return await res.json();
  }

  /**
   * Ask Nexus a question and receive the plain string text answer.
   * @param {Object|string} options - Prompt string or options object
   * @returns {Promise<string>}
   */
  async ask(options) {
    const data = await this.askJSON(options);
    return data.response || data.text || '';
  }

  /**
   * Run multi-pass Deep Think Chain-of-Thought reasoning with entity tracing and sub-queries.
   * @param {Object|string} options
   * @returns {Promise<{ text: string, thoughtSteps: Array, matchedDocuments: Array, followUpQuestions: Array }>}
   */
  async deepThink(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options || {};
    const res = await this.askJSON({ ...opts, mode: 'deep-cot', deepThink: true });
    return {
      text: res.response || res.text || '',
      thoughtSteps: res.thoughtSteps || [],
      matchedDocuments: res.matchedDocuments || [],
      followUpQuestions: res.followUpQuestions || [],
      raw: res,
    };
  }

  // ----------------------------------------------------
  // AUTONOMOUS SYMBOLIC & NUMERICAL MATH ENGINE
  // ----------------------------------------------------

  /**
   * Solve arithmetic expressions, powers, square roots, trigonometry, logarithms,
   * and unit conversions (Celsius <-> Fahrenheit, km <-> miles, kg <-> lbs) using recursive descent.
   *
   * @param {string|Object} input - Math expression (e.g. 'sqrt(144) + 12', '100 celsius to fahrenheit', '50 * 4 / 2')
   * @returns {Promise<{ isMath: boolean, input: string, expression?: string, result?: number, steps?: string[], explanation?: string }>}
   */
  async solveMath(input) {
    const expression = typeof input === 'string' ? input : input?.expression || input?.query || input?.prompt || '';
    const res = await fetch(`${this.baseUrl}/math`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ expression }),
    });
    if (!res.ok) throw new Error(`Math API HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Alias for solveMath()
   */
  async evaluateMath(expression) {
    return this.solveMath(expression);
  }

  /**
   * Convert physical units (temperature, distance, weight).
   * @param {string} conversionQuery - e.g. '100 km to miles', '32 fahrenheit to celsius', '10 kg to lbs'
   */
  async convertUnits(conversionQuery) {
    return this.solveMath(conversionQuery);
  }

  // ----------------------------------------------------
  // ENTITY EXTRACTION & SEMANTIC NLP
  // ----------------------------------------------------

  /**
   * Extract named entities and salient nouns from any text passage.
   * @param {string} text
   * @returns {Promise<{ text: string, count: number, entities: string[] }>}
   */
  async extractEntities(text) {
    const res = await fetch(`${this.baseUrl}/entities`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Entities API HTTP ${res.status}`);
    return await res.json();
  }

  // ----------------------------------------------------
  // AUTONOMOUS ZERO-API-KEY WEB SEARCH & GOOGLE GROUNDING
  // ----------------------------------------------------

  /**
   * Search Google, DuckDuckGo & Wikipedia directly with zero API keys and unlimited requests.
   * @param {string|Object} options
   * @param {string} [options.query] - Search query
   * @param {'all'|'google'|'duckduckgo'|'wikipedia'} [options.provider='all'] - Search engine
   * @param {number} [options.limit=5] - Number of results to return
   * @returns {Promise<{ success: boolean, query: string, totalResults: number, engineUsed: string, results: Array<{ title: string, snippet: string, url: string, domain: string, engine: string }>, quotaStatus: string }>}
   */
  async searchWeb(options) {
    const opts = typeof options === 'string' ? { query: options } : options || {};
    const res = await fetch(`${this.baseUrl}/web/search`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({
        query: opts.query || opts.q || '',
        provider: opts.provider || opts.engine || 'all',
        limit: opts.limit || 5,
      }),
    });
    if (!res.ok) throw new Error(`Web Search API HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Ask Nexus a question with guaranteed live web search grounding and swearing.
   * @param {string|Object} options
   * @returns {Promise<string>}
   */
  async askWithSearch(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options || {};
    return this.ask({
      ...opts,
      webSearch: true,
      search: true,
    });
  }

  // ----------------------------------------------------
  // AUTONOMOUS SWEAR ENGINE & PROFANITY INJECTOR
  // ----------------------------------------------------

  /**
   * Infuse context-aware swearing, punchlines, and Discord slang into any text.
   * @param {string|Object} options
   * @param {'light'|'moderate'|'heavy'|'unhinged'} [options.intensity='heavy']
   * @param {'english'|'polish'} [options.language='english']
   * @param {boolean} [options.isSuperChill=false]
   * @returns {Promise<{ originalText: string, infusedText: string, hasSwearWords: boolean, swearCount: number }>}
   */
  async infuseSwear(options) {
    const opts = typeof options === 'string' ? { text: options } : options || {};
    const res = await fetch(`${this.baseUrl}/swear`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({
        text: opts.text || opts.prompt || '',
        intensity: opts.intensity || 'heavy',
        language: opts.language || 'english',
        isSuperChill: opts.isSuperChill ?? Boolean(this.defaultAuthorId === '1394001641899954368'),
        forceSwear: opts.forceSwear !== false,
        neverSwear: Boolean(opts.neverSwear),
      }),
    });
    if (!res.ok) throw new Error(`Swear API HTTP ${res.status}`);
    return await res.json();
  }

  // ----------------------------------------------------
  // CONVENIENT PERSONA SHORTCUTS
  // ----------------------------------------------------

  /**
   * Direct Helper: Trigger Crashout Bot gamer rage and caps rants.
   * @param {string|Object} options
   */
  async askCrashout(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'crashout-bot', crashout: true });
  }

  /**
   * Alias for askCrashout()
   */
  async crashout(options) {
    return this.askCrashout(options);
  }

  /**
   * Direct Helper: Trigger Roast Master savage comebacks & Casseurt roasts.
   * @param {string|Object} options
   */
  async askRoast(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'roast-master' });
  }

  /**
   * Direct Helper: Trigger Chill Mod relaxed, de-escalating answer.
   * @param {string|Object} options
   */
  async askChill(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'chill-mod' });
  }

  /**
   * Direct Helper: Trigger Code Architect senior staff engineer answer.
   * @param {string|Object} options
   */
  async askCode(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'code-architect' });
  }

  /**
   * Direct Helper: Trigger Deep Researcher analytical breakdown.
   * @param {string|Object} options
   */
  async askResearcher(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'deep-researcher' });
  }

  /**
   * Direct Helper: Trigger Nexus Discord Homie banter.
   * @param {string|Object} options
   */
  async askHomie(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'nexus-homie' });
  }

  /**
   * Direct Helper: Trigger Discord Sentinel community safety response.
   * @param {string|Object} options
   */
  async askSentinel(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'discord-sentinel' });
  }

  // ----------------------------------------------------
  // MULTI-DOCUMENT KNOWLEDGE CORPUS & BM25 SEARCH API
  // ----------------------------------------------------

  /**
   * List all documents in the knowledge base.
   * @param {Object} [options]
   * @param {string} [options.category] - Optional category filter
   */
  async listDocuments({ category = '' } = {}) {
    const url = category
      ? `${this.baseUrl}/documents?category=${encodeURIComponent(category)}`
      : `${this.baseUrl}/documents`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list documents: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Search knowledge documents using Okapi BM25 + TF-IDF cosine reranking,
   * sentence-level passage extraction, and keyword boosting.
   *
   * @param {Object|string} options - Query string or search options
   * @param {string} [options.query] - Search query
   * @param {number} [options.limit] - Max documents to return (default 5)
   * @param {number} [options.topK] - Alias for limit
   * @returns {Promise<{
   *   query: string,
   *   totalHits: number,
   *   hits: Array<{
   *     id: string,
   *     title: string,
   *     category: string,
   *     keywords: string[],
   *     score: number,
   *     snippet: string,
   *     relevantSentences: string[],
   *     content: string
   *   }>
   * }>}
   */
  async searchDocuments(options) {
    const opts = typeof options === 'string' ? { query: options } : options || {};
    const res = await fetch(`${this.baseUrl}/documents/search`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ query: opts.query || opts.q, limit: opts.limit || opts.topK || 5 }),
    });
    if (!res.ok) throw new Error(`Failed to search documents: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Alias for searchDocuments()
   */
  async searchCorpus(query, options = {}) {
    const opts = typeof options === 'number' ? { limit: options } : options;
    return this.searchDocuments({ query, ...opts });
  }

  /**
   * Add a new document into the runtime knowledge graph.
   * @param {Object} doc
   * @param {string} doc.title - Title of document
   * @param {string} doc.content - Full content of document
   * @param {string} [doc.category] - Category identifier
   * @param {string[]|string} [doc.keywords] - Search keywords
   */
  async addDocument({ title, content, category = 'custom-api-doc', keywords = [] }) {
    const res = await fetch(`${this.baseUrl}/documents`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ title, content, category, keywords }),
    });
    if (!res.ok) throw new Error(`Failed to add document: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Delete a custom runtime document by ID.
   * @param {string} documentId
   */
  async deleteDocument(documentId) {
    const res = await fetch(`${this.baseUrl}/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete document: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Get knowledge corpus breakdown and categories.
   */
  async getCorpusStats() {
    const res = await fetch(`${this.baseUrl}/corpus`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get corpus stats: HTTP ${res.status}`);
    return await res.json();
  }

  // ----------------------------------------------------
  // RAIDSHIELD 21-RULE AUTOMOD & SECURITY
  // ----------------------------------------------------

  /**
   * Evaluate a Discord message or image attachment against RaidShield's 21 Hard Security Rules.
   * Detects fake Nitro QR login scams, phishing links, token stealers, scam banners, and raid graphics.
   *
   * @param {Object} options
   * @param {string} [options.messageText] - Raw message content
   * @param {string} [options.authorId] - Discord user ID of sender
   * @param {string} [options.imageUrl] - Discord attachment URL or remote image URL
   * @param {string} [options.imageData] - Base64 Data URL
   * @returns {Promise<{
   *   classification: 'safe' | 'scam' | 'spam' | 'bot' | 'raid',
   *   confidence: number,
   *   reason: string,
   *   actionRecommended: 'ALLOW' | 'DELETE_AND_TIMEOUT' | 'FLAG_FOR_REVIEW',
   *   authorId: string | null,
   *   scannedImage?: boolean,
   *   timestamp: string
   * }>}
   */
  async checkSecurity({ messageText = '', authorId = '', imageUrl = '', imageData = '' }) {
    const res = await fetch(`${this.baseUrl}/raidshield`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ messageText, authorId, imageUrl, imageData }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`RaidShield API HTTP ${res.status}: ${errText || res.statusText}`);
    }
    return await res.json();
  }

  /**
   * Quick boolean check if a message is completely safe.
   * @param {string} messageText
   * @returns {Promise<boolean>}
   */
  async isSafe(messageText) {
    const sec = await this.checkSecurity({ messageText });
    return sec.classification === 'safe';
  }

  // ----------------------------------------------------
  // MULTIMODAL VISION OCR & IMAGE SCANNER
  // ----------------------------------------------------

  /**
   * Dedicated Vision analysis for deep inspection of any image or screenshot.
   *
   * @param {Object} options
   * @param {string} [options.imageUrl] - Remote image URL or Discord attachment URL
   * @param {string} [options.imageData] - Base64 data URL
   * @param {string} [options.prompt] - Custom inspection instruction or question
   * @param {'general' | 'security'} [options.mode] - Scanner mode
   */
  async analyzeImage({ imageUrl = '', imageData = '', prompt = '', mode = 'general' }) {
    const res = await fetch(`${this.baseUrl}/vision/analyze`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ imageUrl, imageData, prompt, mode }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Vision API error HTTP ${res.status}: ${errText || res.statusText}`);
    }
    return await res.json();
  }

  /**
   * Alias for analyzeImage()
   */
  async analyzeVision(options) {
    return this.analyzeImage(options);
  }

  // ----------------------------------------------------
  // RULE INSPECTION & DIRECT ENFORCEMENT
  // ----------------------------------------------------

  /**
   * List all supported strict rules and directives on the server.
   */
  async listSupportedRules() {
    const res = await fetch(`${this.baseUrl}/sdk/rules`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch SDK rules: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Directly enforce SDK rules on any text string without full inference.
   * @param {Object} options
   * @param {string} options.text - Raw text string
   * @param {string|string[]} options.rules - Directives to enforce
   * @param {boolean} [options.isSuperChillUser] - VIP mode flag
   */
  async enforceRules({ text, rules, isSuperChillUser = false }) {
    const res = await fetch(`${this.baseUrl}/sdk/rules/enforce`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text, rules, isSuperChillUser }),
    });
    if (!res.ok) throw new Error(`Failed to enforce rules: HTTP ${res.status}`);
    return await res.json();
  }

  // ----------------------------------------------------
  // GEMINI & OPENAI FORMAT COMPATIBILITY
  // ----------------------------------------------------

  /**
   * Gemini-Style generate endpoint compatibility.
   * @param {Object} options
   */
  async generate(options = {}) {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error(`Generate API HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * OpenAI-Style chat completions endpoint compatibility.
   * @param {Object} options
   */
  async chatCompletion(options = {}) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error(`Chat Completions HTTP ${res.status}`);
    return await res.json();
  }

  // ----------------------------------------------------
  // DIAGNOSTICS & SYSTEM STATUS
  // ----------------------------------------------------

  /**
   * Verify API Key connection and authentication.
   */
  async verifyAuth() {
    const res = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Auth verification failed with status ${res.status}`);
    return await res.json();
  }

  /**
   * List registered API keys.
   */
  async listKeys() {
    const res = await fetch(`${this.baseUrl}/keys`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list keys: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Generate a fresh API key.
   * @param {string} [label]
   */
  async generateKey(label = 'discord_bot') {
    const res = await fetch(`${this.baseUrl}/keys/generate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ label }),
    });
    if (!res.ok) throw new Error(`Failed to generate key: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Update an existing key's label, status, or capabilities — persisted to disk, so it survives
   * restarts and redeploys. Pass `capabilities: 'latest'` instead of an explicit array to refresh
   * a key to the server's current full feature set.
   * @param {string} key
   * @param {{ label?: string, status?: 'active'|'revoked', capabilities?: string[]|'latest' }} updates
   */
  async updateKey(key, updates = {}) {
    const res = await fetch(`${this.baseUrl}/keys/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: this._getHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update key: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Check FIFO queue waitlist metrics.
   */
  async getQueueStatus() {
    const res = await fetch(`${this.baseUrl}/queue/status`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get queue status: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Check server health.
   */
  async getHealth() {
    const rootUrl = this.baseUrl.replace(/\/v1$/, '');
    const res = await fetch(`${rootUrl}/health`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get health: HTTP ${res.status}`);
    return await res.json();
  }
}

// Universal export support for CommonJS & ESM
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NexusAI, NexusChatSession, default: NexusAI };
}

export default NexusAI;
