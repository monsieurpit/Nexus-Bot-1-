import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { existsSync } from 'fs'
import guildsRouter from './routes/guilds.js'
import v1Router from './routes/v1.js'
import codeeditRouter from './routes/codeedit.js'

// Anti-crash handlers for Railway
process.on('unhandledRejection', (reason, promise) => {
  console.warn('⚠️ [Server Anti-Crash] Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err, origin) => {
  console.error('⚠️ [Server Anti-Crash] Uncaught Exception:', err?.message || err, 'at:', origin);
});

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env') })

const app = express()
const PORT = process.env.PORT || 3000

if (!process.env.DATABASE_PUBLIC_URL && !process.env.DATABASE_URL && !process.env.PGHOST) {
  console.info('ℹ️ Persistent storage active via Firebase Firestore.')
}

app.use(cors({ origin: '*' }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/guilds', guildsRouter)
app.use('/api/v1', v1Router)
app.use('/api/codeedit', codeeditRouter)

if (process.env.NODE_ENV !== 'production') {
  try {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      configFile: resolve(__dirname, '../vite.config.js'),
      root: resolve(__dirname, '../client'),
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } catch (viteErr) {
    console.error('Error starting Vite middleware:', viteErr)
  }
} else {
  const distPath = resolve(__dirname, '../dist')
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    app.use((_req, res) => {
      res.sendFile(join(distPath, 'index.html'))
    })
  }
}

app.use((err, _req, res, _next) => {
  console.error('API error:', err.message)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexus Dashboard server running on http://0.0.0.0:${PORT}`)

  // Start Discord Bot instance if token is present and auto-start is requested
  const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.BOT_TOKEN;
  if (process.env.START_BOT !== 'false' && botToken && botToken.length > 20) {
    process.env.DISABLE_BOT_WEBSERVER = 'true'
    import('../../src/app.js').catch(err => {
      console.warn('Failed to auto-start Discord Bot alongside Dashboard:', err.message)
    })
  }
})

