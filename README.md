# 🤖 Nexus Custom Bot

A highly customized, bilingual (English/Spanish), premium Discord bot built for server management, advanced utilities, and automated data recovery. This version is optimized for hosting on **Railway** with **Firebase Firestore** as its database (PostgreSQL as a fallback).

---

## 🚀 Key Features

*   **🌐 100% Bilingual Interface:** Every single system message, log, embed, and error message is written in an English / Spanish format (`English / Español`).
*   **🛡️ Automated Server Backup System (`/save-server`, `/save-server-list`, `/restore`):** 
    *   Saves complete snapshots of categories, channel layouts, and explicit role permissions directly to a Postgres database.
    *   Enforces a strict 5-save limit per server (automatically overwriting the oldest snapshot).
    *   Allows Administrators to instantly restore missing or accidentally deleted channels to their exact original state.
*   **🎯 Milestone Management (`/set-milestones`):** Track and celebrate server achievements and engagement targets dynamically.
*   **⚖️ Built-in Admin Safety:** High-end utility commands are automatically locked strictly to members with **Administrator** permissions at the Discord API level.

---

## 🛠️ Infrastructure & Technologies

*   **Language:** JavaScript (Node.js 20)
*   **Library:** Discord.js (v14+)
*   **Database:** Firebase Firestore (primary), PostgreSQL (fallback), in-memory (last resort — data is lost on restart)
*   **AI:** the Nexus AI engine (`Nexus-AI-` repo), reached through `nexus-ai.js`
*   **Hosting Platform:** Railway (Dockerfile — one process runs the dashboard **and** the bot)

---

## ⚙️ Deployment & Environment Variables

Set these in Railway → your service → **Variables**:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `DISCORD_TOKEN` | ✅ | Bot token from the Discord Developer Portal. |
| `CLIENT_ID` | recommended | Application (client) ID — detected automatically if missing. |
| `DASHBOARD_PASSWORD` | ✅ | Password for the web dashboard. If unset, a temporary one is generated at each start and printed in the deploy logs. |
| `NEXUS_API_URL` / `NEXUS_API_KEY` | ✅ | Where the Nexus AI engine runs and its API key. |
| `GUILD_ID` | optional | Your main/test server (guild-only tools like `/benchmark`, crash reports). |
| `DATABASE_URL` | optional | PostgreSQL fallback if Firestore is unreachable. |
| `FIREBASE_AUTH_EMAIL` / `FIREBASE_AUTH_PASSWORD` | optional | Lets you lock the Firestore rules down — see `firestore.rules`. |
| `DASHBOARD_URL` | optional | Public dashboard URL used by `/editrepo` (Railway's domain is used otherwise). |
| `LOG_LEVEL` / `LOG_TO_FILE` | optional | `info` by default in production; `LOG_TO_FILE=false` disables log files. |
| `DB_CACHE_TTL_MS` | optional | Read-cache duration (default `30000`, `0` disables it). |

---

## 📌 Maintenance Notes (For Forks)
This repository is configured as a standalone custom fork. **Do not pull upstream changes or sync the fork** directly through GitHub, as doing so may conflict with the customized PostgreSQL schema and custom command handlers.
