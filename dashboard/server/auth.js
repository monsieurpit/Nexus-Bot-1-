// Dashboard authentication.
//
// Every /api route used to be completely open: anyone who knew the dashboard URL (which /editrepo
// hands to any Discord user) could rewrite any server's configuration — turn RaidShield off, set AI
// moderation to auto-ban, change the bot's status — or use the /api/v1 relay to the Nexus AI engine
// with the owner's VIP mode.
//
// Access now needs the dashboard password:
//   - DASHBOARD_PASSWORD (Railway → Variables) when set — recommended;
//   - otherwise a random password generated at startup and printed in the logs (it changes on
//     every restart, so setting DASHBOARD_PASSWORD is the comfortable option).
// A successful login returns a token derived from the password (HMAC), so sessions survive
// restarts and are all invalidated at once by changing the password.
import crypto from 'crypto'

const configuredPassword = (process.env.DASHBOARD_PASSWORD || '').trim()
const password = configuredPassword || crypto.randomBytes(9).toString('base64url')

if (!configuredPassword) {
  console.warn(
    '\n' +
    '╔══════════════════════════════════════════════════════════════════╗\n' +
    '║ DASHBOARD_PASSWORD is not set — a temporary password was generated ║\n' +
    `║ Dashboard password for this run: ${password.padEnd(32)} ║\n` +
    '║ Set DASHBOARD_PASSWORD in Railway → Variables to choose your own.  ║\n' +
    '╚══════════════════════════════════════════════════════════════════╝\n'
  )
}

const sessionToken = crypto.createHmac('sha256', password).update('nexus-dashboard-session-v1').digest('hex')

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

// The dashboard front-end sends its session in X-Dashboard-Token (so pages that send their own
// Authorization header — the API playground — keep working); a Bearer header works too.
function presentedToken(req) {
  const dashboardHeader = String(req.headers['x-dashboard-token'] || '').trim()
  if (dashboardHeader) return dashboardHeader
  const header = req.headers.authorization || ''
  return header.replace(/^Bearer\s+/i, '').trim()
}

// Routes that stay public: health checks, the login itself, and "Nexus Code" (meant for any Discord
// user — it only ever acts with the visitor's own GitHub token on the visitor's own repository).
const PUBLIC_API_PATHS = [
  /^\/api\/health$/,
  /^\/api\/auth\//,
  /^\/api\/codeedit\//,
  /^\/api\/v1\/health$/,
]

export function requireDashboardAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next()
  if (PUBLIC_API_PATHS.some((pattern) => pattern.test(req.path))) return next()

  const token = presentedToken(req)
  if (token && safeEqual(token, sessionToken)) return next()

  // Programmatic access to the /api/v1 relay with the real Nexus API key (not "any key" anymore).
  const apiKey = (process.env.NEXUS_API_KEY || '').trim()
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const presentedKey = String(req.headers['x-api-key'] || '').trim() || bearer
  if (apiKey && req.path.startsWith('/api/v1/') && presentedKey && safeEqual(presentedKey, apiKey)) return next()

  return res.status(401).json({ error: 'Authentication required', code: 'DASHBOARD_AUTH_REQUIRED' })
}

// Brute-force protection for the login endpoint: 10 attempts per IP per 15 minutes.
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10
const loginAttempts = new Map()

export function handleLogin(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS)
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts.set(ip, recent)
    return res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' })
  }

  const given = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!given || !safeEqual(given, password)) {
    recent.push(now)
    loginAttempts.set(ip, recent)
    if (loginAttempts.size > 10000) loginAttempts.clear()
    return res.status(401).json({ error: 'Wrong password' })
  }

  loginAttempts.delete(ip)
  return res.json({ token: sessionToken })
}

export function handleSessionCheck(req, res) {
  const token = presentedToken(req)
  res.json({ authenticated: Boolean(token && safeEqual(token, sessionToken)) })
}
