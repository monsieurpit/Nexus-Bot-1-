# Nexus Discord Bot — Audit & Hardening Report (November 2026)

Scope: the Discord bot only (`src/`, `scripts/`, `tests/`, `nexus-ai.js`, deployment files).
**Out of scope and not modified:** the website/dashboard (`dashboard/**`) and the separate
Nexus AI project (`monsieurpit/Nexus-AI-`, consulted read-only).

---

## 1. Architecture map (as implemented, not as documented)

| Layer | Where | Notes |
|---|---|---|
| Process entry (production) | `npm start` → `dashboard/server/index.js` → dynamic `import('src/app.js')` | One process runs the dashboard **and** the bot; `DISABLE_BOT_WEBSERVER=true` disables the bot's own Express server in that mode. |
| Process entry (bot only) | `npm run bot` → `src/app.js` | Bot serves `/health`, `/ready`, `/api/internal/*` (loopback or `INTERNAL_API_TOKEN`). |
| Commands | `src/commands/<Category>/*.js` (98 slash commands) | Loaded by `src/handlers/commandLoader.js`; `modules/` subfolders are dashboards/sub-handlers. |
| Events | `src/events/*.js` | `messageCreate` fans out to leveling, message coins, raid detection, scam detection, AI moderation, auto-slowmode, sticky notes, predictions, AFK, Nexus AI chat. |
| Interactions | `src/interactions/{buttons,selectMenus,modals}`, `src/handlers/*Buttons.js` | Routed by `customId` prefix before `:`; IDs without `:` are ignored by the router (used by inline collectors). |
| Services | `src/services/*.js` | Business logic (economy, leveling, moderation, RaidShield, tickets, football, backups…). |
| Data | `src/utils/database.js` (`DatabaseWrapper`) | **Firestore primary** → PostgreSQL fallback → in-memory last resort (non-persistent). 30 s read cache, invalidated on every write. |
| Scheduled jobs | `src/app.js#setupCronJobs` | Giveaways, VC events (1 min), counters (15 min), bot status (5 min), football + weekly summaries (30 min), standings (hourly), auto-save (daily), fixture sync (06:00 UTC). Each job is non-overlapping (`safeJob`). |

### Database priority (verified in code)
`DatabaseWrapper.initialize()` tries Firestore (`firebase-applet-config.json`, optional
`FIREBASE_AUTH_EMAIL/PASSWORD` sign-in, bounded by `FIRESTORE_CONNECT_TIMEOUT_MS`), then
PostgreSQL (`DATABASE_PUBLIC_URL` > `DATABASE_URL` > `POSTGRES_URL`), then `MemoryStorage`.
The startup log said "PostgreSQL > Memory fallback" — corrected to the real order.

---

## 2. Nexus AI dependency map

Nexus AI is reached **only over HTTP** through the SDK `nexus-ai.js` (a superset of the SDK in the
Nexus-AI- repo: it adds `unprompted/openMode/strike/replyTo` fields and `openCheck()`). Nexus AI
does **not** use Firestore (checked in the Nexus-AI- repo), so no bot database change can affect it.

| Bot component | Uses | Engine endpoint(s) |
|---|---|---|
| `nexus-ai.js` | SDK, `Authorization: Bearer` + `x-api-key` | all below |
| `src/services/nexusAiService.js` | chat replies, `voiced()` lines, `nexusClient` export; master switch `NEXUS_AI_CHAT_DISABLED` (**off unless `NEXUS_AI_CHAT_ENABLED=true`**) | `/nexus`, `/voice-line`, `/mood`, … |
| `src/services/aiModerationService.js` | RaidShield AI scanning | `POST /raidshield` (`checkSecurity`), `POST /raidshield/analyze` with `x-raidshield-key` (`analyzeThreat`) |
| `nexusJumpInService`, `nexusOpenModeService`, `nexusReactService`, `memoryBrainService`, `channelHistoryService`, `aiTelemetryService` | chat features (inactive while the switch is off) | `/nexus`, `/nexus/open-check`, `/learning/reaction` |
| `src/events/ready.js` | mood presence (skipped while switch is off) | `/mood` |
| `src/events/message{Create,Update,Delete,DeleteBulk,ReactionAdd}.js` | trigger chat / AI moderation / history | — |
| `src/commands/Moderation/raidshield.js`, `Tools/benchmark.js`, `Tools/status.js` | config UI, benchmarks, voiced status line | — |
| `dashboard/server/routes/v1.js`, `codeedit.js` (website, untouched) | relay to the engine | — |

Environment: `NEXUS_API_URL`, `NEXUS_API_KEY` (or `API_KEY`), `NEXUS_RAIDSHIELD_KEY`,
`NEXUS_AI_CHAT_ENABLED`, `NEXUS_JUMPIN`, `SUPER_CHILL_USER_ID`.
AI-related DB keys: `nexus:ai:disabled:<id>`, `nexus:memory:<userId>`, `nexus:openmode:<guildId>`.

