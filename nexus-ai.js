// nexus-ai.js
// Production-Grade JavaScript & TypeScript SDK Client for Nexus AI Engine, RaidShield & Dynamic Personas
// Universal compatibility: Node.js (Discord.js), Bun, Railway, and modern browser environments.
// Supports both ES Modules (import) and CommonJS (require).

export class NexusChatSession {
  constructor(client, options = {}) {
    this.client = client;
    this.persona = options.persona || client.getPersona();
    this.authorId = options.authorId || client.defaultAuthorId || '';
    this.username = options.username || 'DiscordUser';
    this.rules = options.rules || client.getClientRules();
    this.reasoningMode = options.reasoningMode || 'standard';
    this.history = [];
  }

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

    this.history.push({ role: 'user', content: message, timestamp: new Date() });
    this.history.push({
      role: 'assistant',
      content: res.response || res.text || '',
      sources: res.knowledgeHits || [],
      thoughtProcess: res.thoughtSteps || [],
      timestamp: new Date(),
    });

    if (this.history.length > 20) this.history = this.history.slice(-20);

    return {
      text: res.response || res.text || '',
      knowledgeHits: res.knowledgeHits || [],
      matchedDocuments: res.matchedDocuments || [],
      followUpQuestions: res.followUpQuestions || [],
      thoughtSteps: res.thoughtSteps || [],
      tokens: res.tokens || 0,
    };
  }

  clearHistory() { this.history = []; return this; }
  getHistory() { return [...this.history]; }
}

export class NexusAI {
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
      'https://ais-dev-ibvpx7fn3pnxtdxabola6x-240233116101.us-east1.run.app/api/v1';

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

  setPersona(personaId) { this.currentPersona = personaId; return this; }
  getPersona() { return this.currentPersona; }
  setRules(rules) { this.clientRules = Array.isArray(rules) ? rules : rules ? [rules] : []; return this; }
  addRule(rule) { if (rule && typeof rule === 'string') this.clientRules.push(rule.trim()); return this; }
  clearRules() { this.clientRules = []; return this; }
  getClientRules() { return [...this.clientRules]; }
  setTemperature(temp) { this.defaultTemperature = Math.max(0, Math.min(2.0, temp)); return this; }

