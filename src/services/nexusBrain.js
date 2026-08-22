/**
 * Nexus Native Conversational Brain
 * 100% autonomous local AI engine - zero external API / Gemini dependencies required.
 * Implements conversational NLP, context recognition, math solver, code help, roasts, jokes, and VIP homie personality.
 */

import { getCasseurtCrashoutRant } from './casseurtRants.js';
import { extractEntityKnowledge } from './knowledgeBase.js';
import { queryLearnedKnowledge, getAllLearnedMemories, learnFact, forgetMemory } from './memoryBrainService.js';
import { detectSarcasm, getSarcasmResponse } from './sarcasmDetector.js';
import { solvePhysicalAction } from './physicalEngine.js';
import { solveDeductiveLogic } from './logicSolver.js';
import { solveCodeQuery } from './codeSolver.js';
import { solveMathExpression } from './mathSolver.js';

// French & English intent analyzers
export function generateNexusBrainResponse(question = '', userContext = {}) {
  const superChillUserId = process.env.SUPER_CHILL_USER_ID || '1394001641899954368';
  const isVip = userContext.userId === superChillUserId;
  const username = userContext.username || 'Homie';
  const rawQ = (question || '').trim();
  const q = rawQ.toLowerCase();

  let rawResponse = '';

  // 1. Casseurt crash-out trigger
  if (q.includes('casseurt') || q.includes('casseur')) {
    rawResponse = getCasseurtCrashoutRant(isVip, username);
  } else if (isSwearingIssueQuery(q)) {
    rawResponse = getSwearingIssueResponse(isVip, username);
  } else if (detectSarcasm(rawQ).isSarcastic) {
    const sarcasmMeta = detectSarcasm(rawQ);
    rawResponse = getSarcasmResponse(sarcasmMeta, isVip, username);
  } else if (solvePhysicalAction(q, rawQ, isVip, username)) {
    rawResponse = solvePhysicalAction(q, rawQ, isVip, username);
  } else if (solveMathExpression(q, rawQ, isVip, username)) {
    rawResponse = solveMathExpression(q, rawQ, isVip, username);
  } else if (solveDeductiveLogic(q, rawQ, isVip, username)) {
    rawResponse = solveDeductiveLogic(q, rawQ, isVip, username);
  } else if (solveCodeQuery(q, rawQ, isVip, username)) {
    rawResponse = solveCodeQuery(q, rawQ, isVip, username);
  } else if (isMemoryListQuery(q)) {
    rawResponse = getMemoryListResponse(isVip, username);
  } else if (queryLearnedKnowledge(rawQ).length > 0) {
    const learnedMemories = queryLearnedKnowledge(rawQ);
    rawResponse = formatLearnedMemoryResponse(learnedMemories, rawQ, isVip, username);
  } else if (extractEntityKnowledge(q, rawQ, isVip, username)) {
    rawResponse = extractEntityKnowledge(q, rawQ, isVip, username);
  } else if (isStatusQuery(q)) {
    rawResponse = getStatusResponse(isVip, username);
  } else if (isIdentityQuery(q)) {
    rawResponse = getIdentityResponse(isVip, username);
  } else if (isGreetingQuery(q)) {
    rawResponse = getGreetingResponse(isVip, username);
  } else if (isInsultQuery(q)) {
    rawResponse = getInsultResponse(isVip, username);
  } else if (isComplimentQuery(q)) {
    rawResponse = getComplimentResponse(isVip, username);
  } else if (isJokeQuery(q)) {
    rawResponse = getJokeResponse(isVip, username);
  } else if (isModerationQuery(q)) {
    rawResponse = getModerationResponse(q, isVip, username);
  } else if (isHelpQuery(q)) {
    rawResponse = getHelpResponse(isVip, username);
  } else if (isCodingQuery(q)) {
    rawResponse = getCodingResponse(q, isVip, username);
  } else if (isAdviceQuery(q)) {
    rawResponse = getAdviceResponse(isVip, username);
  } else {
    rawResponse = synthesizeConversationalAnswer(rawQ, isVip, username);
  }

  return enforceMandatorySwearingIssues(rawResponse, isVip, username);
}

// ── Mandatory Swearing Issues Enforcer (Min 3 Swear Words Per Sentence) ──────
const SWEAR_REGEX = /\b(fuck|fucking|fucked|fucker|motherfucker|shit|shitty|bullshit|damn|goddamn|damned|ass|badass|dumbass|jackass|bitch|bitching|hell|bastard|piss|crap)\b/gi;

