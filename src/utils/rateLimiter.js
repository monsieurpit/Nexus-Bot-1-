import { logger } from './logger.js';

const rateLimitStore = new Map();

// Found by a code review: entries were only ever added or overwritten in place, never removed
// after their own rate-limit window expired - the two cleanup functions further down
// (clearRateLimit/clearAllRateLimits) are never actually called from any production code path,
// only from a test helper. Keys used across the codebase are per-user and often per-guild-per-
// user (nexus-ai:${userId}, xp-event:${guildId}:${userId}, ${userId}:shared_todo_add, per-user
// ticket/economy keys), so on a 12,000+ member server staying up for weeks, this Map accumulates
// one permanent entry per unique key ever seen - a genuine, unbounded memory leak over long
// uptime. Periodic sweep below removes entries whose OWN recorded window has already expired
// (the same condition checkRateLimit() itself already treats as "doesn't exist" when it's next
// checked - pruning it early just reclaims the memory sooner, doesn't change behavior at all).
const RATE_LIMIT_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
function sweepExpiredRateLimits() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > entry.windowMs) {
      rateLimitStore.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug(`Rate limiter sweep: removed ${removed} expired entr${removed === 1 ? 'y' : 'ies'}, ${rateLimitStore.size} remaining`);
  }
}
setInterval(sweepExpiredRateLimits, RATE_LIMIT_SWEEP_INTERVAL_MS).unref();




export async function checkRateLimit(key, maxAttempts = 5, windowMs = 60000) {
  try {
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    
    if (!entry || now - entry.windowStart > windowMs) {
      // windowMs stored alongside the entry so the periodic sweep above can tell when THIS
      // specific key's window has expired, without needing every caller's windowMs value handy.
      rateLimitStore.set(key, {
        count: 1,
        windowStart: now,
        windowMs
      });
      return true;
    }

    
    if (entry.count < maxAttempts) {
      entry.count++;
      return true;
    }

    
    logger.debug(`Rate limit exceeded for ${key}`);
    return false;
  } catch (error) {
    logger.error('Error checking rate limit:', error);
    return true; 
  }
}







export function getRateLimitStatus(key, windowMs = 60000) {
  const entry = rateLimitStore.get(key);
  if (!entry) {
    return { limited: false, remaining: windowMs };
  }

  const elapsed = Date.now() - entry.windowStart;
  const remaining = Math.max(0, windowMs - elapsed);

  return {
    limited: remaining > 0,
    remaining,
    attempts: entry.count
  };
}





export function clearRateLimit(key) {
  rateLimitStore.delete(key);
}




export function clearAllRateLimits() {
  rateLimitStore.clear();
  logger.info('All rate limits cleared');
}
