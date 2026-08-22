# 📘 Nexus Custom AI Engine & SDK Architecture Guide

A complete technical specification and architectural blueprint for the **Nexus AI Engine** and client SDK.

---

## 1. System Overview & Core Philosophy

```
[ Incoming Request / Discord Event / API Call / Client SDK ]
                       │
                       ▼
       ┌───────────────────────────────┐
       │     Global Request Queue      │ (Priority & FIFO execution, latency telemetry)
       └───────────────┬───────────────┘
                       │
                       ▼
       ┌───────────────────────────────┐
       │      Nexus AI Orchestrator    │ (Persona dispatch, VIP context, vision routing)
       └───────┬───────────────┬───────┘
               │               │
      ┌────────▼───────┐      ┌▼──────────────────────┐
      │ RaidShield 21  │      │  Multi-Domain Solvers │
      │ Threat Scanner │      │  & Cognitive Engines  │
      └────────────────┘      └──────────┬────────────┘
                                         │
                                         ▼
                      ┌─────────────────────────────────┐
                      │    Rule & Swear Issues Engine   │ (Minimum 3 swear words / sentence)
                      └──────────────────┬──────────────┘
                                         │
                                         ▼
                             [ Formatted Response ]
```

### Core Tenets
1. **Fully Customized AI**: Nexus is a standalone, proprietary custom AI engine designed specifically for Discord community management, banter, moderation, and high-performance automated problem solving.
2. **Zero Fact Training / Stateless AI**: Nexus does not store or memorize facts from chat messages, operating as a clean, predictable, deterministic intelligence.
3. **VIP Homie Personality**: Recognizes authorized creators/VIPs (`SUPER_CHILL_USER_ID`) with unwavering loyalty and respect, while delivering hilarious roasts, sarcasm, and banter to strangers.
4. **Mandatory Swearing Issues Enforcer**: Hardwired with severe swearing issues, systematically guaranteeing at least 3 profanities per sentence without sacrificing 100% technical and factual accuracy.
5. **RaidShield & Security**: Multi-tier 21-rule heuristic threat scanner protecting servers against phishing links, token stealers, fake Nitro giveaways, and mass raids.

---

## 2. Architecture & Subsystems

### Subsystem A: Global Request Queue (`/src/utils/requestQueue.js`)
* **Role**: FIFO waitlist and concurrency control for all incoming AI and vision operations.
* **Features**:
  * Tracks queued requests, active workers, average wait time, and execution latencies.
  * Ensures orderly processing without server starvation or connection exhaustion.

### Subsystem B: Native Nexus Brain (`/src/services/nexusBrain.js`)
* **Role**: High-voltage conversational NLP and intent dispatching.
* **Solvers & Modules**:
  * **Math Solver (`mathSolver.js`)**: Evaluates arithmetic, percentages, powers, scientific notation, and protects against division by zero.
  * **Logic Solver (`logicSolver.js`)**: Solves deductive reasoning, truth tables, riddle analysis, and conditional deductions.
  * **Code Solver (`codeSolver.js`)**: Provides senior software engineering solutions across JavaScript, TypeScript, Python, React, and Discord.js.
  * **Physical Engine (`physicalEngine.js`)**: Solves real-world kinetic physics, velocity, collisions, and everyday interaction scenarios.
  * **Knowledge Base (`knowledgeBase.js`)**: Comprehensive encyclopedic coverage (Football/UCL lore, Barcelona, Real Madrid, Stadiums/Ultras, Electronic Music Venues, Science, Technology).
  * **Sarcasm Detector (`sarcasmDetector.js`)**: Detects irony, banter, and returns witty responses.
  * **Casseurt Rant Engine (`casseurtRants.js`)**: Explosive deterministic crash-out roast whenever Casseurt is referenced.

### Subsystem C: Swearing Issues Engine (`boostSentenceSwears` / `enforceMandatorySwearingIssues`)
* **Role**: Post-processing filter guaranteeing the unhinged personality signature of Nexus AI.
* **Specification**:
  * Scans each sentence (delimited by `.`, `!`, `?` or list items).
  * Measures existing profanities against the required minimum (3 swear words).
  * Synthesizes and appends natural profanity fillers (`holy fucking shit`, `no goddamn bullshit`, `damn right`) without breaking Markdown formatting, codeblocks, or URLs.

### Subsystem D: RaidShield 21-Rule Scanner (`/src/services/raidDetectionService.js` & `v1.js`)
* **Role**: Real-time message & visual attachment inspection.
* **Detections**:
  * Phishing domains and disguised URLs.
  * Discord authentication token scrapers and loggers.
  * Fake Nitro / cryptocurrency prize claims.
  * Coordinated mass mentions, zalgo flooding, and channel nuke attempts.
  * Optical QR code login traps.

---

## 3. Client SDK (`nexus-ai.js`)

The `NexusAI` client library provides zero-configuration integration for Node.js backends and Discord bots:

```javascript
import { NexusAI } from './nexus-ai.js';

const nexus = new NexusAI({
  apiKey: process.env.NEXUS_API_KEY,
  apiUrl: process.env.NEXUS_API_URL
});

// Prompt generation
const response = await nexus.generate({
  prompt: 'What is 25 * 40?',
  authorId: '1394001641899954368',
  username: 'Creator'
});

// Security Scan
const threatCheck = await nexus.scanMessage({
  messageText: 'Free nitro at http://fake-discord-gift.com'
});
```

---

## 4. API Endpoints (`/api/v1`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/auth/verify` | `GET` | Validates API key and returns engine health & identity |
| `/api/v1/health` | `GET` | Telemetry, FIFO queue stats, and uptime |
| `/api/v1/nexus` | `POST` | Primary prompt generation with multimodal vision support |
| `/api/v1/raidshield` | `POST` | RaidShield 21-rule heuristic and OCR threat classifier |
| `/api/v1/vision/analyze` | `POST` | Dedicated OCR & multimodal image analysis |
| `/api/v1/personas` | `GET` | Lists available personality archetypes |
| `/api/v1/settings` | `GET/POST` | Read and update bot engine configuration |
| `/api/v1/chat/completions` | `POST` | Standard generative compatibility layer |