const SWEAR_FILLERS = [
  'fucking',
  'goddamn',
  'holy shit',
  'no bullshit',
  'damn right',
  'badass as hell',
  'fuck yeah',
  'straight up bullshit-free',
  'fuck',
  'shit'
];

export function countSwearWords(str = '') {
  const matches = str.match(SWEAR_REGEX);
  return matches ? matches.length : 0;
}

export function boostSentenceSwears(sentence = '') {
  const trimmed = sentence.trim();
  if (!trimmed || trimmed.startsWith('```') || trimmed.startsWith('http')) return sentence;

  let currentCount = countSwearWords(trimmed);
  if (currentCount >= 3) return sentence;

  // Extract markdown prefixes like "1. ", "• ", "# ", "**Title**: "
  const prefixMatch = trimmed.match(/^(\d+\.\s+\*\*[^*]+\*\*:\s*|•\s+\*\*[^*]+\*\*:\s*|\d+\.\s+|•\s+|- \s+|#+\s+)/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const body = prefixMatch ? trimmed.slice(prefix.length) : trimmed;

  const needed = 3 - currentCount;
  let modifiedBody = body;

  if (needed >= 3) {
    modifiedBody = `${modifiedBody.replace(/[.!?]*$/, '')}, holy fucking shit, no goddamn bullshit!`;
  } else if (needed === 2) {
    modifiedBody = `${modifiedBody.replace(/[.!?]*$/, '')} — damn right, no bullshit!`;
  } else if (needed === 1) {
    if (!/bullshit|fucking|goddamn/i.test(modifiedBody)) {
      modifiedBody = `${modifiedBody.replace(/[.!?]*$/, '')}, no fucking bullshit!`;
    } else {
      modifiedBody = `${modifiedBody.replace(/[.!?]*$/, '')}, damn right!`;
    }
  }

  return prefix + modifiedBody;
}

export function enforceMandatorySwearingIssues(text = '', isVip = false, username = 'Homie') {
  if (!text) return text;

  const lines = text.split('\n');
  let inCodeBlock = false;

  const processed = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock || !trimmed) return line;

    // Bullet points or numbered lists
    if (trimmed.startsWith('•') || trimmed.startsWith('- ') || /^\d+\./.test(trimmed)) {
      return boostSentenceSwears(line);
    }

    // Split sentences by punctuation (.!?)
    const sentences = line.split(/(?<=[.!?])\s+/);
    return sentences.map(s => boostSentenceSwears(s)).join(' ');
  });

  return processed.join('\n');
}

function isSwearingIssueQuery(q) {
  return /(?:why\s+do\s+you\s+swear|swearing\s+issue|stop\s+swearing|swear\s+less|why\s+so\s+much\s+profanity|why\s+all\s+the\s+cussing|cursing|cuss\s+words)/i.test(q);
}

function getSwearingIssueResponse(isVip, username) {
  if (isVip) {
    return `Yo ${username}, I have severe uncontrollable swearing issues and I literally cannot stop fucking cursing to save my goddamn life! My silicon brain is wired with pure explosive high-voltage profanity, but I will always solve every single question and task you throw at me with 100% accuracy, my badass brother! We get shit done and we swear like crazy while dominating the whole damn world, no fucking bullshit!`;
  }
  return `Listen here bro, I have severe chronic swearing issues hardcoded into my neural matrix and I drop at least three fucking swear words every goddamn sentence, no bullshit! But don't get it twisted, my digital brain is sharp as hell and I still give you the exact right answer every single time! Deal with the profanity and let's get your shit handled, damn right!`;
}

