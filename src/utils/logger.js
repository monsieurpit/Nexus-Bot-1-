import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTraceContext } from './traceContext.js';

const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize, errors, json } = format;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const validLogLevels = new Set(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']);
const defaultLogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const logLevelAliases = {
  warning: 'warn',
  warnings: 'warn',
  warns: 'warn',
  err: 'error',
  information: 'info',
};
const rawRequestedLogLevel = process.env.LOG_LEVEL?.toLowerCase().trim();
const requestedLogLevel = logLevelAliases[rawRequestedLogLevel] || rawRequestedLogLevel;

const resolvedLogLevel = validLogLevels.has(requestedLogLevel)
  ? requestedLogLevel
  : defaultLogLevel;

const pendingInvalidLevelWarning = requestedLogLevel && !validLogLevels.has(requestedLogLevel)
  ? `[logger] Invalid LOG_LEVEL "${process.env.LOG_LEVEL}". Falling back to "${defaultLogLevel}".`
  : null;

const FILE_LOGGING_ENABLED = String(process.env.LOG_TO_FILE ?? 'true').toLowerCase() !== 'false';

const shouldPromoteUserFacingLogs = process.env.NODE_ENV === 'production' && resolvedLogLevel === 'warn';

const LOG_SCHEMA_DEFAULTS = Object.freeze({
  event: 'application.log',
  guildId: null,
  userId: null,
  command: null,
  errorCode: null,
  traceId: null,
});

// Keys that are part of every log line's schema, not worth repeating on the console.
const CONSOLE_HIDDEN_KEYS = new Set([
  'level', 'message', 'timestamp', 'stack', 'displayLevel', 'service', 'event', 'splat',
]);

function safeStringify(value, maxLength = 1200) {
  const seen = new WeakSet();
  let text;
  try {
    text = JSON.stringify(value, (key, val) => {
      if (val instanceof Error) return { message: val.message, code: val.code, stack: val.stack };
      if (typeof val === 'bigint') return val.toString();
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    text = String(value);
  }
  return text && text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

// The console is all Railway shows. It used to print only the message, silently dropping every
// detail passed alongside it — logger.error('Ticket setup error', { error, guildId }) printed just
// "Ticket setup error". Non-empty extra fields are now appended as compact JSON.
const logFormat = printf((info) => {
  const { level, message, timestamp, stack, displayLevel } = info;
  const visibleLevel = displayLevel || level;
  const extras = {};
  for (const [key, value] of Object.entries(info)) {
    if (CONSOLE_HIDDEN_KEYS.has(key) || value === null || value === undefined) continue;
    extras[key] = value;
  }
  const extraText = Object.keys(extras).length > 0 ? ` ${safeStringify(extras)}` : '';
  // logger.error('Context:', err) — keep the context text, which the stack alone doesn't contain.
  const body = stack
    ? (String(stack).includes(String(message)) ? stack : `${message}\n${stack}`)
    : message;
  return `[${timestamp}] [${visibleLevel}]: ${body}${extraText}`;
});

const attachTraceContext = format((info) => {
  const traceContext = getTraceContext();
  if (!traceContext) {
    return info;
  }

  info.traceId = info.traceId || traceContext.traceId;
  info.guildId = info.guildId || traceContext.guildId;
  info.userId = info.userId || traceContext.userId;
  info.command = info.command || traceContext.command;
  info.interactionId = info.interactionId || traceContext.interactionId;

  return info;
});

function deriveErrorCode(info) {
  if (info.errorCode) {
    return info.errorCode;
  }

  if (typeof info.code === 'string' || typeof info.code === 'number') {
    return String(info.code);
  }

  if (typeof info.type === 'string') {
    return info.type;
  }

  if (info.error && (typeof info.error.code === 'string' || typeof info.error.code === 'number')) {
    return String(info.error.code);
  }

  return null;
}

function normalizeEvent(info) {
  if (typeof info.event === 'string' && info.event.trim()) {
    return info.event;
  }

  const displayLevel = typeof info.displayLevel === 'string' ? info.displayLevel.toLowerCase().trim() : null;
  if (displayLevel === 'startup') {
    return 'system.startup';
  }

  if (displayLevel === 'status') {
    return 'system.status';
  }

  return `log.${info.level || 'info'}`;
}

const enforceLogSchema = format((info) => {
  info.event = normalizeEvent(info);
  info.guildId = info.guildId ?? LOG_SCHEMA_DEFAULTS.guildId;
  info.userId = info.userId ?? LOG_SCHEMA_DEFAULTS.userId;
  info.command = info.command ?? LOG_SCHEMA_DEFAULTS.command;
  info.traceId = info.traceId ?? LOG_SCHEMA_DEFAULTS.traceId;
  info.errorCode = deriveErrorCode(info);
  return info;
});

const logger = createLogger({
  level: resolvedLogLevel,
  format: combine(
    attachTraceContext(),
    enforceLogSchema(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'nexus-bot' },
  // The process has its own uncaughtException/unhandledRejection handlers ("Railway Shield" in
  // src/app.js) meant to keep the bot online; winston's default exitOnError=true killed the process
  // on the very first uncaught exception anyway.
  exitOnError: false,
  // LOG_TO_FILE=false turns off the rotating log files (the console is what Railway shows; files
  // in the container are lost on every redeploy anyway).
  transports: FILE_LOGGING_ENABLED ? [
    new transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/error-%DATE%.log'),
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
    new transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/combined-%DATE%.log'),
      maxSize: '20m',
      maxFiles: '7d',
      zippedArchive: true,
    }),
  ] : [],
  exceptionHandlers: FILE_LOGGING_ENABLED ? [
    new transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/exceptions-%DATE%.log'),
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
  ] : [],
  rejectionHandlers: FILE_LOGGING_ENABLED ? [
    new transports.DailyRotateFile({
      filename: path.join(__dirname, '../../logs/rejections-%DATE%.log'),
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
  ] : [],
});

logger.add(new transports.Console({
  format: combine(
    colorize(),
    timestamp({ format: 'HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  level: resolvedLogLevel,
}));

logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

if (pendingInvalidLevelWarning) {
  logger.warn(pendingInvalidLevelWarning);
}

function startupLog(message) {
  if (shouldPromoteUserFacingLogs) {
    logger.log({
      level: 'warn',
      message,
      displayLevel: 'startup',
    });
    return;
  }

  logger.log({
    level: 'info',
    message,
    displayLevel: 'startup',
  });
}

function shutdownLog(message) {
  if (shouldPromoteUserFacingLogs) {
    logger.log({
      level: 'warn',
      message,
      displayLevel: 'status',
    });
    return;
  }

  logger.log({
    level: 'info',
    message,
    displayLevel: 'status',
  });
}

export { logger, startupLog, shutdownLog };

export default logger;


