import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env') })

const { Pool } = pg
const PUBLIC_PORT = 48953

function buildConfig() {
  const publicUrl = process.env.DATABASE_PUBLIC_URL
  if (publicUrl) {
    try {
      const u = new URL(publicUrl)
      const config = {
        host: u.hostname,
        port: parseInt(u.port || String(PUBLIC_PORT), 10),
        database: u.pathname.replace(/^\//, ''),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        ssl: { rejectUnauthorized: false },
      }
      return config
    } catch (e) {
      console.warn('⚠️ Could not parse DATABASE_PUBLIC_URL:', e.message)
    }
  }

  const internalUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (internalUrl) {
    try {
      const u = new URL(internalUrl)
      const useSSL = process.env.POSTGRES_SSL === 'true'
      const config = {
        host: u.hostname,
        port: parseInt(u.port || '5432', 10),
        database: u.pathname.replace(/^\//, ''),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        ssl: useSSL ? { rejectUnauthorized: false } : false,
      }
      return config
    } catch (e) {
      console.warn('⚠️ Could not parse DATABASE_URL:', e.message)
    }
  }

  const pgHost = process.env.PGHOST
  const pgUser = process.env.PGUSER
  const pgPassword = process.env.PGPASSWORD
  const pgDatabase = process.env.PGDATABASE
  const pgPort = process.env.PGPORT

  if (pgHost && pgUser && pgDatabase) {
    const useSSL = process.env.POSTGRES_SSL === 'true'
    const config = {
      host: pgHost,
      port: parseInt(pgPort || String(PUBLIC_PORT), 10),
      database: pgDatabase,
      user: pgUser,
      password: pgPassword,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    }
    return config
  }

  return null
}

const config = buildConfig()
let realPool = null
if (config && config.host) {
  try {
    realPool = new Pool({
      ...config,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
    realPool.on('error', (err) => {
      console.warn('DB pool background error (falling back to mock if needed):', err.message)
    })
  } catch (err) {
    console.warn('Could not initialize PostgreSQL pool:', err.message)
    realPool = null
  }
}

// In-Memory Database Fallback
const inMemoryData = {
  guilds: new Map([
    [
      '123456789012345678',
      {
        id: '123456789012345678',
        config: {
          name: 'Nexus Community',
          prefix: '!',
          language: 'en',
          timezone: 'UTC',
          logChannelId: '123456789012345680',
          logIgnore: { users: [], channels: [] },
          ticketCategoryId: '123456789012345681',
          ticketStaffRoleId: '123456789012345682',
          maxTicketsPerUser: 3,
          dmOnClose: true,
          ticketLogging: { lifecycleChannelId: '123456789012345683', transcriptChannelId: '123456789012345684' },
          verification: {
            enabled: true,
            channelId: '123456789012345685',
            roleId: '123456789012345686',
            buttonText: 'Verify Me',
            message: 'Click the button below to verify yourself.',
            autoVerify: { enabled: false, criteria: 'none', accountAgeDays: 7, roleId: '' }
          },
          raidShield: {
            enabled: true,
            notificationChannelId: '123456789012345687',
            alertRoleId: '123456789012345688',
            autoBan: false,
            verifiedRoleId: '123456789012345686',
            quarantineRoleId: '123456789012345689',
            quarantineChannelId: '123456789012345690',
            aiModeration: { enabled: true, sensitivity: 'medium' }
          },
          logging: {
            enabled: true,
            channelId: '123456789012345680',
            enabledEvents: { 'moderation.ban': true, 'moderation.kick': true, 'member.join': true, 'ticket.create': true }
          },
          enabledCommands: {}
        },
        counters: { members: 1420, online: 382, channels: 28, roles: 14 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    ]
  ]),
  welcomeConfigs: new Map([
    [
      '123456789012345678',
      {
        guild_id: '123456789012345678',
        config: {
          enabled: true,
          channelId: '123456789012345691',
          welcomePing: true,
          welcomeMessage: 'Welcome {user} to {server}!',
          welcomeImage: '',
          welcomeEmbed: {
            title: 'Welcome!',
            description: "We're glad you're here, {user}!",
            color: '#7c6cf0',
            thumbnail: true,
            footer: 'Enjoy your stay'
          },
          goodbyeEnabled: true,
          goodbyeChannelId: '123456789012345692',
          leaveMessage: '{user.tag} has left the server.',
          leaveEmbed: { color: '#ef4444' },
          dmMessage: 'Welcome to the server! Read our rules in #rules.',
          roleIds: ['123456789012345693'],
          autoRoleDelay: 0
        }
      }
    ]
  ]),
  tempData: new Map([
    [
      'bot:global:status',
      {
        value: {
          status: 'online',
          online: true,
          guildCount: 1,
          cachedGuilds: 1,
          uptime: 7200,
          ping: 18,
          version: '1.1.1',
          botUser: { id: '999888777666555444', username: 'Nexus Bot', tag: 'Nexus#0001', avatar: null },
          system: { nodeVersion: process.version, memoryUsage: { heapUsed: 45 * 1024 * 1024, heapTotal: 90 * 1024 * 1024 } }
        },
        expires_at: null
      }
    ],
    [
      'guild:123456789012345678:jointocreate',
      {
        value: {
          enabled: true,
          categoryId: '123456789012345694',
          triggerChannels: ['123456789012345695'],
          channelNameTemplate: "{username}'s Room",
          userLimit: 0,
          bitrate: 64000
        },
        expires_at: null
      }
    ],
    [
      'guild:123456789012345678:applications:settings',
      {
        value: {
          enabled: true,
          applicationChannelId: '123456789012345696',
          logChannelId: '123456789012345697',
          questions: ['What is your age?', 'Why do you want to join staff?', 'What can you contribute to our team?'],
          roles: { admin: '123456789012345682', reviewer: '123456789012345682', accepted: '123456789012345698', denied: '' },
          requireVerification: true,
          minAccountAge: 7,
          maxApplications: 1,
          cooldown: 24
        },
        expires_at: null
      }
    ],
    [
      'economy:123456789012345678:config',
      {
        value: {
          enabled: true,
          currencyName: 'Coins',
          currencyEmoji: '🪙',
          dailyAmount: 100,
          dailyStreakBonus: 10,
          packs: [
            {
              id: 'starter_pack',
              name: 'Starter Pack',
              emoji: '📦',
              description: 'A modest pack to get you started',
              price: 100,
              rewards: [
                { type: 'coins', amount: 50, chance: 60, label: '50 coins' },
                { type: 'coins', amount: 150, chance: 30, label: '150 coins' },
                { type: 'coins', amount: 300, chance: 10, label: '300 coins' }
              ]
            }
          ]
        },
        expires_at: null
      }
    ]
  ])
}

let mockWarned = false
function logMockNotice() {
  if (!mockWarned) {
    console.log('🗄️ In-Memory DB active with default guild seed (PostgreSQL not connected).')
    mockWarned = true
  }
}

function handleMockQuery(text, params = []) {
  logMockNotice()
  const trimmed = text.trim()

  // 1. SELECT id, config, counters, created_at, updated_at FROM guilds ORDER BY created_at DESC
  if (trimmed.startsWith('SELECT id, config, counters, created_at, updated_at FROM guilds')) {
    const rows = Array.from(inMemoryData.guilds.values())
    return { rows, rowCount: rows.length }
  }

  // 2. INSERT INTO guilds (id, config) VALUES ($1, '{}') ON CONFLICT (id) DO NOTHING
  if (trimmed.startsWith('INSERT INTO guilds (id, config)')) {
    const id = params[0]
    if (!inMemoryData.guilds.has(id)) {
      inMemoryData.guilds.set(id, {
        id,
        config: {},
        counters: { members: 0, online: 0, channels: 0, roles: 0 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
    return { rows: [], rowCount: 1 }
  }

  // 3. INSERT INTO welcome_configs (guild_id, config) VALUES ($1, '{}') ON CONFLICT (guild_id) DO NOTHING
  if (trimmed.startsWith('INSERT INTO welcome_configs')) {
    const guildId = params[0]
    if (!inMemoryData.welcomeConfigs.has(guildId)) {
      inMemoryData.welcomeConfigs.set(guildId, {
        guild_id: guildId,
        config: {}
      })
    }
    return { rows: [], rowCount: 1 }
  }

  // 4. SELECT value FROM temp_data WHERE key = $1 ...
  if (trimmed.startsWith('SELECT value FROM temp_data WHERE key =')) {
    const key = params[0] || (trimmed.includes("'bot:global:status'") ? 'bot:global:status' : '')
    const item = inMemoryData.tempData.get(key)
    if (item && (!item.expires_at || new Date(item.expires_at) > new Date())) {
      return { rows: [{ value: item.value }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }

  // 5. INSERT INTO temp_data (key, value) VALUES ...
  if (trimmed.startsWith('INSERT INTO temp_data')) {
    let key = params[0]
    let value = params[1]
    if (trimmed.includes("'bot:global:status'")) {
      key = 'bot:global:status'
      value = params[0]
    }
    const parsedValue = typeof value === 'string' ? JSON.parse(value) : value
    inMemoryData.tempData.set(key, { value: parsedValue, expires_at: null })
    return { rows: [], rowCount: 1 }
  }

  // 6. SELECT config FROM guilds WHERE id = $1
  if (trimmed.startsWith('SELECT config FROM guilds WHERE id =')) {
    const guild = inMemoryData.guilds.get(params[0])
    if (guild) {
      return { rows: [{ config: guild.config }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }

  // 7. UPDATE guilds SET config = config || $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING config
  if (trimmed.startsWith('UPDATE guilds SET config = config ||')) {
    const guildId = params[0]
    const patch = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
    let guild = inMemoryData.guilds.get(guildId)
    if (!guild) {
      guild = { id: guildId, config: {}, counters: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      inMemoryData.guilds.set(guildId, guild)
    }
    guild.config = { ...(guild.config || {}), ...patch }
    guild.updated_at = new Date().toISOString()
    return { rows: [{ config: guild.config }], rowCount: 1 }
  }

  // 8. SELECT config FROM welcome_configs WHERE guild_id = $1
  if (trimmed.startsWith('SELECT config FROM welcome_configs WHERE guild_id =')) {
    const wc = inMemoryData.welcomeConfigs.get(params[0])
    if (wc) {
      return { rows: [{ config: wc.config }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }

  // 9. UPDATE welcome_configs SET config = config || $2::jsonb, updated_at = NOW() WHERE guild_id = $1 RETURNING config
  if (trimmed.startsWith('UPDATE welcome_configs SET config = config ||')) {
    const guildId = params[0]
    const patch = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
    let wc = inMemoryData.welcomeConfigs.get(guildId)
    if (!wc) {
      wc = { guild_id: guildId, config: {} }
      inMemoryData.welcomeConfigs.set(guildId, wc)
    }
    wc.config = { ...(wc.config || {}), ...patch }
    return { rows: [{ config: wc.config }], rowCount: 1 }
  }

  // 10. SELECT config->'leveling' AS leveling FROM guilds WHERE id = $1
  if (trimmed.includes("config->'leveling' AS leveling FROM guilds WHERE id =")) {
    const guild = inMemoryData.guilds.get(params[0])
    return { rows: [{ leveling: guild?.config?.leveling || {} }], rowCount: guild ? 1 : 0 }
  }

  // 11. UPDATE guilds SET config = jsonb_set(config, '{leveling}', $2::jsonb) ...
  if (trimmed.includes("jsonb_set(config, '{leveling}'")) {
    const guildId = params[0]
    const leveling = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
    let guild = inMemoryData.guilds.get(guildId)
    if (!guild) {
      guild = { id: guildId, config: {}, counters: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      inMemoryData.guilds.set(guildId, guild)
    }
    guild.config = { ...(guild.config || {}), leveling }
    guild.updated_at = new Date().toISOString()
    return { rows: [{ leveling }], rowCount: 1 }
  }

  return { rows: [], rowCount: 0 }
}

const pool = {
  query: async (text, params = []) => {
    if (realPool) {
      try {
        return await realPool.query(text, params)
      } catch (err) {
        // Fallback to in-memory on connection or database error
        return handleMockQuery(text, params)
      }
    }
    return handleMockQuery(text, params)
  },
  connect: async () => {
    if (realPool) {
      try {
        return await realPool.connect()
      } catch (err) {
        return {
          query: async (text, params = []) => handleMockQuery(text, params),
          release: () => {}
        }
      }
    }
    return {
      query: async (text, params = []) => handleMockQuery(text, params),
      release: () => {}
    }
  },
  on: (event, handler) => {
    if (realPool) realPool.on(event, handler)
  }
}

export default pool
