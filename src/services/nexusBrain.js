import { extractEntityKnowledge } from './knowledgeBase.js';
import { solveMathExpression } from './mathSolver.js';
import { solveCodeQuery } from './codeSolver.js';
import { solveDeductiveLogic } from './logicSolver.js';
import { solvePhysicalAction } from './physicalEngine.js';
import { detectSarcasm } from './sarcasmDetector.js';

/**
 * Autonomous Local Nexus Brain
 * Provides comprehensive offline intelligence, specialized solvers, and conversational reasoning.
 */
export function generateNexusBrainResponse(question = '', userContext = {}) {
  const isVip = userContext?.userId === '1394001641899954368' || Boolean(userContext?.isSuperChillUser);
  const username = userContext?.username || (isVip ? 'Bro' : 'Homie');
  const cleanQ = (question || '').trim();
  const lowerQ = cleanQ.toLowerCase();

  if (!cleanQ) {
    return isVip
      ? `What's good my fucking bro! How can I help your awesome ass today?`
      : `Yo bro, what's on your mind? Hit me with whatever you need!`;
  }

  // 1. Math & Arithmetic Expressions
  const mathResult = solveMathExpression(cleanQ, cleanQ, isVip, username);
  if (mathResult) return mathResult;

  // 2. Deductive Logic & Syllogisms
  const logicResult = solveDeductiveLogic(cleanQ, cleanQ, isVip, username);
  if (logicResult) return logicResult;

  // 3. Code Generation & Technical Solver
  const codeResult = solveCodeQuery(cleanQ, cleanQ, isVip, username);
  if (codeResult) return codeResult;

  // 4. Physical World & Everyday How-To Actions
  const physicalResult = solvePhysicalAction(cleanQ, cleanQ, isVip, username);
  if (physicalResult) return physicalResult;

  // 5. Knowledge Base (Sports, lore, science, history, geography, venues)
  const knowledgeResult = extractEntityKnowledge(lowerQ, cleanQ, isVip, username);
  if (knowledgeResult) return knowledgeResult;

  // 6. Sarcasm Detection Handler
  const sarcasm = detectSarcasm(cleanQ);
  if (sarcasm?.isSarcastic && sarcasm.confidence > 0.85) {
    if (isVip) {
      return `Haha I see that sarcasm dripping, ${username}! You're hilarious as shit, bro. But for real, what are we cooking today?`;
    }
    return `Nice sarcasm bro, but I see right through that! What's the real question?`;
  }

  // 7. Identity & Who Are You
  if (/who\s+(?:are\s+you|made\s+you|created\s+you)|what\s+are\s+you|what\s+is\s+nexus/i.test(lowerQ)) {
    if (isVip) {
      return `I am **Nexus AI**, the sovereign autonomous intelligence powering TitanBot! Built to give zero bullshit, maximum accuracy, and hold down the server for you, my legendary brother ${username}!`;
    }
    return `I am **Nexus AI**, an autonomous neural intelligence built for high-speed reasoning, moderation, sports lore, code, and zero bullshit answers.`;
  }

  // 8. Greetings & Casual Check-in
  if (/^(?:hey+|hello+|hi+|yo+|sup|what(?:'?s|\s+is)\s+up|salut|bonjour|coucou)[\s!.,?]*$/i.test(lowerQ)) {
    if (isVip) {
      return `What's good my favorite fucking homie ${username}! Ready to ball out or break down some stats today, king?`;
    }
    return `Yo! What's up bro? What can I help you with today?`;
  }

  // 9. Status & "How are you"
  if (/how\s+are\s+you|how(?:'s|\s+is)\s+it\s+going|how\s+do\s+you\s+feel/i.test(lowerQ)) {
    if (isVip) {
      return `Operating at 100% capacity with neural cores overclocked and ready to dominate, ${username}! How are you doing, my brother?`;
    }
    return `Running at peak efficiency, zero lag, zero bullshit. What's on your mind today?`;
  }

  // 10. Help & Capabilities
  if (/^(?:help|what\s+can\s+you\s+do|commands|features)[\s!?.]*$/i.test(lowerQ)) {
    return `Here is what my autonomous brain can handle with zero bullshit:\n\n` +
      `• **Math & Calculations**: Arithmetic, percentages, square roots, algebra.\n` +
      `• **Formal Logic**: Syllogisms, truth tables, boolean logic, deductions.\n` +
      `• **Coding & Tech**: Discord.js v14, JavaScript/Node, Python, algorithms.\n` +
      `• **Football & Sports Lore**: Barça, Real Madrid, Premier League, legends, trophies, stadiums.\n` +
      `• **Science & Reality**: Quantum mechanics, relativity, biology, networking.\n` +
      `• **Physical Kinematics**: Step-by-step physical how-to guides.\n\n` +
      `Ask me anything directly and I got you!`;
  }

  // 11. Conversational Default Fallback
  if (isVip) {
    return `Hell yeah ${username}! You're asking about **${cleanQ.slice(0, 50)}** — I got my high-speed neural cores dialed in on that with zero bullshit. Let's get into it, king!`;
  }

  return `Got it, bro! Looking into **${cleanQ.slice(0, 50)}** with zero bullshit. Hit me with any specific angles, stats, or questions on that!`;
}
