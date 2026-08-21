// nexus-ai.js
// Production-Ready JavaScript / TypeScript SDK Client for Nexus AI & RaidShield Engine
// Compatible with Node.js 18+, Bun, Railway environments, and modern browsers.

export class NexusAI {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] - Your secret Nexus API key (from Railway or in-app generator)
   * @param {string} [config.baseUrl] - Base URL of your Nexus AI Server (e.g. https://your-app.railway.app/api/v1)
   */
  constructor({ apiKey, baseUrl } = {}) {
    this.apiKey =
      apiKey ||
      process.env.NEXUS_API_KEY ||
      process.env.API_KEY ||
      'nexus_sk_discord_bot_1394001641899954368';

    let rawUrl =
      baseUrl ||
      process.env.NEXUS_API_URL ||
      process.env.SERVER_URL ||
      (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : '') ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
      (process.env.APP_URL ? process.env.APP_URL : '') ||
      'http://localhost:3000';

    rawUrl = String(rawUrl).trim().replace(/\/+$/, '');
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      rawUrl = `https://${rawUrl}`;
    }

    if (rawUrl.endsWith('/api/v1')) {
      this.baseUrl = rawUrl;
    } else if (rawUrl.endsWith('/api')) {
      this.baseUrl = `${rawUrl}/v1`;
    } else {
      this.baseUrl = `${rawUrl}/api/v1`;
    }
  }

  /**
   * Verify API Key connection to the Nexus backend.
   * @returns {Promise<{ status: string, valid: boolean, authenticatedKey: string, message: string }>}
   */
  async verifyAuth() {
    const response = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Auth verification failed with status ${response.status}`);
    }
    return await response.json();
  }

  /**
   * Ask Nexus and receive the complete structured JSON response payload.
   *
   * @param {Object} options
   * @param {string} options.prompt - The question or message text
   * @param {string} [options.authorId] - Discord user ID
   * @param {string} [options.username] - Discord display name
   * @param {boolean} [options.isSuperChillUser] - VIP homie mode
   * @param {string} [options.imageUrl] - Remote image URL (Discord attachment)
   * @param {string} [options.imageData] - Base64 Data URL
   * @returns {Promise<{
   *   response: string,
   *   text: string,
   *   persona: string,
   *   authorId: string | null,
   *   isSuperChillUser: boolean,
   *   hasImage: boolean,
   *   tokens: number,
   *   timestamp: string,
   *   queueStats?: { waitedInQueueMs: number, executionTimeMs: number }
   * }>}
   */
  async askJSON({ prompt, authorId = '', username = '', isSuperChillUser = false, imageUrl = '', imageData = '' }) {
    const isSuperChill = isSuperChillUser || authorId === '1394001641899954368';
    const response = await fetch(`${this.baseUrl}/nexus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        prompt,
        authorId,
        username,
        isSuperChillUser: isSuperChill,
        imageUrl,
        imageData,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Nexus API HTTP error ${response.status}: ${errBody || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Ask Nexus and receive plain string text answer.
   *
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async ask(options) {
    const data = await this.askJSON(options);
    return data.response || data.text || '';
  }

  /**
   * Evaluate a Discord message or image attachment against RaidShield's 21 Hard Security Rules.
   * Catches fake Nitro QR codes, phishing screenshots, token stealers, scam banners, and raid graphics.
   *
   * @param {Object} options
   * @param {string} [options.messageText] - The message content to evaluate
   * @param {string} [options.authorId] - Discord user ID of the sender
   * @param {string} [options.imageUrl] - Discord attachment URL or remote image URL
   * @param {string} [options.imageData] - Base64 Data URL (data:image/png;base64,...)
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
    const response = await fetch(`${this.baseUrl}/raidshield`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        messageText,
        authorId,
        imageUrl,
        imageData,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`RaidShield API HTTP error ${response.status}: ${errBody || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Dedicated Vision analysis for deep inspection of any image in JSON format.
   *
   * @param {Object} options
   * @param {string} [options.imageUrl] - Image URL
   * @param {string} [options.imageData] - Base64 Data URL
   * @param {string} [options.prompt] - Custom analysis question
   * @param {'general' | 'security'} [options.mode] - Inspection mode
   */
  async analyzeImage({ imageUrl = '', imageData = '', prompt = '', mode = 'general' }) {
    const response = await fetch(`${this.baseUrl}/vision/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({ imageUrl, imageData, prompt, mode }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Vision API error ${response.status}: ${errBody || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Alias for analyzeImage() to support all coding conventions.
   */
  async analyzeVision(options) {
    return await this.analyzeImage(options);
  }

  /**
   * Check AI server waitlist queue status.
   */
  async getQueueStatus() {
    const response = await fetch(`${this.baseUrl}/queue/status`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return await response.json();
  }

  /**
   * Check AI server health.
   */
  async getHealth() {
    const rootUrl = this.baseUrl.replace(/\/v1$/, '');
    const response = await fetch(`${rootUrl}/health`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return await response.json();
  }
}

export default NexusAI;
