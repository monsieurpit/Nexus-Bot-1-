import { z } from 'zod';
import { createError, ErrorTypes } from './errorHandler.js';

export const LogIgnoreSchema = z
  .object({
    users: z.array(z.string()).default([]),
    channels: z.array(z.string()).default([])
  })
  .default({ users: [], channels: [] });

export const LoggingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    channelId: z.string().nullable().optional(),
    enabledEvents: z.record(z.boolean()).default({})
  })
  .default({ enabled: false, enabledEvents: {} });

const TicketLoggingSchema = z
  .object({
    lifecycleChannelId: z.string().nullable().optional(),
    transcriptChannelId: z.string().nullable().optional()
  })
  .optional();

const AutoVerifyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    criteria: z.enum(['account_age', 'server_size', 'none']).default('none'),
    accountAgeDays: z.number().int().min(1).max(365).nullable().optional(),
    roleId: z.string().nullable().optional()
  })
  .optional();

const VerificationConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    channelId: z.string().nullable().optional(),
    messageId: z.string().nullable().optional(),
    roleId: z.string().optional(),
    message: z.string().optional(),
    buttonText: z.string().default('Verify'),
    autoVerify: AutoVerifyConfigSchema
  })
  .optional();

const FootballConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    channelId: z.string().nullable().optional(),
    roleId: z.string().nullable().optional(),
    postedMatches: z.array(z.string()).default([]),
    customMatches: z.array(z.any()).default([]),
    scheduleChannelId: z.string().nullable().optional(),
    scheduleMessageId: z.string().nullable().optional(),
    scheduleEnabled: z.boolean().default(true)
  })
  .passthrough()
  .optional();

export const GuildConfigSchema = z
  .object({
    prefix: z.string().optional(),
    modRole: z.string().nullable().optional(),
    adminRole: z.string().nullable().optional(),
    logChannelId: z.string().nullable().optional(),
    welcomeChannel: z.string().nullable().optional(),
    welcomeMessage: z.string().optional(),
    autoRole: z.string().nullable().optional(),
    dmOnClose: z.boolean().optional(),
    reportChannelId: z.string().nullable().optional(),
    premiumRoleId: z.string().nullable().optional(),
    staffSuggestionChannelId: z.string().nullable().optional(),
    logIgnore: LogIgnoreSchema.optional().nullable(),
    enabledCommands: z.record(z.boolean()).optional().nullable(),
    logging: LoggingConfigSchema.optional().nullable(),
    ticketLogging: TicketLoggingSchema.optional().nullable(),
    enableLogging: z.boolean().optional().nullable(),
    verification: VerificationConfigSchema.optional().nullable(),
    football: FootballConfigSchema.optional().nullable()
  })
  .passthrough();


export function normalizeGuildConfig(raw, defaults = {}) {
  const base = typeof raw === 'object' && raw !== null ? raw : {};
  const merged = { ...defaults, ...base };
  return merged;
}

export function validateGuildConfigOrThrow(rawConfig, context = {}) {
  if (typeof rawConfig === 'object' && rawConfig !== null) {
    return rawConfig;
  }
  return {};
}