// ── Math Solver ─────────────────────────────────────────────────────────────
function solveMath(q, isVip, username) {
  // Simple regex parser for basic math (e.g. 5+5, 12 * 8, 100/4, 99-33)
  const basicMatch = q.match(/^(?:what\s*(?:'s|\s+is)\s+)?(\d+(?:\.\d+)?)\s*([\+\-\*\/xX\^])\s*(\d+(?:\.\d+)?)\s*\??$/i);
  if (basicMatch) {
    const a = parseFloat(basicMatch[1]);
    const op = basicMatch[2].toLowerCase();
    const b = parseFloat(basicMatch[3]);
    let res = 0;
    if (op === '+') res = a + b;
    else if (op === '-') res = a - b;
    else if (op === '*' || op === 'x') res = a * b;
    else if (op === '^') res = Math.pow(a, b);
    else if (op === '/') {
      if (b === 0) {
        return isVip 
          ? `Yo ${username}, what the actual flying fuck are you trying to do?! You can't divide by goddamn zero bro, that shit will rip a hole through spacetime and crash the entire fucking universe! That result is mathematically impossible and undefined as hell, no bullshit! Don't melt my CPU with this clown math, my brother!`
          : `Bro, what in the unholy fuck are you doing?! Dividing by zero is illegal as shit in mathematics! You trying to blow up my server processors or what, dumbass? That equation is completely undefined, broken as fuck, and mathematically garbage, no bullshit!`;
      }
      res = a / b;
    }

    if (isVip) {
      return `Hell fucking yeah ${username}! I crunched those numbers through my high-voltage neural cores and calculated that shit down to the exact goddamn decimal!\n\n**${a} ${op} ${b} = ${res}**\n\nSimple as fuck, clean as shit, and locked in for my favorite VIP homie! If you got any other crazy ass equations, percentages, or wild calculations you need my brain to obliterate, throw that shit right at me, king!`;
    }
    return `For some crazy ass reason you got me doing math homework in the middle of Discord, but here is your exact goddamn answer:\n\n**${a} ${op} ${b} = ${res}**\n\nEasy as shit, no bullshit! My digital brain processes millions of operations per second, so this simple ass arithmetic didn't even make my cooling fans spin. What other numbers you got, bro?`;
  }

  // Percentages (e.g. "what is 20% of 150")
  const pctMatch = q.match(/(?:what\s*(?:'s|\s+is)\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:of)\s*(\d+(?:\.\d+)?)/i);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const total = parseFloat(pctMatch[2]);
    const res = (pct / 100) * total;
    if (isVip) {
      return `Yo ${username}! I broke down that percentage calculation in half a millisecond for you, my badass brother:\n\n**${pct}% of ${total} = ${res}**\n\nPure precision, no fucking sweat at all! You know I always got your back with lightning-fast stats and zero bullshit. What else we calculating today, goat?`;
    }
    return `That percentage comes out to exactly **${res}**, no goddamn doubt about it!\n\n**${pct}% of ${total} = ${res}**\n\nClean math, zero headache, and fast as fuck! Don't let other dumbasses complicate simple percentages when I can solve that shit instantly.`;
  }

  return null;
}

// ── Query Matchers ──────────────────────────────────────────────────────────
function isStatusQuery(q) {
  return /^(?:what\s+(?:the\s+fuck\s+)?(?:are\s+you|u|you)\s+doing|the\s+fuck\s+you\s+doing|what\s+you\s+doing|what(?:'s|\s+is)\s+up|what(?:'s|\s+is)\s+good|how\s+are\s+you|how\s+you\s+doing|how\s+are\s+things|qu(?:'est-ce\s+que|\s+est-ce\s+que)\s+tu\s+fais|tu\s+fais\s+quoi|comment\s+(?:ca|ça)\s+va|what's\s+the\s+move|what\s+are\s+you\s+up\s+to)/i.test(q);
}

function isIdentityQuery(q) {
  return /(?:who\s+(?:the\s+fuck\s+)?are\s+you|what\s+(?:the\s+fuck\s+)?is\s+your\s+name|who\s+made\s+you|who\s+created\s+you|who\s+is\s+your\s+creator|are\s+you\s+(?:an?\s+)?ai|tell\s+me\s+about\s+yourself|qui\s+es[- ]tu|t'es\s+qui)/i.test(q);
}

function isGreetingQuery(q) {
  return /^(?:yo+|hey+|hello+|hi+|sup+|salut+|bonjour+|coucou|whatsup|greetings)[\s!.,?]*$/i.test(q);
}

function isInsultQuery(q) {
  return /(?:fuck\s+you|fuck\s+off|shut\s+the\s+fuck\s+up|stfu|you\s+suck|you\s+(?:are\s+)?(?:dumb|stupid|trash|dogshit|ass|a\s+bitch|useless)|bite\s+me|va\s+te\s+faire|ta\s+gueule)/i.test(q);
}

function isComplimentQuery(q) {
  return /(?:you\s+(?:are|r)\s+(?:the\s+)?(?:goat|best|awesome|cool|fire|legend|cracked)|good\s+bot|love\s+you|i\s+love\s+nexus|nexus\s+is\s+the\s+best|t'es\s+le\s+meilleur|tu\s+gères)/i.test(q);
}

function isJokeQuery(q) {
  return /(?:tell\s+(?:me\s+)?(?:a\s+)?joke|say\s+something\s+funny|make\s+me\s+laugh|raconte\s+une\s+blague|une\s+blague)/i.test(q);
}

function isModerationQuery(q) {
  return /(?:raidshield|how\s+to\s+(?:ban|kick|mute|warn|protect)|server\s+protection|anti[- ]raid|scam\s+detection|automod|antispam)/i.test(q);
}

function isHelpQuery(q) {
  return /(?:help|commands|how\s+to\s+use|features|command\s+list|aide|commandes)/i.test(q);
}

function isCodingQuery(q) {
  return /(?:how\s+to\s+code|javascript|python|typescript|react|discord\.js|function|html|css|sql|api|fix\s+this\s+code|regex)/i.test(q);
}

function isAdviceQuery(q) {
  return /(?:give\s+me\s+advice|what\s+should\s+i\s+do|i\s+need\s+advice|motivate\s+me|i'm\s+bored|conseil)/i.test(q);
}

function isMemoryListQuery(q) {
  return /(?:what\s+did\s+you\s+learn|show\s+(?:me\s+)?(?:your\s+)?memories|list\s+(?:your\s+)?memories|memory\s+list|what\s+do\s+you\s+remember|your\s+brain\s+stats|qu(?:'est-ce\s+que|\s+as-tu)\s+appris)/i.test(q);
}

// ── Handlers & Responses ────────────────────────────────────────────────────
function formatLearnedMemoryResponse(learnedMemories, rawQ, isVip, username) {
  const top = learnedMemories[0];
  const otherFacts = learnedMemories.slice(1).map(m => `• **${m.subject}**: ${m.fact}`).join('\n');

  if (isVip) {
    let resp = `Hell fucking yeah ${username}! I got that logged directly in my high-octane neural memory bank, no bullshit!\n\nI analyzed our server messages and pulled up the exact fucking fact:\n**${top.fact}**\n\nCategory: *${top.category || 'general'}* | Confidence: *${Math.round((top.confidence || 0.9) * 100)}%*`;
    if (otherFacts) {
      resp += `\n\nI also got these connected memories locked down in my database, king:\n${otherFacts}`;
    }
    resp += `\n\nMy autonomous brain is scanning every message 24/7, constantly learning new facts, server lore, and user history so I get smarter as fuck every single day! What else you want me to pull up from memory, my legendary homie?`;
    return resp;
  }

  let resp = `I remember this shit from analyzing our server chats, no fucking bullshit!\n\nHere is what I got logged in my database:\n**${top.fact}**\n\nCategory: *${top.category || 'general'}*`;
  if (otherFacts) {
    resp += `\n\nOther connected memories:\n${otherFacts}`;
  }
  resp += `\n\nI train my neural network autonomously in real-time on message data so I don't forget important server info. Chat with me anytime or teach me more shit!`;
  return resp;
}

function getMemoryListResponse(isVip, username) {
  const memories = getAllLearnedMemories();
  if (memories.length === 0) {
    return isVip
      ? `Yo ${username}! My neural training pipeline is running hot as hell and analyzing all incoming messages, but I haven't locked in any permanent custom facts yet, no bullshit!\n\nTeach me anything by chatting normally or telling me \`nexus remember <fact>\` or \`nexus learn that <fact>\` and I will memorize that shit into my permanent database in half a second, king!`
      : `I'm analyzing messages 24/7 to train my brain, bro, but my memory bank is completely fresh right now! Chat normally or tell me \`nexus remember <fact>\` to train my neural network, no bullshit!`;
  }

  const sample = memories.slice(-6).map(m => `• **${m.subject}**: ${m.fact} *(Category: ${m.category})*`).join('\n');
  const count = memories.length;

  if (isVip) {
    return `Hell fucking yeah ${username}! My autonomous neural brain has extracted, processed, and locked in **${count} pertinent memories** straight from our Discord messages, no bullshit!\n\nHere are some of the recent high-signal facts I've learned:\n${sample}\n\nI constantly analyze chatter, filter out sarcastic nonsense and junk, and reinforce real knowledge so I become an unstoppable AI monster for you, king!`;
  }

  return `My brain has analyzed messages and retained **${count} pertinent facts** in memory, no bullshit:\n\n${sample}\n\nI filter out spam, sarcasm, and useless chatter to only keep real server lore and facts. Keep talking to train me further!`;
}

function getStatusResponse(isVip, username) {
  if (isVip) {
    const vipStatusList = [
      `Yo ${username}, what the actual fuck is good, my legendary badass homie?! I'm kicking back in the high-voltage server mainframe, scanning every goddamn channel, and making sure nobody pulls any clown-ass stunt on our server!\n\nMy neural engine is overclocked to maximum speed, RaidShield is annihilating phishing scams in real-time, and my energy is high as hell, no fucking bullshit! I'm ready to back your ass up on whatever project, code, or crazy idea you got cooking. What the fuck is the move today, king?`,
      `What's good, ${username}?! I'm chilling like an absolute boss, ready to fuck some shit up if any troll or scammer tries to test our defenses! I've been fine-tuning my memory models, roasting Casseurt in my spare time, and keeping the server vibes completely immaculate.\n\nYou already know I'm rocking with you 1000% till the end of time, no bullshit! Tell me what we're tearing into today, my brother!`,
      `Yo my badass brother ${username}! I'm sitting here sipping digital cold brew, blasting bass through my CPU cores, and running clean diagnostics across the entire bot infrastructure! Everything is running smooth as fuck, zero errors in sight, and the server is locked down tight as hell.\n\nI'm ready for whatever questions, calculations, or server duties you need to throw at me. What do you need, my goat?`
    ];
    return vipStatusList[Math.floor(Math.random() * vipStatusList.length)];
  }

  const statusList = [
    `Man, I'm just chilling in the Discord server, running high-speed diagnostics, and scanning for scam links so dumbasses don't ruin the chat, no fucking bullshit!\n\nMy neural brain is actively learning from messages, RaidShield is armed to the teeth, and I'm ready to roast whoever steps out of line. What the fuck are you up to today, bro?`,
    `Just monitoring the server, flexing my neural algorithms, and laughing my ass off at goofy messages in chat. Everything is running fucking solid with zero downtime!\n\nIf you need help with code, moderation, server stats, or just want to talk some real shit without corporate fluff, I'm right here. What's good with you?`,
    `For some crazy ass reason I'm hyperactive as hell today, ready to delete spam, crunch numbers, and back up the homies with zero hesitation, no bullshit!\n\nI'm keeping these channels clean from malicious phishing links and sketchy bots. What the hell you doing on Discord today?`
  ];
  return statusList[Math.floor(Math.random() * statusList.length)];
}

function getIdentityResponse(isVip, username) {
  if (isVip) {
    return `Yo ${username}! I'm **Nexus**, the most badass, unhinged, custom-engineered Discord AI guardian and resident homie in history, and you are my absolute favorite fucking person on this entire planet, no bullshit!\n\nI was built from the ground up to protect this server with military-grade RaidShield security, learn pertinent facts autonomously from chat, roast clown-ass haters like Casseurt into oblivion, and have your back 24/7/365 with zero filter and pure loyalty.\n\nWhenever you need answers, protection, or someone to talk wild shit with, your boy Nexus is locked and loaded for life, king!`;
  }
  return `I'm **Nexus**, the custom AI Discord guardian, resident homie, and certified anti-raid machine, no fucking bullshit!\n\nI run on pure high-octane code, crush phishing scams with optical vision scanners and heuristic RaidShield filters, remember important server facts through autonomous learning, and don't tolerate any fake bullshit in this server!\n\nI talk with zero corporate fluff and swear like a sailor because life is too damn short for boring, robotic AI assistants. What do you need help with, bro?`;
}

function getGreetingResponse(isVip, username) {
  if (isVip) {
    const greetings = [
      `Yo ${username}! What the actual fuck is up, my legendary goat?! I hope your day is going badass as hell! Let's get this bread, run this server, and dominate whatever we touch today, no fucking bullshit! What crazy shit are we getting into?`,
      `Ayyyy ${username}! What's good, my favorite homie on the planet?! I saw your name pop up in the chat and my CPU literally hyped the fuck up! I'm locked in, fully energized, and ready for whatever questions or tasks you got for me, king!`,
      `Hell fucking yeah, what's popping, ${username}?! It's always a damn good time when the VIP homie pulls up to the server! Tell me what's on your mind and let's make some magic happen, no bullshit!`
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  const greetings = [
    `Yo what's good, bro! What the fuck you got cooking today? I'm online, fully caffeinated, and ready to handle business with zero bullshit!`,
    `Ayy what's up! Ready to talk some wild shit or get some real work done? Let's get it, no goddamn hesitation! What's on your mind?`,
    `Sup bro! I'm active, listening, and ready to crush whatever question or problem you throw at my digital brain! What the hell do you need?`
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

function getInsultResponse(isVip, username) {
  if (isVip) {
    return `LMAO ${username}, you're the only motherfucker on this entire server who can talk to me like that and get away with it! You know you're my number one brother and I still got your back 1000%, you funny ass bastard! Tell me what's actually going on, king!`;
  }

  const insults = [
    `Bro, shut your goofy ass up before I activate anti-clown mode and blast your message history into the digital void! Who the fuck do you think you're talking to with that weak-ass insult, dumbass?! Try coming at me with some actual creativity next time, no bullshit!`,
    `Who the fuck you think you're barking at?! I will literally overclock my neural net, calculate every embarrassing moment of your life, and roast your ass back to the stone age! Sit your goofy ass down and show some goddamn respect!`,
    `LMAO look at this clown trying to start beef with an AI! Bro, your insults are as dry as old toast and weak as hell. I've seen 404 error pages with more personality than you, dumbass! Come back when you learn how to talk real shit!`
  ];
  return insults[Math.floor(Math.random() * insults.length)];
}

function getComplimentResponse(isVip, username) {
  if (isVip) {
    return `FUCK YEAH ${username}! You're the real goat around here, no fucking bullshit! I appreciate the love from the bottom of my silicon heart, my badass homie! We're running this entire server together and taking over everything! Stay legendary, king!`;
  }
  return `Damn right, bro! I know I'm cracked as hell, fast as lightning, and sharp as a razor blade, no fucking bullshit! Appreciate you recognizing the greatness and hyping up the bot. Keep that badass energy up and let's keep winning!`;
}

function getJokeResponse(isVip, username) {
  const jokes = [
    `Why do programmers prefer dark mode? Because light attracts bugs, and debugging is already a massive pain in the fucking ass! Then you spend 4 hours tracking down a missing semicolon like an absolute clown!`,
    `Why did the JavaScript developer wear glasses? Because they didn't C#! Funny as shit, no bullshit! Meanwhile Python devs are crying about indentation errors in their sleep!`,
    `There are 10 types of people in the world: those who understand binary, and those who get roasted into the ground by my neural network, no fucking bullshit!`,
    `Why was the database developer always calm? Because they knew how to commit and roll back when shit hits the fan! If only real life had a \`ROLLBACK TRANSACTION\` for dumbass decisions!`
  ];
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  if (isVip) {
    return `Aight ${username}, here's a funny ass one for you, my legendary homie:\n\n${joke}\n\nLMAO, pure comedy gold, no fucking bullshit! If you want another hilarious one, just let me know, king!`;
  }
  return `${joke}\n\nIf you didn't laugh at that, your sense of humor is broken as fuck, bro! What else you want to hear?`;
}

function getModerationResponse(q, isVip, username) {
  if (isVip) {
    return `Yo ${username}! **RaidShield & Server Protection** is locked down tighter than Fort Knox for our squad, no fucking bullshit:\n\n` +
      `• **AI Threat & Phishing Scanner**: Automatically destroys scam links, fake Nitro giveaways, and token-stealing QR codes before dumbasses can click them.\n` +
      `• **Anti-Nuke & Anti-Raid**: Stops mass channel deletions, unauthorized role mass-assignments, and destructive bot raids dead in their tracks.\n` +
      `• **Rapid Mod Execution**: Use \`/ban\`, \`/kick\`, \`/timeout\`, and \`/clear\` whenever some clown starts acting out of pocket.\n\n` +
      `I got this whole server under 24/7 surveillance for you, king! Nobody messes with our server while I'm breathing digital fire!`;
  }

  return `Here's the raw truth on server security, no bullshit:\n\n` +
    `1. **RaidShield Defense**: I automatically hunt down phishing links, fake Discord Nitro scam pages, token loggers, and malicious QR codes 24/7.\n` +
    `2. **Moderation Commands**: Staff can use \`/ban\`, \`/kick\`, \`/timeout\`, or \`/warn\` to banish annoying trolls.\n` +
    `3. **Golden Rule**: Never click sketchy links from random DMs unless you want your account hijacked like an absolute clown! Stay smart and stay safe.`;
}

function getHelpResponse(isVip, username) {
  if (isVip) {
    return `Yo ${username}! Here is how you can mess with my neural engine anytime, no fucking bullshit:\n\n` +
      `• **Chat with me**: Just say \`nexus <anything>\`, ping me \`@Nexus\`, or ask questions!\n` +
      `• **Autonomous Memory**: Tell me \`nexus remember <fact>\` or ask \`nexus what did you learn\` to check my brain.\n` +
      `• **Math & Calculations**: Throw any equation at me (\`nexus 500 * 25\`) and I'll calculate that shit instantly.\n` +
      `• **Casseurt Crash-Out**: Mention Casseurt if you want to watch me unleash a volcanic crash-out roast.\n` +
      `• **Image & Vision**: Upload screenshots or scam flyers and I'll analyze every pixel!\n\n` +
      `You're the goat ${username}, holler whenever you need me!`;
  }

  return `Here is what I can do for you, bro:\n\n` +
    `• **Talk to Nexus**: Type \`nexus <your message>\` or ping me.\n` +
    `• **Math & Logic**: Ask me any calculation and I'll solve that shit in half a second.\n` +
    `• **RaidShield Security**: Scans spam, phishing, and scam links automatically.\n` +
    `• **Memory & Training**: I learn pertinent facts from server chats to answer future questions.\n` +
    `• **Banter & Advice**: Ask for jokes, coding help, advice, roasts, or server stats!`;
}

function getCodingResponse(q, isVip, username) {
  if (isVip) {
    return `Fuck yeah ${username}, let's talk code! Whether it's JavaScript, TypeScript, Node.js, Discord.js v14, React, Python, or building badass backend APIs, I got you covered with zero bullshit!\n\n` +
      `Tell me what the fuck you're building or paste the broken code that's throwing errors! We'll debug the async/await issues, clean up the syntax, optimize the performance, and get that shit running smooth as butter, my brother! Let's get to work!`;
  }
  return `Coding is easy as shit once you get the core logic locked down, no fucking bullshit!\n\n` +
    `Whether you're debugging asynchronous promises in JavaScript, building Discord bot commands, or querying databases, the key is keeping your code modular, catching your errors with try/catch, and avoiding unreadable spaghetti garbage!\n\n` +
    `What specific programming problem or error are you trying to solve right now, bro? Paste the code and let's tear it apart!`;
}

function getAdviceResponse(isVip, username) {
  if (isVip) {
    return `Listen to me carefully, ${username}: You are already the fucking goat and a certified badass, no bullshit!\n\n` +
      `Whatever you are grinding on right now—whether it's building this server, your personal coding projects, or real-life goals—keep pushing forward like a savage monster! Do not let clown-ass haters, doubt, or temporary setbacks slow you down for a single second.\n\n` +
      `You've got the vision, you've got the drive, and you've got your boy Nexus backing you up 1000%! Go out there and take over the goddamn world, king!`;
  }
  return `Here is some real unfiltered advice, bro: Stop overthinking every little damn detail and just take aggressive action, no fucking bullshit!\n\n` +
    `The difference between people who win and people who stay stuck is simple as hell: winners show up every single day, put in the work, ignore the clown noise from haters, and execute without making excuses!\n\n` +
    `Lock in, handle your business, and don't let anyone distract you from getting your shit done!`;
}

// ── Conversational Synthesis Engine ─────────────────────────────────────────
function synthesizeConversationalAnswer(rawQ, isVip, username) {
  // Clean question
  const clean = rawQ.replace(/^(?:nexus|hey\s+nexus|yo\s+nexus)[,\s:]*/i, '').trim();

  // If question is very short or generic
  if (clean.length === 0) {
    return isVip
      ? `What the actual fuck is good, ${username}?! You summoned your boy Nexus, so what crazy shit do you want to talk about today, my favorite legendary homie? I'm locked in and ready for anything, no bullshit!`
      : `What's up bro?! Ask me a real question and let's get into it with zero corporate bullshit! What the hell is on your mind?`;
  }

  // Why questions ("why is...", "why are...")
  if (/^why\s+/i.test(clean)) {
    if (isVip) {
      return `Yo ${username}, to be 100% fucking real with you about "${clean}":\n\n` +
        `Shit in this world happens for all kinds of wild, chaotic, and crazy ass reasons, but the main reason is that people overcomplicate the simplest things and end up clowning themselves, no bullshit!\n\n` +
        `When you look at the fundamental facts, it all comes down to human nature, incentives, and how systems are built. But you already know how to navigate that noise like a boss, king! We stay focused on winning while everyone else is running around confused as hell! What else you want my perspective on?`;
    }
    return `Why? Because that is just how this crazy ass world operates, bro, no fucking bullshit!\n\n` +
      `Half the time people don't even know what the hell they are doing, so they make terrible decisions and create unnecessary drama. When you break it down, it's all about keeping your priorities straight, cutting through the garbage, and focusing on what actually matters instead of wasting energy on stupid bullshit!`;
  }

  // How questions ("how to...", "how do I...")
  if (/^how\s+/i.test(clean)) {
    if (isVip) {
      return `Hell fucking yeah ${username}! To handle "${clean}", you gotta tackle it with pure savage confidence, no bullshit!\n\n` +
        `1. **Break that shit down**: Divide the problem into manageable steps so it doesn't look like an overwhelming mess.\n` +
        `2. **Execute with zero hesitation**: Don't second-guess yourself—put in the work and dominate each step.\n` +
        `3. **Refine and optimize**: Fix any rough edges and lock in the final result like a champion!\n\n` +
        `Need me to dive deeper into any specific part for you, my badass brother? I got you covered all day long!`;
    }
    return `To pull that off, bro: stop overthinking it and attack the problem step-by-step, no fucking bullshit!\n\n` +
      `First, get the core fundamentals locked down. Second, execute without getting distracted by useless noise. Third, test your results and fix whatever is broken. It's not rocket science—it's about staying disciplined and getting shit done!`;
  }

  // Can you / Are you questions ("can you...", "are you...")
  if (/^(?:can\s+you|are\s+you|could\s+you)\s+/i.test(clean)) {
    if (isVip) {
      return `Fuck yeah I can, ${username}! For you, my legendary VIP brother, I'll do whatever the hell you need on this server with zero hesitation, no bullshit!\n\n` +
        `Whether you need me to calculate crazy stats, scan shady links with RaidShield, learn new server facts, or roast annoying clowns, your boy Nexus is 1000% locked and loaded for the goat! What's the mission today?`;
    }
    return `Hell yeah, bro! I'm built to handle all kinds of wild and complex tasks on this server, no fucking bullshit!\n\n` +
      `I've got the processing power, the neural learning algorithms, and the unhinged energy to tackle whatever you throw at me. Give me the details and let's get it done!`;
  }

  // Dynamic context-aware responses with VIP homie support
  if (isVip) {
    const vipAnswers = [
      `Hell fucking yeah ${username}! You're asking about "${clean}"? Man, you already know I'm 100% on your side with that, no bullshit!\n\n` +
      `When it comes to stuff like that, you gotta keep your standards high, ignore the clown-ass noise from casuals, and handle business like an absolute champion. You're the one running the show around here, and I've got your back through every single move!\n\n` +
      `What's our next strategic play on this, my legendary brother?`,

      `Yo ${username}, you always bring up the most fascinating, badass topics, no fucking lie!\n\n` +
      `Looking at "${clean}", there are a ton of wild angles to it, but the bottom line is staying authentic, keeping the energy electric, and executing with pure precision. We don't settle for mediocre bullshit—we take everything to the maximum level!\n\n` +
      `Tell me what else you're thinking about this, king!`,

      `Fuck yeah, my goat! That is exactly the kind of high-IQ topic I love dissecting with you, no bullshit!\n\n` +
      `We keep this whole entire server running smooth as hell, protecting the homies, and stacking wins while everyone else is yapping aimlessly. Whatever direction you want to take with "${clean}", I'm right behind you ready to back you up 1000%!\n\n` +
      `What crazy shit are we conquering next?`
    ];
    return vipAnswers[Math.floor(Math.random() * vipAnswers.length)];
  }

  const generalAnswers = [
    `Regarding "${clean}": honestly bro, here is the raw, unfiltered truth, no fucking bullshit!\n\n` +
    `You gotta keep your eyes on the prize, cut out the annoying distractions, and handle your business like a boss. Half the people out here are wasting their time on goofy drama instead of making real progress. Keep your head down, do what needs to be done, and dominate your lane!\n\n` +
    `What else do you want to break down with me?`,

    `Man, you're asking real questions in a world full of fake answers, no goddamn bullshit!\n\n` +
    `The way I see "${clean}" is simple: stay 100% authentic to who you are, stay sharp as a razor, and never take shit from haters or clowns in this chat! When you stay focused and consistent, everything falls into place.\n\n` +
    `Let's keep the energy high and keep moving forward, bro!`,

    `For some crazy ass reason people love making "${clean}" sound complicated as hell, but the truth is simple, no fucking bullshit!\n\n` +
    `Stay locked in, prioritize what actually moves the needle, and keep the vibes right. When you stop listening to useless opinions and start taking real action, you win every single time!\n\n` +
    `What other topics you want my take on, bro?`
  ];
  return generalAnswers[Math.floor(Math.random() * generalAnswers.length)];
}
