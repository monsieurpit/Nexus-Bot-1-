import { fileURLToPath } from "url";
import path from "path";
import botConfig, { validateConfig } from "./bot.js";
import { pgConfig } from "./postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);






const appConfig = {
  paths: {
    root: path.join(__dirname, "../.."),
    commands: path.join(__dirname, "../commands"),
    events: path.join(__dirname, "../events"),
    config: __dirname,
    utils: path.join(__dirname, "../utils"),
    services: path.join(__dirname, "../services"),
    handlers: path.join(__dirname, "../handlers"),
    interactions: path.join(__dirname, "../interactions"),
  },

  bot: {
    ...botConfig,
    token: process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.BOT_TOKEN,
    clientId: process.env.CLIENT_ID,
    // Falls back to the actual test/dev guild ID if GUILD_ID isn't set in the deployment
    // environment — without this, registerCommands()'s dev-guild instant sync silently never
    // runs, which specifically breaks any `guildOnly: true` command (e.g. /benchmark, /announce,
    // /set-ai-telemetry): they're deliberately excluded from the global registration, so with no
    // guild sync either they end up registered nowhere at all.
    guildId: process.env.GUILD_ID || '1541854522127814786',

  },

  // PostgreSQL configuration - Primary production database
  postgresql: {
    ...pgConfig,
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: {
      enabled: process.env.LOG_TO_FILE === "true",
      path: path.join(__dirname, "../../logs"),
      maxSize: "20m",
      maxFiles: "14d",
      zippedArchive: true,
    },
    console: {
      enabled: true,
      colorize: true,
      timestamp: true,
    },
    sentry: {
      enabled: process.env.SENTRY_DSN ? true : false,
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
    },
  },

  api: {
    port: process.env.PORT || 3000,
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") || null,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
    rateLimit: {
      windowMs: 15 * 60 * 1000,
      max: 100,
    },
  },

  




  features: {
    
    leveling: true,                 
    moderation: true,               
    logging: true,                  
    welcome: true,                  

    
    tickets: true,                  
    giveaways: true,                
    counter: true,                  

    
    verification: true,             
    reactionRoles: true,            
    joinToCreate: true,             

    
    voice: true,                    
    search: true,                   
    tools: true,                    
    utility: true,                  
    community: true,                
    fun: true,                      

    
    music: false,                   
  },

  env: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV !== "production",
};

Object.freeze(appConfig);

export default appConfig;
