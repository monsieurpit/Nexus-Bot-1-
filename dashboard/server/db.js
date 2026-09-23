// Dashboard data access — goes through the bot's OWN database layer (src/utils/database.js), so
// the dashboard always reads and writes exactly what the bot reads and writes, on whichever backend
// the bot is actually using (Firestore first, then PostgreSQL, then in-memory).
//
// This file used to open its own PostgreSQL pool and issue raw SQL against `guilds`/`temp_data`
// tables, with an in-memory mock (seeded with a fake demo server) as a fallback. The bot, however,
// uses Firestore as its primary store — so with a DATABASE_URL set, every dashboard save went into
// Postgres tables the bot never read, and several mock-path saves silently matched no query at all.
import {
  db,
  initializeDatabase,
  getGuildConfig,
  setGuildConfig,
} from '../../src/utils/database.js'
import { getReadyBotClient } from '../../src/utils/botRegistry.js'

let initPromise = null

async function ready() {
  if (!db.initialized) {
    initPromise ||= initializeDatabase()
    await initPromise
  }
  return db
}

// getGuildConfig/setGuildConfig take a Discord client only to reach `client.db`.
const dbClient = { get db() { return db } }

export class DashboardDataError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.status = status
  }
}

export async function getValue(key, defaultValue = {}) {
  await ready()
  const value = await db.get(key, null)
  return value ?? defaultValue
}

export async function setValue(key, value) {
  await ready()
  const ok = await db.set(key, value)
  if (ok === false) throw new DashboardDataError('Database write failed', 503)
  return value
}

/** Shallow-merges `patch` into the object stored at `key` and returns the merged result. */
export async function patchValue(key, patch) {
  const current = await getValue(key, {})
  const merged = { ...(current && typeof current === 'object' ? current : {}), ...(patch || {}) }
  return setValue(key, merged)
}

export async function getGuildConfigData(guildId) {
  await ready()
  return getGuildConfig(dbClient, guildId)
}

/** Top-level merge into the guild config, validated by the bot's own config schema. */
export async function patchGuildConfig(guildId, patch) {
  await ready()
  const ok = await setGuildConfig(dbClient, guildId, patch || {})
  if (!ok) {
    throw new DashboardDataError('Configuration rejected — check the values and try again.', 400)
  }
  return getGuildConfig(dbClient, guildId)
}

/**
 * Servers to show in the dashboard's selector. Prefers the live bot client (real names, and only
 * servers the bot is actually in); falls back to guilds that have a stored config.
 */
export async function listGuilds() {
  await ready()
  const client = getReadyBotClient()
  if (client) {
    return Array.from(client.guilds.cache.values())
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL?.() || null,
        memberCount: guild.memberCount ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const keys = await db.list('guild:').catch(() => [])
  const ids = new Set()
  for (const key of keys) {
    const match = /^guild:(\d{5,25}):config$/.exec(key)
    if (match) ids.add(match[1])
  }
  return Array.from(ids).map((id) => ({ id, name: null, icon: null, memberCount: null }))
}
