import { PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from './guildConfig.js';

// ── Config & Defaults ──────────────────────────────────────────────────────────
const DB_KEY      = (guildId) => `guild:${guildId}:auto_slowmode`;
const WINDOW_MS   = 5000;   // 5-second rolling window
const COOLDOWN_MS = 30000;  // 30s of calm before removing slowmode

// ── Tier thresholds ───────────────────────────────────────────────────────────
function getTier(count) {
  if (count >= 10) return 5;
  if (count >= 5)  return 1;
  return 0;
}

// ── In-memory enabled cache (guild id → boolean) ──────────────────────────────
const enabledCache = new Map();

export async function isEnabledForGuild(guildId, client = null) {
  if (enabledCache.has(guildId)) return enabledCache.get(guildId);
  try {
    const directConfig = await getFromDb(DB_KEY(guildId), null);
    if (directConfig?.enabled !== undefined) {
      const enabled = Boolean(directConfig.enabled);
      enabledCache.set(guildId, enabled);
      return enabled;
    }

    if (client) {
      const gConfig = await getGuildConfig(client, guildId).catch(() => null);
      if (gConfig?.autoSlowmode?.enabled !== undefined) {
        const enabled = Boolean(gConfig.autoSlowmode.enabled);
        enabledCache.set(guildId, enabled);
        return enabled;
      }
    }

    enabledCache.set(guildId, false);
    return false;
  } catch {
    return false;
  }
}

// ── In-memory per-channel state ───────────────────────────────────────────────
// channelId → { timestamps: number[], currentSlowmode: number, timer: NodeJS.Timeout|null }
const state = new Map();

function getChannelState(channelId) {
  if (!state.has(channelId)) {
    state.set(channelId, { timestamps: [], currentSlowmode: 0, timer: null });
  }
  return state.get(channelId);
}

// Found by a code review: every distinct channel that ever receives a message while auto-slowmode
// is enabled gets a permanent entry here — never deleted on channel delete, guild leave, or even
// in disableAutoSlowmode (which only clears pending timers, never removes the entries themselves).
// For a bot active across many guilds over a long uptime, this grows unbounded with the total
// number of distinct channels ever seen, for the life of the process. Swept periodically instead:
// an entry is safe to remove once it has no recent activity (timestamps empty — pruneWindow
// already clears anything older than WINDOW_MS on access), no elevated slowmode still in effect,
// and no pending timer — at that point it holds no state at all beyond what getChannelState()
// would hand back fresh anyway, so removing it changes nothing observable, just reclaims memory.
const STATE_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
function sweepIdleChannelState() {
  let removed = 0;
  for (const [channelId, ch] of state) {
    if (ch.timestamps.length === 0 && ch.currentSlowmode === 0 && !ch.timer) {
      state.delete(channelId);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug(`[AutoSlowmode] State sweep: removed ${removed} idle channel entr${removed === 1 ? 'y' : 'ies'}, ${state.size} remaining`);
  }
}
setInterval(sweepIdleChannelState, STATE_SWEEP_INTERVAL_MS).unref();

function pruneWindow(timestamps) {
  const cutoff = Date.now() - WINDOW_MS;
  return timestamps.filter(ts => ts > cutoff);
}

async function applySlowmode(channel, seconds, reason) {
  try {
    if (typeof channel.setRateLimitPerUser !== 'function') return;

    // Verify bot has ManageChannels permissions
    const botMember = channel.guild?.members?.me;
    if (botMember && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
      logger.warn(`[AutoSlowmode] Cannot set slowmode in #${channel.name}: Bot lacks ManageChannels permission.`);
      return;
    }

    await channel.setRateLimitPerUser(seconds, reason);
    logger.info(`[AutoSlowmode] Set slowmode to ${seconds}s in #${channel.name} (${channel.guild.name})`);
  } catch (err) {
    logger.warn(`[AutoSlowmode] Failed to set slowmode in ${channel.id}: ${err.message}`);
  }
}

// ── Calm-down helper ──────────────────────────────────────────────────────────
function scheduleCalmdown(ch, channel) {
  if (ch.timer) return; // already counting down

  ch.timer = setTimeout(async () => {
    ch.timer = null;
    const fresh = pruneWindow(ch.timestamps);
    if (getTier(fresh.length) === 0) {
      // Still calm — remove slowmode
      ch.currentSlowmode = 0;
      ch.timestamps      = fresh;
      await applySlowmode(channel, 0, 'AutoSlowmode: activity normalized');
      await channel.send({
        content: '✅ **Slowmode removed** — activity has returned to normal.'
      }).catch(() => null);
    } else {
      // Activity picked back up while we were waiting — restart the timer
      scheduleCalmdown(ch, channel);
    }
  }, COOLDOWN_MS);
}

// ── Main per-message handler ──────────────────────────────────────────────────
export async function handleAutoSlowmode(message) {
  if (message.author?.bot) return;
  if (!message.guild || !message.channel) return;
  if (typeof message.channel.setRateLimitPerUser !== 'function') return;

  // Fast in-memory / DB check
  const isEnabled = await isEnabledForGuild(message.guild.id, message.client);
  if (!isEnabled) return;

  const { channel } = message;
  const ch  = getChannelState(channel.id);
  const now = Date.now();

  ch.timestamps = pruneWindow(ch.timestamps);
  ch.timestamps.push(now);

  const count           = ch.timestamps.length;
  const targetSlowmode  = getTier(count);

  // ── Spike: raise (or escalate) slowmode ──────────────────────────────────
  if (targetSlowmode > ch.currentSlowmode) {
    // Cancel any pending calm-down timer — we're spiking again
    if (ch.timer) { clearTimeout(ch.timer); ch.timer = null; }

    ch.currentSlowmode = targetSlowmode;
    await applySlowmode(channel, targetSlowmode, 'AutoSlowmode: message spike detected');

    const label = targetSlowmode === 1 ? '1 second' : `${targetSlowmode} seconds`;
    await channel.send({
      content: `🐢 **Slowmode activated** — ${label} per message due to a high-speed message spike (${count} msgs in 5s). It will automatically be removed once activity calms down.`
    }).catch(() => null);
    return;
  }

  // ── Calm: activity dropped below the tier — start cooldown if needed ─────
  if (ch.currentSlowmode > 0 && targetSlowmode === 0) {
    scheduleCalmdown(ch, channel);
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────
export async function getAutoSlowmodeConfig(guildId) {
  try {
    const config = await getFromDb(DB_KEY(guildId), null);
    return config || { enabled: false };
  } catch {
    return { enabled: false };
  }
}

export async function enableAutoSlowmode(guildId) {
  try {
    await setInDb(DB_KEY(guildId), { enabled: true, updatedAt: Date.now() });
    enabledCache.set(guildId, true);   // keep cache in sync immediately
    return true;
  } catch {
    return false;
  }
}

export async function disableAutoSlowmode(guildId) {
  try {
    await setInDb(DB_KEY(guildId), { enabled: false, updatedAt: Date.now() });
    enabledCache.set(guildId, false);  // keep cache in sync immediately
    // Clean up any active slowmodes for this guild — best-effort
    state.forEach((ch) => {
      if (ch.timer) { clearTimeout(ch.timer); ch.timer = null; }
    });
    return true;
  } catch {
    return false;
  }
}