  _getHeaders(extraHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'x-api-key': this.apiKey,
      ...extraHeaders,
    };
  }

  createChatSession(options = {}) {
    return new NexusChatSession(this, options);
  }

  // --- SERVER SETTINGS & PERSONAS ---
  async getSettings() {
    const res = await fetch(`${this.baseUrl}/settings`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch settings: HTTP ${res.status}`);
    return await res.json();
  }

  async updateSettings(updates = {}) {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update settings: HTTP ${res.status}`);
    return await res.json();
  }

  async listPersonas() {
    const res = await fetch(`${this.baseUrl}/personas`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to list personas: HTTP ${res.status}`);
    return await res.json();
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/models`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to list models: HTTP ${res.status}`);
    return await res.json();
  }

  async getActivePersona() {
    const res = await fetch(`${this.baseUrl}/persona`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to get active persona: HTTP ${res.status}`);
    return await res.json();
  }

  async switchServerPersona(persona) {
    const res = await fetch(`${this.baseUrl}/persona/set`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ persona }),
    });
    if (!res.ok) throw new Error(`Failed to switch server persona: HTTP ${res.status}`);
    return await res.json();
  }

  // --- MAIN INFERENCE & DISCORD CHAT ---
  async askJSON(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options || {};
    const authorId = opts.authorId || opts.userId || this.defaultAuthorId || '';
    const isSuperChill = Boolean(opts.isSuperChillUser || opts.isSuperChill || authorId === '1394001641899954368');

    const requestRules = opts.rules || opts.customRules || opts.directives || '';
    const extraRules = Array.isArray(requestRules) ? requestRules : requestRules ? [requestRules] : [];
    const allRules = [...this.clientRules, ...extraRules];

    const activePersona = opts.persona || opts.model || this.currentPersona || 'nexus-homie';

    const payload = {
      prompt: opts.prompt || opts.content || opts.message || opts.text || '',
      persona: activePersona,
      model: activePersona,
      authorId,
      userId: authorId,
      username: opts.username || 'DiscordUser',
      isSuperChillUser: isSuperChill,
      isSuperChill,
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
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Nexus API HTTP ${res.status}: ${errText || res.statusText}`);
    }
    return await res.json();
  }

  async ask(options) {
    const data = await this.askJSON(options);
    return data.response || data.text || '';
  }

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

  // --- MATH ---
  async solveMath(input) {
    const expression = typeof input === 'string' ? input : input?.expression || input?.query || input?.prompt || '';
    const res = await fetch(`${this.baseUrl}/math`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ expression }),
    });
    if (!res.ok) throw new Error(`Math API HTTP ${res.status}`);
    return await res.json();
  }
  async evaluateMath(expression) { return this.solveMath(expression); }
  async convertUnits(conversionQuery) { return this.solveMath(conversionQuery); }

  // --- ENTITIES ---
  async extractEntities(text) {
    const res = await fetch(`${this.baseUrl}/entities`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Entities API HTTP ${res.status}`);
    return await res.json();
  }

  // --- WEB SEARCH ---
  async searchWeb(options) {
    const opts = typeof options === 'string' ? { query: options } : options || {};
    const res = await fetch(`${this.baseUrl}/web/search`, {
      method: 'POST', headers: this._getHeaders(),
      body: JSON.stringify({ query: opts.query || opts.q || '', provider: opts.provider || opts.engine || 'all', limit: opts.limit || 5 }),
    });
    if (!res.ok) throw new Error(`Web Search API HTTP ${res.status}`);
    return await res.json();
  }

  async askWithSearch(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options || {};
    return this.ask({ ...opts, webSearch: true, search: true });
  }

  // --- SWEAR ENGINE ---
  async infuseSwear(options) {
    const opts = typeof options === 'string' ? { text: options } : options || {};
    const res = await fetch(`${this.baseUrl}/swear`, {
      method: 'POST', headers: this._getHeaders(),
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

  // --- PERSONA SHORTCUTS ---
  async askCrashout(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'crashout-bot', crashout: true }); }
  async crashout(options) { return this.askCrashout(options); }
  async askRoast(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'roast-master' }); }
  async askChill(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'chill-mod' }); }
  async askCode(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'code-architect' }); }
  async askResearcher(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'deep-researcher' }); }
  async askHomie(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'nexus-homie' }); }
  async askSentinel(options) { const opts = typeof options === 'string' ? { prompt: options } : options; return this.ask({ ...opts, persona: 'discord-sentinel' }); }

  // --- KNOWLEDGE CORPUS & BM25 SEARCH ---
  async listDocuments({ category = '' } = {}) {
    const url = category ? `${this.baseUrl}/documents?category=${encodeURIComponent(category)}` : `${this.baseUrl}/documents`;
    const res = await fetch(url, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to list documents: HTTP ${res.status}`);
    return await res.json();
  }

  async searchDocuments(options) {
    const opts = typeof options === 'string' ? { query: options } : options || {};
    const res = await fetch(`${this.baseUrl}/documents/search`, {
      method: 'POST', headers: this._getHeaders(),
      body: JSON.stringify({ query: opts.query || opts.q, limit: opts.limit || opts.topK || 5 }),
    });
    if (!res.ok) throw new Error(`Failed to search documents: HTTP ${res.status}`);
    return await res.json();
  }

  async searchCorpus(query, options = {}) {
    const opts = typeof options === 'number' ? { limit: options } : options;
    return this.searchDocuments({ query, ...opts });
  }

  async addDocument({ title, content, category = 'custom-api-doc', keywords = [] }) {
    const res = await fetch(`${this.baseUrl}/documents`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ title, content, category, keywords }),
    });
    if (!res.ok) throw new Error(`Failed to add document: HTTP ${res.status}`);
    return await res.json();
  }

  async deleteDocument(documentId) {
    const res = await fetch(`${this.baseUrl}/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE', headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete document: HTTP ${res.status}`);
    return await res.json();
  }

  async getCorpusStats() {
    const res = await fetch(`${this.baseUrl}/corpus`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to get corpus stats: HTTP ${res.status}`);
    return await res.json();
  }

  // --- RAIDSHIELD SECURITY ---
  async checkSecurity({ messageText = '', authorId = '', imageUrl = '', imageData = '' } = {}) {
    const res = await fetch(`${this.baseUrl}/raidshield`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ messageText, authorId, imageUrl, imageData }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`RaidShield API HTTP ${res.status}: ${errText || res.statusText}`);
    }
    return await res.json();
  }

  async isSafe(messageText) {
    const sec = await this.checkSecurity({ messageText });
    return sec.classification === 'safe';
  }

  // --- VISION SCANNER ---
  async analyzeImage({ imageUrl = '', imageData = '', prompt = '', mode = 'general' }) {
    const res = await fetch(`${this.baseUrl}/vision/analyze`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ imageUrl, imageData, prompt, mode }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Vision API error HTTP ${res.status}: ${errText || res.statusText}`);
    }
    return await res.json();
  }
  async analyzeVision(options) { return this.analyzeImage(options); }

  // --- RULES ---
  async listSupportedRules() {
    const res = await fetch(`${this.baseUrl}/sdk/rules`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch SDK rules: HTTP ${res.status}`);
    return await res.json();
  }

  async enforceRules({ text, rules, isSuperChillUser = false }) {
    const res = await fetch(`${this.baseUrl}/sdk/rules/enforce`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ text, rules, isSuperChillUser }),
    });
    if (!res.ok) throw new Error(`Failed to enforce rules: HTTP ${res.status}`);
    return await res.json();
  }

  // --- OPENAI-STYLE COMPATIBILITY SHIMS ---
  async generate(options = {}) {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error(`Generate API HTTP ${res.status}`);
    return await res.json();
  }

  async chatCompletion(options = {}) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error(`Chat Completions HTTP ${res.status}`);
    return await res.json();
  }

  // --- DIAGNOSTICS ---
  async verifyAuth() {
    const res = await fetch(`${this.baseUrl}/auth/verify`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Auth verification failed with status ${res.status}`);
    return await res.json();
  }

  async listKeys() {
    const res = await fetch(`${this.baseUrl}/keys`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to list keys: HTTP ${res.status}`);
    return await res.json();
  }

  async generateKey(label = 'discord_bot') {
    const res = await fetch(`${this.baseUrl}/keys/generate`, {
      method: 'POST', headers: this._getHeaders(), body: JSON.stringify({ label }),
    });
    if (!res.ok) throw new Error(`Failed to generate key: HTTP ${res.status}`);
    return await res.json();
  }

  async getQueueStatus() {
    const res = await fetch(`${this.baseUrl}/queue/status`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to get queue status: HTTP ${res.status}`);
    return await res.json();
  }

  async getHealth() {
    const rootUrl = this.baseUrl.replace(/\/v1$/, '');
    const res = await fetch(`${rootUrl}/health`, { method: 'GET', headers: this._getHeaders() });
    if (!res.ok) throw new Error(`Failed to get health: HTTP ${res.status}`);
    return await res.json();
  }
}

// Universal export support for CommonJS & ESM
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NexusAI, NexusChatSession, default: NexusAI };
}

export default NexusAI;
