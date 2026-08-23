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
      timestamp: new Date(),
    });
    if (this.history.length > 20) this.history = this.history.slice(-20);

    return {
      text: res.response || res.text || '',
      knowledgeHits: res.knowledgeHits || [],
      followUpQuestions: res.followUpQuestions || [],
    };
  }

  clearHistory() { this.history = []; return this; }
  getHistory() { return [...this.history]; }
}

export class NexusAI {
  /**
   * Initialize a new Nexus AI Client instance
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Your secret Nexus API key
   * @param {string} [config.baseUrl] - Base URL of your Nexus AI Server
   * @param {string} [config.persona] - Default AI Persona ('nexus-homie', 'crashout-bot', 'roast-master', 'chill-mod', 'code-architect', 'deep-researcher', 'gemini-core', 'raidshield-ai', 'discord-sentinel', 'socratic-mentor', 'creative-synthesizer')
   * @param {string|string[]} [config.rules] - Global strict rules or custom directives
   * @param {number} [config.temperature] - Default model temperature (0.0 to 2.0)
   * @param {string} [config.authorId] - Default Discord author ID (e.g. VIP ID '1394001641899954368')
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
      '';

    let cleanUrl = (baseUrl || defaultUrl).trim().replace(/\/+$/, '');
    if (cleanUrl) {
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        cleanUrl = `https://${cleanUrl}`;
      }
      if (cleanUrl.endsWith('/api')) {
        cleanUrl = `${cleanUrl}/v1`;
      } else if (!cleanUrl.endsWith('/api/v1') && !cleanUrl.includes('/api/v1')) {
        cleanUrl = `${cleanUrl}/api/v1`;
      }
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
  addRule(rule) { if (rule) this.clientRules.push(rule.trim()); return this; }
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

  // --- SERVER SETTINGS & PERSONAS ---
  async getSettings() {
    const res = await fetch(`${this.baseUrl}/settings`, { headers: this._getHeaders() });
    return await res.json();
  }

  async updateSettings(updates = {}) {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(updates),
    });
    return await res.json();
  }

  async listPersonas() {
    const res = await fetch(`${this.baseUrl}/personas`, { headers: this._getHeaders() });
    return await res.json();
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this._getHeaders() });
    return await res.json();
  }

  async getActivePersona() {
    const res = await fetch(`${this.baseUrl}/persona`, { headers: this._getHeaders() });
    return await res.json();
  }

  async switchServerPersona(persona) {
    const res = await fetch(`${this.baseUrl}/persona/set`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ persona }),
    });
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

    const res = await fetch(`${this.baseUrl}/nexus`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({
        prompt: opts.prompt || opts.content || opts.message || opts.text || '',
        persona: activePersona,
        model: activePersona,
        authorId,
        username: opts.username || 'DiscordUser',
        isSuperChillUser: isSuperChill,
        mode: opts.mode || (opts.deepThink ? 'deep-cot' : opts.crashout ? 'crashout' : undefined),
        deepThink: Boolean(opts.deepThink || opts.mode === 'deep' || opts.mode === 'deep-cot'),
        crashout: Boolean(opts.crashout || opts.mode === 'crashout' || activePersona === 'crashout-bot'),
        history: opts.history || opts.messages || [],
        rules: allRules.join('\n'),
        imageUrl: opts.imageUrl || opts.image || '',
        imageData: opts.imageData || '',
        temperature: typeof opts.temperature === 'number' ? opts.temperature : this.defaultTemperature,
      }),
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
    return this.askJSON({ ...opts, mode: 'deep-cot', deepThink: true });
  }

  async solveMath(expression) {
    const res = await fetch(`${this.baseUrl}/math`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ expression }),
    });
    return await res.json();
  }
  async evaluateMath(expr) { return this.solveMath(expr); }
  async convertUnits(query) { return this.solveMath(query); }

  async extractEntities(text) {
    const res = await fetch(`${this.baseUrl}/entities`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text }),
    });
    return await res.json();
  }

  async searchWeb(options) {
    const opts = typeof options === 'string' ? { query: options } : options || {};
    const res = await fetch(`${this.baseUrl}/web/search`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ query: opts.query || opts.q || '', provider: opts.provider || 'all', limit: opts.limit || 5 }),
    });
    return await res.json();
  }

  async askWithSearch(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options || {};
    return this.ask({ ...opts, webSearch: true, search: true });
  }

  async infuseSwear(options) {
    const opts = typeof options === 'string' ? { text: options } : options || {};
    const res = await fetch(`${this.baseUrl}/swear`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({
        text: opts.text || opts.prompt || '',
        intensity: opts.intensity || 'heavy',
        language: opts.language || 'english',
        isSuperChill: Boolean(opts.isSuperChill),
      }),
    });
    return await res.json();
  }

  createChatSession(options = {}) {
    return new NexusChatSession(this, options);
  }

  async askCrashout(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'crashout-bot', crashout: true }); }
  async crashout(opts) { return this.askCrashout(opts); }
  async askRoast(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'roast-master' }); }
  async askChill(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'chill-mod' }); }
  async askCode(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'code-architect' }); }
  async askResearcher(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'deep-researcher' }); }
  async askHomie(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'nexus-homie' }); }
  async askSentinel(opts) { return this.ask({ ...(typeof opts === 'string' ? { prompt: opts } : opts), persona: 'discord-sentinel' }); }

  // --- MULTI-DOCUMENT KNOWLEDGE CORPUS & BM25 SEARCH ---
  async listDocuments({ category = '' } = {}) {
    const url = category ? `${this.baseUrl}/documents?category=${encodeURIComponent(category)}` : `${this.baseUrl}/documents`;
    const res = await fetch(url, { headers: this._getHeaders() });
    return await res.json();
  }

  async searchDocuments({ query, limit = 5 } = {}) {
    const res = await fetch(`${this.baseUrl}/documents/search`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ query, limit }),
    });
    return await res.json();
  }
  async searchCorpus(query, options = {}) {
    const opts = typeof options === 'number' ? { limit: options } : options;
    return this.searchDocuments({ query, ...opts });
  }

  async addDocument({ title, content, category = 'custom-api-doc', keywords = [] }) {
    const res = await fetch(`${this.baseUrl}/documents`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ title, content, category, keywords }),
    });
    return await res.json();
  }

  async deleteDocument(documentId) {
    const res = await fetch(`${this.baseUrl}/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      headers: this._getHeaders(),
    });
    return await res.json();
  }

  async getCorpusStats() {
    const res = await fetch(`${this.baseUrl}/corpus`, { headers: this._getHeaders() });
    return await res.json();
  }

  // --- RAIDSHIELD 21-RULE SECURITY & AUTOMOD ---
  async checkSecurity({ messageText = '', authorId = '', imageUrl = '', imageData = '' } = {}) {
    const res = await fetch(`${this.baseUrl}/raidshield`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ messageText, authorId, imageUrl, imageData }),
    });
    if (!res.ok) throw new Error(`RaidShield API error: ${res.status}`);
    return await res.json();
  }

  async isSafe(messageText) {
    const sec = await this.checkSecurity({ messageText });
    return sec.classification === 'safe';
  }

  // --- VISION SCANNER & OCR ---
  async analyzeImage({ imageUrl = '', imageData = '', prompt = '', mode = 'general' } = {}) {
    const res = await fetch(`${this.baseUrl}/vision/analyze`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ imageUrl, imageData, prompt, mode }),
    });
    if (!res.ok) throw new Error(`Vision API error: ${res.status}`);
    return await res.json();
  }

  async analyzeVision(options) { return this.analyzeImage(options); }

  // --- STRICT RULES & DIRECTIVES ---
  async listSupportedRules() {
    const res = await fetch(`${this.baseUrl}/sdk/rules`, { headers: this._getHeaders() });
    return await res.json();
  }

  async enforceRules({ text, rules, isSuperChillUser = false }) {
    const res = await fetch(`${this.baseUrl}/sdk/rules/enforce`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text, rules, isSuperChillUser }),
    });
    return await res.json();
  }

  // --- FORMAT COMPATIBILITY ---
  async generate(options = {}) {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(options),
    });
    return await res.json();
  }

  async chatCompletion(options = {}) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(options),
    });
    return await res.json();
  }

  // --- AUTH & SYSTEM ---
  async verifyAuth() {
    const res = await fetch(`${this.baseUrl}/auth/verify`, { headers: this._getHeaders() });
    return await res.json();
  }

  async listKeys() {
    const res = await fetch(`${this.baseUrl}/keys`, { headers: this._getHeaders() });
    return await res.json();
  }

  async generateKey(label = 'discord_bot') {
    const res = await fetch(`${this.baseUrl}/keys/generate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ label }),
    });
    return await res.json();
  }

  async getQueueStatus() {
    const res = await fetch(`${this.baseUrl}/queue/status`, { headers: this._getHeaders() });
    return await res.json();
  }

  async getHealth() {
    const rootUrl = this.baseUrl.replace(/\/v1$/, '');
    const res = await fetch(`${rootUrl}/health`, { headers: this._getHeaders() });
    return await res.json();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NexusAI, NexusChatSession, default: NexusAI };
}
export default NexusAI;
