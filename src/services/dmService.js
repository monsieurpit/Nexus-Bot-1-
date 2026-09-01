import { logger } from '../utils/logger.js';

const DM_SESSION_KEY = (userId) => `dm_session:${userId}`;
const inMemoryDmSessions = new Map();

// Found by a code review: every setDmSession call permanently adds two entries to this Map (one
// per side of the link) with no TTL or eviction — each entry already stores an `updatedAt`
// timestamp, but nothing anywhere ever reads it to expire anything. For a bot with a long uptime,
// this grows without bound, proportional to the total number of distinct users who have ever used
// DM routing, for the life of the process. Same fix pattern already used for this exact bug class
// in rateLimiter.js this session: a periodic sweep removing entries past a staleness threshold —
// this is purely an in-process cache in front of the real DB record (getDmSession falls back to
// client.db.get and re-populates the cache on a miss), so pruning a stale entry here never loses
// data, it just means the next lookup for that user re-fetches from the DB instead of hitting the
// in-memory cache.
const DM_SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DM_SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
function sweepStaleDmSessions() {
  const now = Date.now();
  let removed = 0;
  for (const [userId, session] of inMemoryDmSessions) {
    if (now - session.updatedAt > DM_SESSION_CACHE_TTL_MS) {
      inMemoryDmSessions.delete(userId);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug(`DM session cache sweep: removed ${removed} stale entr${removed === 1 ? 'y' : 'ies'}, ${inMemoryDmSessions.size} remaining`);
  }
}
setInterval(sweepStaleDmSessions, DM_SESSION_SWEEP_INTERVAL_MS).unref();

/**
 * Saves a DM routing session between sender and target
 */
export async function setDmSession(client, userAId, userBId) {
  const sessionDataA = { linkedUserId: userBId, updatedAt: Date.now() };
  const sessionDataB = { linkedUserId: userAId, updatedAt: Date.now() };

  inMemoryDmSessions.set(userAId, sessionDataA);
  inMemoryDmSessions.set(userBId, sessionDataB);

  if (client?.db) {
    await client.db.set(DM_SESSION_KEY(userAId), sessionDataA).catch(() => null);
    await client.db.set(DM_SESSION_KEY(userBId), sessionDataB).catch(() => null);
  }
}

/**
 * Gets active DM routing session for a user
 */
export async function getDmSession(client, userId) {
  if (inMemoryDmSessions.has(userId)) {
    return inMemoryDmSessions.get(userId);
  }

  if (client?.db) {
    const raw = await client.db.get(DM_SESSION_KEY(userId)).catch(() => null);
    if (raw) {
      inMemoryDmSessions.set(userId, raw);
      return raw;
    }
  }

  return null;
}

/**
 * Sends a plain text DM to a target user and establishes routing for replies
 */
export async function sendDirectMessage(client, senderUser, targetUser, textContent) {
  try {
    // Send plain text DM to target user with no bot metadata or auto-sent labels
    const sentMessage = await targetUser.send({
      content: textContent
    });

    // Save session mapping so when target replies, it forwards back to sender
    await setDmSession(client, targetUser.id, senderUser.id);

    logger.info(`Direct message delivered to user ${targetUser.tag} (${targetUser.id}) from sender ${senderUser.tag}`);
    return { success: true, message: sentMessage };
  } catch (error) {
    logger.warn(`Failed to send DM to user ${targetUser.id}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Handles incoming DM messages from users and forwards them back to the linked user
 */
export async function handleDirectMessage(message, client) {
  if (message.guild || message.author.bot) return;

  try {
    const session = await getDmSession(client, message.author.id);
    if (!session || !session.linkedUserId) {
      logger.debug(`Received DM from ${message.author.tag} with no active routing session.`);
      return;
    }

    const linkedUser = await client.users.fetch(session.linkedUserId).catch(() => null);
    if (!linkedUser) {
      logger.warn(`Could not fetch linked DM user ${session.linkedUserId} for ${message.author.id}`);
      return;
    }

    // Prepare plain text reply forwarding without any auto-sent or bot branding text
    let forwardContent = message.content || '';

    // Handle attachments if present
    if (message.attachments.size > 0) {
      const attachmentUrls = message.attachments.map(att => att.url).join('\n');
      forwardContent = forwardContent ? `${forwardContent}\n\n${attachmentUrls}` : attachmentUrls;
    }

    if (!forwardContent.trim()) {
      return;
    }

    // Send plain text directly to the linked user
    await linkedUser.send({
      content: forwardContent
    });

    // Refresh session timestamp
    await setDmSession(client, message.author.id, linkedUser.id);

    logger.info(`Forwarded DM reply from ${message.author.tag} (${message.author.id}) to ${linkedUser.tag} (${linkedUser.id})`);
  } catch (error) {
    logger.error(`Error handling DM message from ${message.author?.id}:`, error);
  }
}
