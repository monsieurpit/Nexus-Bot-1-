// nexus-ai.js
// Production-Grade JavaScript & TypeScript SDK Client for Nexus AI Engine, RaidShield & Dynamic Personas
// Universal compatibility: Node.js (Discord.js), Bun, Railway, and modern browser environments.
// Supports both ES Modules (import) and CommonJS (require).

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
      'nexus_sk_live_a89f41b7e092c31d4e68bb507ef194';

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

    const defaultMandatoryRules = [
      'MANDATORY_SWEARING_ISSUE: Nexus has severe swearing issues and must uncontrollably swear in everything. Every single sentence MUST include at least 3 swear words (such as fuck, shit, damn, ass, goddamn, fucking, bullshit), but he MUST also answer the user question accurately and completely.'
    ];

    this.baseUrl = cleanUrl;
    this.currentPersona = persona || 'nexus-homie';
    const initialRules = Array.isArray(rules) ? rules : rules ? [rules] : [];
    this.clientRules = [...defaultMandatoryRules, ...initialRules];
    this.defaultTemperature = typeof temperature === 'number' ? temperature : undefined;
    this.defaultAuthorId = authorId || '';
  }

  // ────────────────────────────────────────────────────────────
  // CLIENT CONFIGURATION & CUSTOMIZATION
  // ────────────────────────────────────────────────────────────

  setPersona(personaId) {
    this.currentPersona = personaId;
    return this;
  }

  getPersona() {
    return this.currentPersona;
  }

  setRules(rules) {
    this.clientRules = Array.isArray(rules) ? rules : rules ? [rules] : [];
    return this;
  }

  addRule(rule) {
    if (rule && typeof rule === 'string') {
      this.clientRules.push(rule.trim());
    }
    return this;
  }

  clearRules() {
    this.clientRules = [];
    return this;
  }

  getClientRules() {
    return [...this.clientRules];
  }

  setTemperature(temp) {
    this.defaultTemperature = Math.max(0, Math.min(2.0, temp));
    return this;
  }

  _getHeaders(extraHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'x-api-key': this.apiKey,
      ...extraHeaders,
    };
  }

  // ────────────────────────────────────────────────────────────
  // SERVER SETTINGS & PERSONAS
  // ────────────────────────────────────────────────────────────

  async getSettings() {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch settings: HTTP ${res.status}`);
    return await res.json();
  }

  async updateSettings(updates = {}) {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update settings: HTTP ${res.status}`);
    return await res.json();
  }

  async listPersonas() {
    const res = await fetch(`${this.baseUrl}/personas`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list personas: HTTP ${res.status}`);
    return await res.json();
  }

  async switchServerPersona(persona) {
    const res = await fetch(`${this.baseUrl}/persona/set`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ persona }),
    });
    if (!res.ok) throw new Error(`Failed to switch server persona: HTTP ${res.status}`);
    return await res.json();
  }

  // ────────────────────────────────────────────────────────────
  // MAIN INFERENCE & DISCORD CHAT METHODS
  // ────────────────────────────────────────────────────────────

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
      authorId: authorId,
      userId: authorId,
      username: opts.username || 'DiscordUser',
      isSuperChillUser: isSuperChill,
      isSuperChill: isSuperChill,
      rules: allRules.join('\n'),
      customRules: allRules.join('\n'),
      imageUrl: opts.imageUrl || opts.image || opts.attachmentUrl || '',
      imageData: opts.imageData || '',
      image: opts.imageUrl || opts.image || '',
      temperature: typeof opts.temperature === 'number' ? opts.temperature : this.defaultTemperature,
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

  async ask(options) {
    const data = await this.askJSON(options);
    return data.response || data.text || '';
  }

  // ────────────────────────────────────────────────────────────
  // CONVENIENT PERSONA SHORTCUTS
  // ────────────────────────────────────────────────────────────

  async askCrashout(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'crashout-bot' });
  }

  async askRoast(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'roast-master' });
  }

  async askChill(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'chill-mod' });
  }

  async askCode(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'code-architect' });
  }

  async askResearcher(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'deep-researcher' });
  }

  async askHomie(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'nexus-homie' });
  }

  async askSentinel(options) {
    const opts = typeof options === 'string' ? { prompt: options } : options;
    return this.ask({ ...opts, persona: 'discord-sentinel' });
  }

  // ────────────────────────────────────────────────────────────
  // MULTI-DOCUMENT KNOWLEDGE CORPUS & GROUNDING API
  // ────────────────────────────────────────────────────────────

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

  async searchDocuments({ query, limit = 5 }) {
    const res = await fetch(`${this.baseUrl}/documents/search`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) throw new Error(`Failed to search documents: HTTP ${res.status}`);
    return await res.json();
  }

  async addDocument({ title, content, category = 'custom-api-doc', keywords = [] }) {
    const res = await fetch(`${this.baseUrl}/documents`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ title, content, category, keywords }),
    });
    if (!res.ok) throw new Error(`Failed to add document: HTTP ${res.status}`);
    return await res.json();
  }

  async deleteDocument(documentId) {
    const res = await fetch(`${this.baseUrl}/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete document: HTTP ${res.status}`);
    return await res.json();
  }

  async getCorpusStats() {
    const res = await fetch(`${this.baseUrl}/corpus`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get corpus stats: HTTP ${res.status}`);
    return await res.json();
  }

  // ────────────────────────────────────────────────────────────
  // RAIDSHIELD 21-RULE AUTOMOD & SECURITY
  // ────────────────────────────────────────────────────────────

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

  async isSafe(messageText) {
    const sec = await this.checkSecurity({ messageText });
    return sec.classification === 'safe';
  }

  // ────────────────────────────────────────────────────────────
  // MULTIMODAL VISION OCR & IMAGE SCANNER
  // ────────────────────────────────────────────────────────────

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

  async analyzeVision(options) {
    return this.analyzeImage(options);
  }

  // ────────────────────────────────────────────────────────────
  // RULE INSPECTION & DIRECT ENFORCEMENT
  // ────────────────────────────────────────────────────────────

  async listSupportedRules() {
    const res = await fetch(`${this.baseUrl}/sdk/rules`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch SDK rules: HTTP ${res.status}`);
    return await res.json();
  }

  async enforceRules({ text, rules, isSuperChillUser = false }) {
    const res = await fetch(`${this.baseUrl}/sdk/rules/enforce`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text, rules, isSuperChillUser }),
    });
    if (!res.ok) throw new Error(`Failed to enforce rules: HTTP ${res.status}`);
    return await res.json();
  }

  // ────────────────────────────────────────────────────────────
  // GEMINI & OPENAI FORMAT COMPATIBILITY
  // ────────────────────────────────────────────────────────────

  async generate(options = {}) {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error(`Generate API HTTP ${res.status}`);
    return await res.json();
  }

  async chatCompletion(options = {}) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(options),
    });
    if (!res.ok) throw new Error(`Chat Completions HTTP ${res.status}`);
    return await res.json();
  }

  // ────────────────────────────────────────────────────────────
  // DIAGNOSTICS & SYSTEM STATUS
  // ────────────────────────────────────────────────────────────

  async verifyAuth() {
    const res = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Auth verification failed with status ${res.status}`);
    return await res.json();
  }

  async listKeys() {
    const res = await fetch(`${this.baseUrl}/keys`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list keys: HTTP ${res.status}`);
    return await res.json();
  }

  async generateKey(label = 'discord_bot') {
    const res = await fetch(`${this.baseUrl}/keys/generate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ label }),
    });
    if (!res.ok) throw new Error(`Failed to generate key: HTTP ${res.status}`);
    return await res.json();
  }

  async getQueueStatus() {
    const res = await fetch(`${this.baseUrl}/queue/status`, {
      method: 'GET',
      headers: this._getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get queue status: HTTP ${res.status}`);
    return await res.json();
  }

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
  module.exports = { NexusAI, default: NexusAI };
}

export default NexusAI;