**Compatibility:** `nexus-ai.js` and `nexusAiService.js` were not modified; the two RaidShield SDK
calls keep the same endpoints, payloads and headers. Only the bot's interpretation of results
changed (see §4.1). Live engine behaviour could not be tested because the engine is offline.

---

## 3. Findings (prioritised)

### CRITICAL
1. **RaidShield AI failed open.** When the engine was unreachable, `analyzeContent()` returned
   `{ classification: 'safe', confidence: 0.95, reason: 'Adheres to safe server guidelines' }` —
   indistinguishable from a real clean verdict. *(fixed)*
2. **Failed database reads overwrote real data.** `DatabaseWrapper.get()` reports a failed read
   as "not found". Every read-modify-write (economy balances, XP/levels, guild config, economy
   config, join-to-create config) then wrote defaults back: one transient Firestore error during
   `/daily` turned a 10,000-coin balance into ~100; during any config save it replaced the
   server's entire configuration with defaults. *(fixed)*
3. **Failed writes were reported as successes.** Firestore/PostgreSQL `set()` return `false` on
   failure; almost every caller ignored it (members told a purchase or setting was saved when it
   wasn't). *(fixed — writes now throw `DatabaseWriteError`)*
4. **The primary database had no backups.** `backup:db`, `restore:db` and `backup:drill` only
   cover PostgreSQL (`pg_dump`), which is the *fallback*. *(fixed — Firestore backup/restore added)*

### HIGH
5. Shop: members were charged for roles they already owned; when role delivery failed they kept
   paying and were told "an admin has been notified" even when no admin role was configured. *(fixed)*
6. Economy two-step operations (pay, rob, buy-pack, open-pack) could lose or create coins if the
   second write failed; transfers accepted fractional amounts. *(fixed)*
7. `/massban`, `/masskick`, `/roleall`, `/restore` executed immediately — no preview/confirmation. *(fixed)*
8. `/roleall` let an Administrator give every member a role **above their own** position, or one
   carrying Administrator/Ban/Manage Roles (the bot bypasses Discord's own hierarchy rule). *(fixed)*
9. `/restore` crashed midway (after editing roles) on a snapshot without a category list. *(fixed)*
10. RaidShield configuration commands announced success even when the save failed. *(fixed)*
11. XP could be awarded twice for concurrent messages (cooldown checked outside the lock);
    level-up roles/announcements were sent before the new level was saved. *(fixed)*

### MEDIUM
12. Local scam filter false positives: duplicated keywords counted twice and everyday words
    ("honestly", "stake ") counted as scam signals. *(fixed)*
13. Cross-channel spam detection quarantined (28-day timeout) every member whose message was
    ~85 % similar within 3 s, including long-standing members who posted a common phrase once. *(fixed)*
14. `/rank` and `/leaderboard` showed the XP needed for the *next-next* level (~50 % too high) and
    `/rank` threw at the maximum level. *(fixed)*
15. Temporary join-to-create channels that emptied while the bot was offline/redeploying were
    never deleted. *(fixed)*
16. `/warn` had no self/bot/hierarchy checks (a moderator could warn an admin above them). *(fixed)*
17. Shutdown ran twice on SIGTERM+SIGINT, closed the DB while Discord events were still
    arriving, and had no hard timeout. `/health` always said "healthy". *(fixed)*
18. `/roleall` lost its final summary on large servers (interaction token expires after 15 min). *(fixed)*

### Security notes (documented, not changed — website scope)
- `dashboard/server/routes/v1.js` auto-registers **any** presented API key and grants VIP when the
  key merely *contains* `master`, `railway` or the owner's ID; it also hardcodes ten static keys
  (e.g. `nexus-dev-key`, `nexus_sk_live_a89f…`). Today this is **not reachable on its own**:
  `dashboard/server/auth.js#requireDashboardAuth` runs first and only admits a dashboard session
  or the exact `NEXUS_API_KEY`. It is still a latent authentication bypass if that outer
  middleware is ever removed. Recommended (website owner's decision): delete dynamic
  registration and the static key table, and derive VIP only from configured user IDs.
  Treat every static key in that file as public/compromised.
- `nexus-ai.js` falls back to the public key `nexus_sk_discord_bot_1394001641899954368` when
  `NEXUS_API_KEY` is unset (left unchanged: it is the shared SDK contract). Always set
  `NEXUS_API_KEY` in production.
- `firebase-applet-config.json` is a public web config by design; security depends entirely on
  the Firestore rules. Confirm in the Firebase console that the published rules are the locked
  version in `firestore.rules` (with `FIREBASE_AUTH_EMAIL/PASSWORD` set), not `allow … if true`.

---

## 4. Changes made

### 4.1 RaidShield
- `aiModerationService.js`: engine failure → `classification: 'unavailable'` (never `safe`); no
  action is taken on unscanned messages (nobody is punished because of an outage); staff get one
  notice per server per 6 h in the AI alert channel; the engine's own `FLAG_FOR_REVIEW`
  recommendation from `/raidshield` is honoured (staff review instead of auto-punishment).
- Engine health is tracked from real calls (`getRaidShieldEngineStatus()`) and shown in
  `/raidshield dashboard`, `/ping`, and `/health`.
- Config saves read strictly and patch only `raidShield`; save failures are shown to moderators.
- `scamDetectionService.js`: distinct-keyword counting; removed "honestly"/"stake " signals.
- `raidDetectionService.js`: `isCrossChannelSuspect()` — a member is a suspect only if they posted
  in 2+ channels themselves or are new (joined < 7 days or account < 30 days).

### 4.2 Data integrity
- `DatabaseWrapper.getStrict()` (throws `DatabaseReadError`), `set()/increment()` throw
  `DatabaseWriteError` on backend failure, read/write failure counters in `getStatus()`.
- Strict reads in: `setGuildConfig`, `services/guildConfig.js` set/update, economy balance /
  inventory / participants / config saves, leveling user data, join-to-create config writes.
- Economy: integer-only amounts, compensating refunds for pay/rob/buy-pack/open-pack,
  `refundShopPurchase()`, pack-opening history capped at 50 entries per member.

### 4.3 Moderation & admin safety
- `confirmMassAction()` (preview + Confirm/Cancel, 60 s) for `/massban`, `/masskick`, `/roleall`,
  `/restore`; owner and bot-hierarchy protection in mass actions; non-member bans in `/massban`
  require Manage Server (same rule as `/ban`); `/roleall` hierarchy + dangerous-permission guard.
- `/restore`: `validateSnapshot()` before any change.
- `/warn`: self/bot/hierarchy guards.

### 4.4 Infrastructure
- `scripts/firestore-backup.js` / `scripts/firestore-restore.js` (`npm run backup:firestore`,
  `npm run restore:firestore`): raw document dump of all 52 bot collections + legacy guild
  subcollections, SHA-256 checksum, retention, atomic file write; restore is **dry-run by
  default**, verifies format/version/checksum/project, takes a safety backup first, never deletes.
- Graceful shutdown: idempotent, Discord client destroyed first, 8 s hard timeout.
- `/health` reports real Discord/database/RaidShield state (HTTP 200 kept for liveness).
- Join-to-create orphan sweep on every start.

### Effect on the dashboard (code untouched)
The dashboard imports `src/utils/database.js`. A failed database write now throws instead of
returning `false`; `dashboard/server/db.js` already treated `false` as an error, so the user-visible
meaning is unchanged (the HTTP status becomes 500 instead of 503). A config save whose current
config can't be read is now refused instead of overwriting the server's settings with defaults.

---

## 5. Tests

| Run | Result |
|---|---|
| Baseline before changes (`npm test`) | 185 / 185 pass |
| After changes (`npm test`) | **203 / 203 pass** (18 new tests) |
| Import smoke test of every module under `src/` | 267 modules, 0 failures |
| Slash-command definitions (`data.toJSON()`) | 98 commands, 0 invalid |

New test files: `tests/unit/economyIntegrity.test.js`, `tests/unit/raidshieldFailClosed.test.js`,
`tests/unit/firestoreBackupFormat.test.js`, `tests/unit/jtcSweep.test.js`.

**Not verified (cannot be, from this environment):** live Discord behaviour, the Firestore
backup/restore scripts against the real project (deliberately not run against production data),
and any live Nexus AI engine call (engine offline).

---

## 6. Remaining issues & recommended next steps
1. Run `npm run backup:firestore` once from a machine with Firestore access, then
   `npm run restore:firestore -- --file <it>` (dry run) to confirm the round trip; schedule it.
2. Many other services still use the "read whole object → modify → save" pattern with the
   lenient `db.get()` (tickets, giveaways, applications, reaction roles, sticky notes). Migrate
   them to `getStrict()` incrementally — the wrapper now makes that a one-line change each.
3. PostgreSQL `increment()` returns `amount` on error instead of failing (`postgresDatabase.js`).
4. Per-member locks are in-process: safe for the single Railway instance; a second replica
   would need Firestore transactions.
5. The website security note in §3 (owner's decision; not changed here).
6. When Nexus AI is back: set `NEXUS_API_URL`/`NEXUS_API_KEY`/`NEXUS_RAIDSHIELD_KEY`, check
   `/raidshield dashboard` shows 🟢, and only then set `NEXUS_AI_CHAT_ENABLED=true` if wanted.
