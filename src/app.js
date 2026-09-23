import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Events } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkGiveaways } from './services/giveawayService.js';
import { runAutoSave } from './services/autoSaveService.js';
import { checkFootballAnnouncements, syncBarcelonaFixturesFromApi } from './services/footballService.js';
import { checkWeeklySummaries } from './services/weeklySummaryService.js';
import { checkVcEvents } from './services/vcEventService.js';
import { checkLaligaStandingsUpdates } from './services/laligaStandingsService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';
import { logCrash } from './services/aiTelemetryService.js';
import { registerBotClient } from './utils/botRegistry.js';

class NexusBot extends Client {
  constructor() {
    super({
      intents: [
        
        GatewayIntentBits.Guilds,                        
        GatewayIntentBits.GuildMembers,                 
        
        
        GatewayIntentBits.GuildMessages,                
        GatewayIntentBits.GuildMessageReactions,        
        GatewayIntentBits.MessageContent,               
        
        GatewayIntentBits.GuildVoiceStates,             
        
        
        GatewayIntentBits.GuildBans,                    
      ],
      // Safe default for EVERY message the bot sends: user mentions and reply pings work, but
      // @everyone/@here and role pings only go out where a feature explicitly allows them
      // (ticket staff role, RaidShield alert role, football/VC-event/weekly-summary pings…).
      // Without this, any text the bot relays — a /say message, an embed-builder post, a sticky
      // note, a welcome template, an AI reply — could mass-ping the whole server.
      allowedMentions: { parse: ['users'], repliedUser: true },
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;
    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
    registerBotClient(this);
  }

  async start() {
    try {
      startupLog('Starting NexusBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      startupLog('Initializing database...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;
      
      // Check database status and report
      const dbStatus = this.db.getStatus();
      if (dbStatus.isDegraded) {
        logger.warn('');
        logger.warn('╔═══════════════════════════════════════════════════════╗');
        logger.warn('║ ⚠️  DATABASE RUNNING IN DEGRADED MODE                 ║');
        logger.warn('║                                                       ║');
        logger.warn('║ Connection: In-Memory Storage (PostgreSQL unavailable)║');
        logger.warn('║ Data Persistence: DISABLED - data lost on restart    ║');
        logger.warn('║ Action Required: Fix PostgreSQL and restart bot      ║');
        logger.warn('╚═══════════════════════════════════════════════════════╝');
        logger.warn('');
      } else {
        startupLog(`✅ Database Status: ${dbStatus.connectionType} (fully operational)`);
      }
      
      startupLog('Starting web server...');
      this.startWebServer();
      
      startupLog('Loading commands...');
      await loadCommands(this);
      startupLog(`Commands loaded: ${this.commands.size}`);
      
      startupLog('Loading handlers...');
      await this.loadHandlers();
      startupLog('Handlers loaded');
      
      if (this.config.bot.token && this.config.bot.token !== 'your_bot_token_here') {
        try {
          startupLog('Logging into Discord...');
          await this.login(this.config.bot.token);
          startupLog('Discord login successful');

          // Wait for the gateway READY dispatch before registering commands. `client.login()`
          // can resolve before `client.user` / `client.application` are populated; registering
          // at that point leaves the application id undefined and — with no CLIENT_ID env var —
          // the whole global command PUT silently no-ops, so new commands/subcommands (e.g.
          // `/football prediction-now`) never reach Discord even though every deploy "succeeds".
          if (!this.isReady()) {
            startupLog('Waiting for client ready before registering commands...');
            await new Promise((resolve) => {
              const timer = setTimeout(() => {
                logger.warn('Timed out waiting for client ready; attempting command registration anyway.');
                resolve();
              }, 45000);
              this.once(Events.ClientReady, () => {
                clearTimeout(timer);
                resolve();
              });
            });
          }

          startupLog('Registering slash commands...');
          await this.registerCommands();
          startupLog('Slash commands registration complete');
        } catch (botErr) {
          logger.warn('⚠️ Could not log into Discord (check DISCORD_TOKEN): ' + botErr.message);
        }
      } else {
        logger.info('ℹ️ DISCORD_TOKEN not provided; bot running in offline/dashboard mode.');
      }
      
      const databaseMode = dbStatus.isDegraded
        ? 'Optional in-memory mode (data resets after restart)'
        : 'Connected (persistent data enabled)';
      const handlerSummary = `${this.buttons.size} buttons, ${this.selectMenus.size} menus, ${this.modals.size} modals`;
      startupLog(
        `ONLINE ✅ | ${this.commands.size} commands loaded | ${handlerSummary} | Database: ${databaseMode}`
      );
      
      this.setupCronJobs();

      // Trigger initial FC Barcelona fixtures sync from API
      syncBarcelonaFixturesFromApi().catch(err => {
        logger.warn('[Football] Initial API sync error: ' + err.message);
      });
    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  startWebServer() {
    if (process.env.DISABLE_BOT_WEBSERVER === 'true') {
      startupLog('Internal bot webserver bypassed (unified server active)');
      return;
    }
    const app = express();
    const configuredPort = Number(this.config.api?.port || process.env.PORT || 3000);
    const maxPortRetryAttempts = Number(process.env.PORT_RETRY_ATTEMPTS || 5);
    const host = process.env.WEB_HOST || '0.0.0.0';
    const corsOrigin = this.config.api?.cors?.origin;
    
    app.use((req, res, next) => {
      res.header('X-Content-Type-Options', 'nosniff');
      res.removeHeader('X-Powered-By');

      if (corsOrigin) {
        const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
        const origin = req.headers.origin;

        if (allowedOrigins.includes('*')) {
          res.header('Access-Control-Allow-Origin', '*');
        } else if (origin && allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Vary', 'Origin');
        }
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }

      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    const requestCounts = new Map();
    const windowMs = 60000; 
    const maxRequests = this.config.api?.rateLimit?.max || 100;
    
    app.use((req, res, next) => {
      const ip = req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;
      
      if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
      }
      
      const times = requestCounts.get(ip).filter(t => t > windowStart);

      // Periodically drop idle IPs so this map can't grow for the lifetime of the process.
      if (requestCounts.size > 5000) {
        for (const [key, stamps] of requestCounts) {
          if (!stamps.length || stamps[stamps.length - 1] <= windowStart) requestCounts.delete(key);
        }
      }
      
      if (times.length >= maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      
      times.push(now);
      requestCounts.set(ip, times);
      next();
    });

    app.get('/health', (req, res) => {
      const dbStatus = this.db?.getStatus?.() || { isDegraded: 'unknown' };
      const status = {
        status: 'healthy',
        database: {
          connected: dbStatus.connectionType !== 'none',
          degraded: dbStatus.isDegraded
        }
      };
      res.status(200).json(status);
    });

    app.get('/ready', (req, res) => {
      const dbStatus = this.db?.getStatus?.() || { isDegraded: true };
      const isReady = this.isReady() && !dbStatus.isDegraded;

      if (isReady) {
        return res.status(200).json({
          ready: true,
          message: 'Bot is ready'
        });
      }

      res.status(503).json({
        ready: false,
        reason: !this.isReady() ? 'Bot not Ready' : 'Database degraded'
      });
    });

    app.get('/', (req, res) => {
      res.status(200).json({ 
        message: 'NexusBot System Online',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      });
    });

    // Internal API: apply bot status from dashboard
    app.use(express.json());

    // The /api/internal/* routes change the bot's presence and re-register every slash command.
    // They used to be reachable by anyone who could reach this port (publicly, on a host like
    // Railway). Only loopback callers are allowed now — or any caller presenting the
    // INTERNAL_API_TOKEN, when one is configured.
    app.use('/api/internal', (req, res, next) => {
      const token = process.env.INTERNAL_API_TOKEN;
      const presented = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (token && presented === token) return next();
      const ip = req.socket?.remoteAddress || '';
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
      return res.status(403).json({ error: 'Forbidden' });
    });

    app.post('/api/internal/status', (req, res) => {
      const { status } = req.body || {};
      const allowed = ['online', 'idle', 'dnd', 'invisible'];
      if (!status || !allowed.includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Use: online, idle, dnd, invisible' });
      }
      if (!this.isReady()) {
        return res.status(503).json({ error: 'Bot not ready yet' });
      }
      try {
        this.user.setPresence({ status, activities: this.config.bot.presence.activities });
        logger.info(`Bot status updated to: ${status}`);
        res.json({ ok: true, status });
      } catch (err) {
        logger.error('Failed to set bot status:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // Internal API: re-apply guild config (e.g. after dashboard save)
    app.post('/api/internal/config-update', async (req, res) => {
      const { guildId, config: patch } = req.body || {};
      if (!guildId) return res.status(400).json({ error: 'guildId required' });

      // Apply botStatus if provided
      if (patch?.botStatus && this.isReady()) {
        const allowed = ['online', 'idle', 'dnd', 'invisible'];
        const status = allowed.includes(patch.botStatus) ? patch.botStatus : 'online';
        try {
          this.user.setPresence({ status, activities: this.config.bot.presence.activities });
          logger.info(`Bot status updated via dashboard to: ${status}`);
        } catch (err) {
          logger.warn('Could not update presence:', err.message);
        }
      }

      res.json({ ok: true, guildId });
    });

    // Internal API: force a global slash-command re-registration without a full bot restart.
    // Useful right after shipping a new command / subcommand (e.g. `/football prediction-now`)
    // so it doesn't have to wait for the next Railway redeploy to be PUT to Discord. Discord's
    // own global-command propagation delay (minutes, up to ~1h) still applies afterward.
    app.post('/api/internal/redeploy-commands', async (req, res) => {
      if (!this.isReady()) {
        return res.status(503).json({ error: 'Bot not ready yet' });
      }
      try {
        await loadCommands(this);
        await this.registerCommands();
        const names = Array.from(this.commands.keys()).sort();
        logger.info(`Slash commands re-registered on demand via internal API (${names.length} commands)`);
        res.json({ ok: true, count: names.length, commands: names });
      } catch (err) {
        logger.error('On-demand command re-registration failed:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    const startServer = (port, attempt = 0) => {
      let hasStartedListening = false;
      const server = app.listen(port, host, () => {
        hasStartedListening = true;
        this.webServer = server;
        startupLog(`✅ Web Server running on ${host}:${port}`);
        startupLog(`Health endpoint: http://localhost:${port}/health`);
        startupLog(`Ready endpoint: http://localhost:${port}/ready`);
      });

      server.on('error', (error) => {
        const errorCode = error?.code || 'UNKNOWN_ERROR';
        const errorMessage = error?.message || 'Unknown server error';

        if (!hasStartedListening && errorCode === 'EADDRINUSE' && attempt < maxPortRetryAttempts) {
          const nextPort = port + 1;
          startupLog(`Port ${port} is already in use. Trying port ${nextPort}...`);
          setTimeout(() => startServer(nextPort, attempt + 1), 250);
          return;
        }

        if (hasStartedListening && errorCode === 'EADDRINUSE') {
          logger.warn(`Web server reported a duplicate bind warning on ${host}:${port}, but the bot remains online.`);
          return;
        }

        logger.error(`❌ Web server error on port ${port} (${errorCode}): ${errorMessage}`);

        if (!hasStartedListening) {
          process.exit(1);
        }
      });
    };

    startServer(configuredPort, 0);
  }

  setupCronJobs() {
    // Every job goes through safeJob: a job that throws (or rejects) is logged with its name
    // instead of surfacing as an anonymous unhandled rejection, and a slow run is never started a
    // second time while the previous one is still going (e.g. a football API sync that hangs).
    const running = new Set();
    const safeJob = (name, fn) => async () => {
      if (running.has(name)) {
        logger.debug(`[Cron] Skipping "${name}" — previous run still in progress`);
        return;
      }
      running.add(name);
      try {
        await fn();
      } catch (err) {
        logger.error(`[Cron] Job "${name}" failed:`, err);
      } finally {
        running.delete(name);
      }
    };

    cron.schedule('* * * * *', safeJob('giveaways', () => checkGiveaways(this)));
    cron.schedule('* * * * *', safeJob('vc-events', () => checkVcEvents(this)));
    cron.schedule('0 0 * * *', safeJob('auto-save', () => runAutoSave(this)));
    cron.schedule('*/15 * * * *', safeJob('server-counters', () => this.updateAllCounters()));
    // Poll DB every 5 minutes and apply botStatus if it changed
    cron.schedule('*/5 * * * *', safeJob('bot-status', () => this.syncBotStatusFromDb()));
    // FC Barcelona match announcements / live schedule boards, and weekly summaries, every 30 minutes
    cron.schedule('*/30 * * * *', safeJob('football-announcements', () => checkFootballAnnouncements(this)));
    cron.schedule('*/30 * * * *', safeJob('weekly-summaries', () => checkWeeklySummaries(this)));
    // Daily sync of FC Barcelona fixtures from the API (rescheduled games etc.) at 06:00 UTC
    cron.schedule('0 6 * * *', safeJob('football-fixtures-sync', () => syncBarcelonaFixturesFromApi()));
    // Refresh every configured LaLiga standings board once an hour, on the hour
    cron.schedule('0 * * * *', safeJob('laliga-standings', () => checkLaligaStandingsUpdates(this)));

    // Run initial startup check 15 seconds after launch once bot caches are populated
    setTimeout(() => {
      if (this.isReady && this.isReady()) {
        logger.info('[Startup] Running initial check for FC Barcelona live schedule boards and announcements...');
        checkFootballAnnouncements(this).catch(err => {
          logger.warn('[Startup] Initial football check warning: ' + err.message);
        });
      }
    }, 15000);
  }

  async syncBotStatusFromDb() {
    if (!this.isReady() || !this.db) return;
    try {
      const allowed = ['online', 'idle', 'dnd', 'invisible'];
      // Read from global key set by the dashboard
      const stored = await this.db.get('bot:global:status');
      const status = stored?.status;
      if (status && allowed.includes(status)) {
        const current = this.user.presence?.status;
        if (current !== status) {
          this.user.setPresence({ status, activities: this.config.bot.presence.activities });
          logger.info(`Bot status synced from DB: ${status}`);
        }
      }
    } catch (err) {
      logger.warn('Failed to sync bot status from DB:', err.message);
    }
  }

  async updateAllCounters() {
    if (!this.db) {
      logger.warn('Database not available for counter updates');
      return;
    }
    
    for (const [guildId, guild] of this.guilds.cache) {
      try {
        const counters = await getServerCounters(this, guildId);
        const validCounters = [];
        const orphanedCounters = [];
        
        for (const counter of counters) {
          if (counter && counter.type && counter.channelId && counter.enabled !== false) {
            const channel = guild.channels.cache.get(counter.channelId);
            if (channel) {
              validCounters.push(counter);
              await updateCounter(this, guild, counter);
            } else {
              orphanedCounters.push(counter);
              logger.info(`Removing orphaned counter ${counter.id} (type: ${counter.type}, deleted channel: ${counter.channelId}) from guild ${guildId}`);
            }
          }
        }
        
        // Save cleaned counters if any were orphaned
        if (orphanedCounters.length > 0) {
          await saveServerCounters(this, guildId, validCounters);
          logger.info(`Cleaned up ${orphanedCounters.length} orphaned counter(s) from guild ${guildId} during scheduled update`);
        }
      } catch (error) {
        logger.error(`Error updating counters for guild ${guildId}:`, error);
      }
    }
  }

  async loadHandlers() {
    const handlers = [
      { path: 'events', type: 'default', required: true },
      { path: 'interactions', type: 'default', required: true }
    ];

    for (const handler of handlers) {
      try {
        const module = await import(`./handlers/${handler.path}.js`);
        const loaderFn = handler.type.startsWith('named:') 
          ? module[handler.type.split(':')[1]] 
          : module.default;
        
        if (typeof loaderFn === 'function') {
          await loaderFn(this);
          logger.info(`✅ Loaded ${handler.path}`);
        } else {
          throw new Error(`Invalid loader export from ${handler.path}`);
        }
      } catch (error) {
        if (handler.required) {
          logger.error(`❌ Failed to load required handler ${handler.path}:`, error.message);
          throw error;
        } else if (error.code !== 'MODULE_NOT_FOUND') {
          logger.warn(`⚠️  Failed to load optional handler ${handler.path}:`, error.message);
        }
      }
    }
  }

  async registerCommands() {
    try {
      const clientId = this.config.bot.clientId || this.user?.id || this.application?.id;
      await registerSlashCommands(this, clientId, this.config.bot.guildId);
    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  }

  async shutdown(reason = 'UNKNOWN') {
    shutdownLog(`Bot is shutting down (${reason})...`);
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`🛑 Graceful Shutdown Initiated (${reason})`);
    logger.info(`${'='.repeat(60)}`);

    try {
      
      logger.info('Stopping cron jobs...');
      cron.getTasks().forEach(task => task.stop());
      logger.info('✅ Cron jobs stopped');

      // Close database connection
      if (this.db && this.db.db) {
        logger.info('Closing database connection...');
        try {
          if (this.db.db.pool) {
            await this.db.db.pool.end();
            logger.info('✅ Database connection closed');
          }
        } catch (error) {
          logger.warn('Error closing database pool:', error.message);
        }
      }

      
      logger.info('Destroying Discord client...');
      if (this.isReady()) {
        try {
          this.destroy();
          logger.info('✅ Discord client destroyed');
        } catch (error) {
          
          
          logger.warn('Discord client destroy warning (non-critical):', error.message);
        }
      }

      logger.info('✅ Graceful shutdown complete');
  shutdownLog('Bot stopped successfully.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

try {
  const bot = new NexusBot();
  
  const setupShutdown = () => {
    process.on('SIGTERM', () => bot.shutdown('SIGTERM'));
    process.on('SIGINT', () => bot.shutdown('SIGINT'));
    
    process.on('uncaughtException', (error, origin) => {
      logger.error(`[Railway Shield] Uncaught Exception at ${origin}:`, error?.stack || error?.message || error);
      // Best-effort only — wrapped so a broken Discord connection during a genuine crash can never
      // itself throw a second unhandled error. logCrash already never throws on its own, this is
      // belt-and-suspenders since we're inside the crash handler itself.
      if (process.env.GUILD_ID) {
        try {
          logCrash(bot, process.env.GUILD_ID, { input: null, error, source: `uncaughtException (${origin})` }).catch(() => {});
        } catch {}
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.warn('[Railway Shield] Unhandled Rejection:', reason?.message || reason);
      if (process.env.GUILD_ID) {
        try {
          logCrash(bot, process.env.GUILD_ID, { input: null, error: reason, source: 'unhandledRejection' }).catch(() => {});
        } catch {}
      }
    });
  };
  
  setupShutdown();
  bot.start();
} catch (error) {
  logger.error('Fatal error during bot startup:', error);
}

export default NexusBot;



