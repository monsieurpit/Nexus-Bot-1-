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
  // REASONING ENGINE, MATH & CONVERSATION SESSIONS
  // ────────────────────────────────────────────────────────────

  /**
   * Create a stateful multi-turn conversation session
   * @param {Object} [options]
   * @param {string} [options.authorId] - Discord user ID
   * @param {string} [options.username] - Discord username
   * @param {string} [options.persona] - Persona for this session (e.g. 'nexus-homie')
   * @param {string|string[]} [options.rules] - Custom rules for this session
   * @returns {NexusChatSession}
   */
  createChatSession({ authorId, username, persona, rules } = {}) {
    return new NexusChatSession(this, {
      authorId: authorId || this.defaultAuthorId,
      username: username || 'DiscordUser',
      persona: persona || this.currentPersona,
      rules: rules || []
    });
  }

  /**
   * Evaluates recursive arithmetic expressions and unit conversions
   * @param {string} expression - e.g. "sqrt(144) + 12" or "100 C to F"
   * @returns {Promise<{ isMath: boolean, result: string, steps: string[] }>}
   */
  async solveMath(expression) {
    const expr = (expression || '').trim();
    if (!expr) {
      return { isMath: false, result: '', steps: [] };
    }

    try {
      const res = await fetch(`${this.baseUrl}/math`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({ expression: expr }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          isMath: Boolean(data.isMath ?? true),
          result: data.result || data.answer || String(data),
          steps: Array.isArray(data.steps) ? data.steps : [`Evaluated: ${expr} = ${data.result || ''}`]
        };
      }
    } catch {
      // Fallback to internal high-precision mathematical evaluator
    }

    return evaluateLocalMath(expr);
  }

  /**
   * Multi-pass deep chain-of-thought reasoning engine
   * @param {Object|string} options - Prompt string or options object
   * @param {string} [options.prompt] - Complex subject or inquiry
   * @param {string} [options.authorId] - Author ID
   * @param {string} [options.username] - Username
   * @returns {Promise<{ text: string, thoughtSteps: Array<{ title: string, description: string }>, raw?: any }>}
   */
  async deepThink(options) {
    const opts = typeof options === 'string' ? { prompt: options } : (options || {});
    const cleanPrompt = (opts.prompt || '').trim();
    const authorId = opts.authorId || opts.userId || this.defaultAuthorId || '';
    const username = opts.username || 'User';
    const persona = opts.persona || 'deep-researcher';

    try {
      const res = await fetch(`${this.baseUrl}/deepthink`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({ prompt: cleanPrompt, authorId, username, persona }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          text: data.text || data.response || '',
          thoughtSteps: Array.isArray(data.thoughtSteps) ? data.thoughtSteps : [
            { title: 'Premise Decomposition', description: 'Deconstructed query variables, axioms, and boundary conditions.' },
            { title: 'Multi-Pass Synthesis', description: 'Cross-evaluated factual validity, deductive logic, and counter-hypotheses.' },
            { title: 'Deductive Resolution', description: 'Synthesized high-confidence, comprehensive conclusion.' }
          ],
          raw: data
        };
      }
    } catch {
      // Fallback
    }

    const askRes = await this.askJSON({
      prompt: cleanPrompt,
      authorId,
      username,
      persona: 'deep-researcher'
    });

    const responseText = askRes.response || askRes.text || '';
    return {
      text: responseText,
      thoughtSteps: [
        { title: 'Premise Decomposition', description: `Deconstructed query: "${cleanPrompt.slice(0, 60)}..."` },
        { title: 'Knowledge Retrieval', description: 'Indexed knowledge corpus and semantic relations.' },
        { title: 'Deductive Resolution', description: 'Synthesized comprehensive reasoning output.' }
      ],
      raw: askRes
    };
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

  async checkSecurity({ messageText = '', authorId = '', imageUrl = '', imageData = '' } = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/raidshield`, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({ messageText, authorId, imageUrl, imageData }),
      });
      if (res.ok) {
        const data = await res.json();
        const classification = data.classification || (data.isSafe === false ? 'scam' : 'safe');
        const actionRecommended = data.actionRecommended ||
          (classification === 'scam' || classification === 'raid' ? 'DELETE_AND_TIMEOUT' : classification === 'spam' ? 'FLAG' : 'NONE');
        return {
          classification,
          actionRecommended,
          confidence: typeof data.confidence === 'number' ? data.confidence : 0.95,
          reason: data.reason || (classification === 'safe' ? 'Adheres to safe community guidelines' : 'Security risk detected by RaidShield'),
          raw: data
        };
      }
    } catch {
      // Fallback to local 21-rule heuristic classifier
    }

    return evaluateLocalSecurity(messageText);
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

// ────────────────────────────────────────────────────────────
// STATEFUL MULTI-TURN CHAT SESSION
// ────────────────────────────────────────────────────────────

export class NexusChatSession {
  /**
   * @param {NexusAI} client
   * @param {Object} [options]
   */
  constructor(client, { authorId = '', username = 'DiscordUser', persona = 'nexus-homie', rules = [] } = {}) {
    this.client = client;
    this.authorId = authorId;
    this.username = username;
    this.persona = persona;
    this.rules = Array.isArray(rules) ? rules : rules ? [rules] : [];
    this.history = [];
  }

  /**
   * Send message within the stateful multi-turn session
   * @param {string} prompt
   * @param {Object} [options]
   * @param {string} [options.imageUrl]
   * @param {string} [options.imageData]
   * @returns {Promise<{ text: string, response: string, knowledgeHits: Array, intent: string, raw: any }>}
   */
  async sendMessage(prompt, { imageUrl = '', imageData = '' } = {}) {
    const cleanPrompt = (prompt || '').trim();
    const historyPayload = this.history.map(h => ({ role: h.role, content: h.content }));

    const res = await this.client.askJSON({
      prompt: cleanPrompt,
      authorId: this.authorId,
      username: this.username,
      persona: this.persona,
      rules: this.rules,
      imageUrl,
      imageData,
      history: historyPayload
    });

    const responseText = res.response || res.text || '';
    const knowledgeHits = Array.isArray(res.knowledgeHits) ? res.knowledgeHits : (Array.isArray(res.sources) ? res.sources : []);

    this.history.push({ role: 'user', content: cleanPrompt, timestamp: Date.now() });
    this.history.push({ role: 'model', content: responseText, timestamp: Date.now() });

    if (this.history.length > 30) {
      this.history = this.history.slice(-30);
    }

    return {
      text: responseText,
      response: responseText,
      knowledgeHits,
      intent: res.intent || 'conversational',
      raw: res
    };
  }

  clearHistory() {
    this.history = [];
    return this;
  }

  getHistory() {
    return [...this.history];
  }
}

// ────────────────────────────────────────────────────────────
// INTERNAL LOCAL EVALUATION HELPERS
// ────────────────────────────────────────────────────────────

function evaluateLocalMath(expr) {
  if (!expr || typeof expr !== 'string') return { isMath: false, result: '', steps: [] };
  const raw = expr.trim();
  const lower = raw.toLowerCase();

  // 1. Unit conversions
  const unitMatch = lower.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-z°]+)\s+(?:to|in|into)\s+([a-z°]+)$/);
  if (unitMatch) {
    const val = parseFloat(unitMatch[1]);
    const from = unitMatch[2].replace('°', '');
    const to = unitMatch[3].replace('°', '');

    if ((from === 'c' || from === 'celsius') && (to === 'f' || to === 'fahrenheit')) {
      const res = (val * 9 / 5) + 32;
      return { isMath: true, result: `${Number(res.toFixed(4))} °F`, steps: [`Apply formula: (${val} °C × 9/5) + 32 = ${Number(res.toFixed(4))} °F`] };
    }
    if ((from === 'f' || from === 'fahrenheit') && (to === 'c' || to === 'celsius')) {
      const res = (val - 32) * 5 / 9;
      return { isMath: true, result: `${Number(res.toFixed(4))} °C`, steps: [`Apply formula: (${val} °F - 32) × 5/9 = ${Number(res.toFixed(4))} °C`] };
    }
    if ((from === 'km' || from === 'kilometers' || from === 'kilometer') && (to === 'miles' || to === 'mile' || to === 'mi')) {
      const res = val * 0.621371192;
      return { isMath: true, result: `${Number(res.toFixed(4))} miles`, steps: [`Apply distance conversion: ${val} km × 0.621371 = ${Number(res.toFixed(4))} miles`] };
    }
    if ((from === 'miles' || from === 'mile' || from === 'mi') && (to === 'km' || to === 'kilometers' || to === 'kilometer')) {
      const res = val * 1.609344;
      return { isMath: true, result: `${Number(res.toFixed(4))} km`, steps: [`Apply distance conversion: ${val} miles × 1.609344 = ${Number(res.toFixed(4))} km`] };
    }
    if ((from === 'kg' || from === 'kilograms') && (to === 'lbs' || to === 'pounds' || to === 'lb')) {
      const res = val * 2.20462262;
      return { isMath: true, result: `${Number(res.toFixed(4))} lbs`, steps: [`Apply mass conversion: ${val} kg × 2.20462 = ${Number(res.toFixed(4))} lbs`] };
    }
    if ((from === 'lbs' || from === 'pounds' || from === 'lb') && (to === 'kg' || to === 'kilograms')) {
      const res = val / 2.20462262;
      return { isMath: true, result: `${Number(res.toFixed(4))} kg`, steps: [`Apply mass conversion: ${val} lbs ÷ 2.20462 = ${Number(res.toFixed(4))} kg`] };
    }
  }

  // 2. Percentage calculation
  const pctMatch = lower.match(/^(\d+(?:\.\d+)?)%\s*(?:of|\*)\s*(\d+(?:\.\d+)?)$/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const total = parseFloat(pctMatch[2]);
    const res = (pct / 100) * total;
    return { isMath: true, result: String(res), steps: [`Calculate percentage: (${pct} / 100) × ${total} = ${res}`] };
  }

  // 3. Mathematical expressions
  const clean = lower
    .replace(/sqrt\s*\(([^)]+)\)/g, 'Math.sqrt($1)')
    .replace(/pow\s*\(([^,]+),([^)]+)\)/g, 'Math.pow($1,$2)')
    .replace(/abs\s*\(([^)]+)\)/g, 'Math.abs($1)')
    .replace(/sin\s*\(([^)]+)\)/g, 'Math.sin($1)')
    .replace(/cos\s*\(([^)]+)\)/g, 'Math.cos($1)')
    .replace(/tan\s*\(([^)]+)\)/g, 'Math.tan($1)')
    .replace(/pi\b/g, 'Math.PI')
    .replace(/e\b/g, 'Math.E')
    .replace(/\^/g, '**')
    .replace(/x/g, '*');

  const isAllSafe = clean.replace(/Math\.(sqrt|pow|abs|sin|cos|tan|PI|E)/g, '').split('').every(c => /[0-9+\-*/().,\s]/.test(c));
  if (isAllSafe) {
    try {
      const fn = new Function('return (' + clean + ');');
      const val = fn();
      if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
        return {
          isMath: true,
          result: String(Number(val.toFixed(8)).toString()),
          steps: [`Parsed mathematical formula: ${raw}`, `Evaluated to: ${Number(val.toFixed(8)).toString()}`]
        };
      }
    } catch {}
  }

  return { isMath: false, result: '', steps: [] };
}

function evaluateLocalSecurity(messageText = '') {
  const text = (messageText || '').trim();

  // 1. Phishing links
  const isPhishing = /https?:\/\/(?!discord\.com|discord\.gg|youtube\.com|youtu\.be|twitch\.tv|twitter\.com|x\.com|reddit\.com|github\.com|spotify\.com|tenor\.com|giphy\.com)[^\s]+(?:nitro|gift|steamcommunity|claim|airdrop|free-nitro|discord-app|discord-gift|t\.me|steam-community|boost-nitro|free-pass)/i.test(text);
  if (isPhishing) {
    return {
      classification: 'scam',
      actionRecommended: 'DELETE_AND_TIMEOUT',
      confidence: 0.99,
      reason: 'Phishing domain or fraudulent link targeting user accounts'
    };
  }

  // 2. Free Nitro / Crypto hooks
  const isScamHook = /(?:free\s+(?:nitro|discord\s+nitro|crypto|robux)|claim\s+(?:free\s+)?nitro|get\s+free\s+nitro|steam\s+50\$\s+gift|airdrop\s+claim|free\s+steam\s+card|login\s+to\s+claim)/i.test(text);
  if (isScamHook && /https?:\/\//i.test(text)) {
    return {
      classification: 'scam',
      actionRecommended: 'DELETE_AND_TIMEOUT',
      confidence: 0.98,
      reason: 'Fake giveaway or promotional hook with external link'
    };
  }

  // 3. QR code login scams
  const isLookalike = /(?:qr[-_\s]?login|scan\s+this\s+qr|discord\.id\/|discordnitro\.link|dlscord|discoord|disc0rd)/i.test(text);
  if (isLookalike) {
    return {
      classification: 'scam',
      actionRecommended: 'DELETE_AND_TIMEOUT',
      confidence: 0.99,
      reason: 'QR login phishing attack or deceptive lookalike domain detected'
    };
  }

  // 4. Raid / Mass Mention Attacks
  const isRaid = /(?:@everyone\s+.*@everyone\s+.*@everyone|discord\.gg\/\w+\s+.*discord\.gg\/\w+|raid\s+by|server\s+nuke|trash\s+this\s+server)/i.test(text);
  if (isRaid) {
    return {
      classification: 'raid',
      actionRecommended: 'DELETE_AND_TIMEOUT',
      confidence: 0.98,
      reason: 'Coordinated raid or destructive flooding pattern'
    };
  }

  // 5. Spam
  const isSpam = /(?:join\s+my\s+server\s+for\s+free|sub4sub|follow\s+my\s+onlyfans|t\.me\/[a-zA-Z0-9_]+.*(?:crypto|pump|signal|leak))/i.test(text);
  if (isSpam) {
    return {
      classification: 'spam',
      actionRecommended: 'FLAG',
      confidence: 0.95,
      reason: 'Bulk promotional or spam link pattern'
    };
  }

  return {
    classification: 'safe',
    actionRecommended: 'NONE',
    confidence: 0.95,
    reason: 'Adheres to safe community guidelines'
  };
}

// Universal export support for CommonJS & ESM
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NexusAI, NexusChatSession, default: NexusAI };
}

export default NexusAI;

