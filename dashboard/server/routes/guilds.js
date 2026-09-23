import { Router } from 'express'
import {
  getValue,
  patchValue,
  getGuildConfigData,
  patchGuildConfig,
  listGuilds,
  setValue,
} from '../db.js'
import {
  getWelcomeConfig,
  updateWelcomeConfig,
  getLevelingConfig,
  saveLevelingConfig,
  getJoinToCreateConfig,
  updateJoinToCreateConfig,
  getApplicationSettings,
  saveApplicationSettings,
  db as botDb,
} from '../../../src/utils/database.js'
import { getReadyBotClient } from '../../../src/utils/botRegistry.js'
import {
  getAllMatches,
  syncBarcelonaFixturesFromApi,
  getFootballApiStatus
} from '../../../src/services/footballService.js'
import {
  getServerCounters,
  saveServerCounters
} from '../../../src/services/serverstatsService.js'

const router = Router()

// The database helpers above take a Discord client only to reach `client.db`.
const dbClient = { get db() { return botDb } }

const ALLOWED_STATUSES = ['online', 'idle', 'dnd', 'invisible']
const FOOTBALL_DEFAULTS = { enabled: false, channelId: null, roleId: null, postedMatches: [], customMatches: [] }

// Every :guildId in this router is a Discord snowflake — rejecting anything else up front keeps
// arbitrary strings out of database keys.
router.param('guildId', (req, res, next, guildId) => {
  if (guildId === 'global') return next()
  if (!/^\d{5,25}$/.test(guildId)) return res.status(400).json({ error: 'Invalid server id' })
  next()
})

function requireObjectBody(req, res) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Expected a JSON object body' })
    return null
  }
  return req.body
}

/** Applies a presence change to the live bot right away (the 5-minute DB poll is the fallback). */
function applyBotStatus(status) {
  const client = getReadyBotClient()
  if (!client) return
  try {
    client.user.setPresence({ status, activities: client.config?.bot?.presence?.activities })
  } catch (err) {
    console.warn('Could not update bot presence from dashboard:', err.message)
  }
}

router.get('/', async (_req, res) => {
  try {
    res.json(await listGuilds())
  } catch (err) {
    console.error('Error listing guilds:', err.message)
    res.status(503).json({ error: 'Database unavailable', detail: err.message })
  }
})

// Global bot status — must be registered before /:guildId routes to avoid param capture
router.put('/global/status', async (req, res, next) => {
  try {
    const { status } = req.body || {}
    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }
    await setValue('bot:global:status', { status })
    applyBotStatus(status)
    res.json({ ok: true, status })
  } catch (err) {
    next(err)
  }
})

router.get('/global/status', async (_req, res, next) => {
  try {
    const stored = await getValue('bot:global:status', null)
    res.json({ status: stored?.status || null })
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/config', async (req, res, next) => {
  try {
    res.json(await getGuildConfigData(req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/config', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    const { botStatus, ...guildPatch } = body
    const config = await patchGuildConfig(req.params.guildId, guildPatch)
    if (botStatus && ALLOWED_STATUSES.includes(botStatus)) applyBotStatus(botStatus)
    res.json(config)
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/welcome', async (req, res, next) => {
  try {
    res.json(await getWelcomeConfig(dbClient, req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/welcome', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    await getGuildConfigData(req.params.guildId) // ensures the database is initialized
    res.json(await updateWelcomeConfig(dbClient, req.params.guildId, body))
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/leveling', async (req, res, next) => {
  try {
    await getGuildConfigData(req.params.guildId)
    res.json(await getLevelingConfig(dbClient, req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/leveling', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    await getGuildConfigData(req.params.guildId)
    const current = await getLevelingConfig(dbClient, req.params.guildId)
    const merged = { ...current, ...body }
    const ok = await saveLevelingConfig(dbClient, req.params.guildId, merged)
    if (!ok) return res.status(503).json({ error: 'Database write failed' })
    res.json(merged)
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/joinToCreate', async (req, res, next) => {
  try {
    await getGuildConfigData(req.params.guildId)
    res.json(await getJoinToCreateConfig(dbClient, req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/joinToCreate', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    await getGuildConfigData(req.params.guildId)
    await updateJoinToCreateConfig(dbClient, req.params.guildId, body)
    res.json(await getJoinToCreateConfig(dbClient, req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/applications', async (req, res, next) => {
  try {
    await getGuildConfigData(req.params.guildId)
    res.json(await getApplicationSettings(dbClient, req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/applications', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    await getGuildConfigData(req.params.guildId)
    const ok = await saveApplicationSettings(dbClient, req.params.guildId, body)
    if (!ok) return res.status(503).json({ error: 'Database write failed' })
    res.json(await getApplicationSettings(dbClient, req.params.guildId))
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/economy', async (req, res, next) => {
  try {
    res.json(await getValue(`economy:${req.params.guildId}:config`, {}))
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/economy', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    res.json(await patchValue(`economy:${req.params.guildId}:config`, body))
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/football', async (req, res, next) => {
  try {
    const config = await getGuildConfigData(req.params.guildId)
    res.json({ ...FOOTBALL_DEFAULTS, ...(config.football || {}) })
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/football', async (req, res, next) => {
  try {
    const body = requireObjectBody(req, res)
    if (!body) return
    const current = (await getGuildConfigData(req.params.guildId)).football || {}
    const updated = await patchGuildConfig(req.params.guildId, { football: { ...current, ...body } })
    res.json({ ...FOOTBALL_DEFAULTS, ...(updated.football || {}) })
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/football/matches', async (req, res, next) => {
  try {
    const { guildId } = req.params
    const footballCfg = (await getGuildConfigData(guildId)).football || {}
    const customMatches = footballCfg.customMatches || []
    const matches = getAllMatches(customMatches)
    const status = getFootballApiStatus()
    res.json({ matches, status, postedMatches: footballCfg.postedMatches || [] })
  } catch (err) {
    next(err)
  }
})

router.post('/:guildId/football/sync', async (_req, res, next) => {
  try {
    const updated = await syncBarcelonaFixturesFromApi()
    const status = getFootballApiStatus()
    res.json({ success: true, count: updated.length, status })
  } catch (err) {
    next(err)
  }
})

// Server Stats & Counters endpoints
router.get('/:guildId/counters', async (req, res, next) => {
  try {
    const { guildId } = req.params
    await getGuildConfigData(guildId) // ensures the database is initialized
    const counters = await getServerCounters(null, guildId)
    res.json(counters)
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/counters', async (req, res, next) => {
  try {
    const { guildId } = req.params
    const counters = Array.isArray(req.body) ? req.body : (req.body?.counters || [])
    await getGuildConfigData(guildId) // ensures the database is initialized
    await saveServerCounters(null, guildId, counters)
    res.json({ ok: true, counters })
  } catch (err) {
    next(err)
  }
})

router.get('/:guildId/serverstats', async (req, res, next) => {
  try {
    const { guildId } = req.params
    await getGuildConfigData(guildId) // ensures the database is initialized
    const counters = await getServerCounters(null, guildId)
    res.json({ enabled: counters.length > 0, counters })
  } catch (err) {
    next(err)
  }
})

router.put('/:guildId/serverstats', async (req, res, next) => {
  try {
    const { guildId } = req.params
    const counters = Array.isArray(req.body) ? req.body : (req.body?.counters || [])
    await getGuildConfigData(guildId) // ensures the database is initialized
    await saveServerCounters(null, guildId, counters)
    res.json({ ok: true, enabled: counters.length > 0, counters })
  } catch (err) {
    next(err)
  }
})

export default router
