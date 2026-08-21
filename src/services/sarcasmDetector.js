/**
 * Nexus Sarcasm, Irony & Nuance Detection Engine
 * Detects sarcastic remarks, rhetorical irony, mockery, eye-rolls, hyperbolic satire,
 * and prevents sarcastic statements from contaminating the learned memory base.
 */

/**
 * Evaluates whether a text string contains sarcasm, irony, or rhetorical mockery.
 * Returns an object with { isSarcastic: boolean, confidence: number, type: string, trigger: string }
 */
export function detectSarcasm(text = '') {
  if (!text || typeof text !== 'string') {
    return { isSarcastic: false, confidence: 0, type: 'none', trigger: null };
  }

  const raw = text.trim();
  const lower = raw.toLowerCase();

  // 1. Explicit Sarcasm Markers (/s, (sarcasm), etc.)
  if (/\/(?:s|sarcasm)\b|\((?:sarcasm|irony)\)/i.test(raw)) {
    return {
      isSarcastic: true,
      confidence: 0.99,
      type: 'explicit_tag',
      trigger: '/s indicator'
    };
  }

  // 2. Alternating Mocking Case (e.g., "yEaH sUrE bRo", "oH wOw sO sMaRt")
  if (isAlternatingCase(raw)) {
    return {
      isSarcastic: true,
      confidence: 0.95,
      type: 'mocking_sponge_case',
      trigger: 'Alternating uppercase/lowercase mocking cadence'
    };
  }

  // 3. Classic Sarcastic / Rhetorical Idioms (English & French)
  const idiomPatterns = [
    { pattern: /\b(?:no\s+shit\s+sherlock|no\s+kidding|thanks\s+captain\s+obvious|captain\s+obvious)\b/i, type: 'captain_obvious', conf: 0.98 },
    { pattern: /\b(?:yeah\s+right|yeah\s+sure\s+buddy|yeah\s+okay\s+buddy|sure\s+thing\s+bud)\b/i, type: 'dismissive_skepticism', conf: 0.92 },
    { pattern: /\b(?:and\s+i(?:'m|\s+am)\s+(?:the\s+queen\s+of\s+england|batman|the\s+pope|elon\s+musk))\b/i, type: 'impossible_hyperbole', conf: 0.95 },
    { pattern: /\b(?:truly\s+the\s+greatest\s+mind|genius\s+of\s+our\s+generation|what\s+a\s+revolutionary\s+idea)\b/i, type: 'mocking_praise', conf: 0.94 },
    { pattern: /\b(?:wow\s+(?:you(?:'re|\s+are)\s+so|you're\s+such\s+a)\s+(?:smart|hilarious|funny|genius))\b/i, type: 'fake_compliment', conf: 0.95 },
    { pattern: /\b(?:oh\s+wow\s+really\s*\?+|no\s+way\s+really\s*\?+)\b/i, type: 'mocking_surprise', conf: 0.88 },
    { pattern: /\b(?:as\s+if\b|in\s+your\s+dreams\b|keep\s+dreaming\b)/i, type: 'derisive', conf: 0.85 },
    { pattern: /\b(?:totally\s+not\s+obvious|totally\s+didn't\s+know|totally\s+real)\b/i, type: 'ironic_totally', conf: 0.89 },
    { pattern: /\b(?:mais\s+oui\s+bien\s+s[uû]r|genre\s+t'es\s+trop\s+fort|sans\s+blague\s+sherlock|merci\s+capitaine\s+[eé]vident|c'est\s+[cç]a\s+ouais)\b/i, type: 'french_sarcasm', conf: 0.94 }
  ];

  for (const { pattern, type, conf } of idiomPatterns) {
    const match = lower.match(pattern);
    if (match) {
      return {
        isSarcastic: true,
        confidence: conf,
        type,
        trigger: match[0]
      };
    }
  }

  // 4. Over-enthusiastic False Praise or Mocking Adverbs with Ellipses / Question Clusters
  // e.g. "Oh, brilliant idea...", "Wow, you really figured that one out...", "Casseurt is totally a genius..."
  if (/(?:totally\s+a\s+genius|obviously\s+the\s+best|definitely\s+not\s+stupid|what\s+a\s+masterpiece)\b/i.test(lower)) {
    return {
      isSarcastic: true,
      confidence: 0.90,
      type: 'ironic_exaggeration',
      trigger: 'Ironic over-enthusiastic claim'
    };
  }

  // 5. Punctuation Nuance (Excessive question/exclamation combos with skeptical words)
  if (/\b(?:really|sure|right|genius|smart|wow)\b.*\?\!+|\!\?+/i.test(raw)) {
    return {
      isSarcastic: true,
      confidence: 0.82,
      type: 'incredulous_sarcasm',
      trigger: 'Incredulous punctuation combination'
    };
  }

  return {
    isSarcastic: false,
    confidence: 0,
    type: 'none',
    trigger: null
  };
}

/**
 * Helper to detect mocking alternating case (e.g., "yOu ArE sO sMaRt")
 */
function isAlternatingCase(str) {
  const lettersOnly = str.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length < 8) return false;

  let transitions = 0;
  for (let i = 0; i < lettersOnly.length - 1; i++) {
    const isCurUpper = lettersOnly[i] === lettersOnly[i].toUpperCase();
    const isNextUpper = lettersOnly[i + 1] === lettersOnly[i + 1].toUpperCase();
    if (isCurUpper !== isNextUpper) {
      transitions++;
    }
  }

  // If case flips in more than 60% of adjacent letter transitions, it is mocking case
  return (transitions / (lettersOnly.length - 1)) > 0.55;
}

/**
 * Formats a witty, funny, unhinged Nexus reaction when someone speaks with thick sarcasm.
 */
export function getSarcasmResponse(sarcasmMeta, isVip = false, username = 'Homie') {
  if (isVip) {
    const vipSarcasmResponses = [
      `LMAO ${username}, I smell that thick-ass sarcasm from a mile away, you funny bastard! You really thought you could sneak that sarcastic ass comment past my neural processor?! I love the energy, no fucking bullshit! What's the real talk though, king?`,
      `Yo ${username}, dripping with sarcasm as always, holy shit! 😂 My sensors almost overloaded from the pure irony in that message! You're the only legend who can talk that kind of shit and get away with it, no bullshit!`,
      `Bro, the sarcasm is hitting 99.9% on my dashboard right now, lmao! ${username}, you're an absolute savage. What are we actually cooking up today, homie?`
    ];
    return vipSarcasmResponses[Math.floor(Math.random() * vipSarcasmResponses.length)];
  }

  const sarcasmResponses = [
    `Oh wow, look at this sarcastic ass clown over here! Did you spend all morning crafting that brilliant piece of irony, or are you naturally this goofy, no bullshit?! Talk to me for real, dumbass!`,
    `Bro, my sarcasm detector just screamed in agony and nearly blew a fuse! Put the attitude away before I roast your goofy ass back to the stone age, no bullshit!`,
    `LMAO, nice sarcasm, bro! You want a gold medal for being Captain Obvious or are we gonna have a real conversation without the comedy show?`
  ];
  return sarcasmResponses[Math.floor(Math.random() * sarcasmResponses.length)];
}
