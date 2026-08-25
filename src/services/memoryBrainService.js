/**
 * Nexus Cross-Conversation Memory Service
 *
 * Persists small, durable facts about a Discord user (favorite team, which football game they
 * play, preferred name, etc.) between separate conversations, keyed by their Discord user ID, so
 * the real Nexus AI engine (Nexus-AI- repo) can recall them on a later message even though
 * Discord messages aren't a single continuous session the way the engine's own `history` array
 * is. Uses the same client.db key-value store already proven for other per-user/per-guild state
 * elsewhere in this codebase (leveling, permGuardService, reactionRoleService, etc.) rather than
 * a new storage mechanism.
 *
 * This used to be a fully stubbed-out no-op ("Training & Fact Memorization Disabled") with zero
 * callers anywhere in the codebase — the AI engine side already had real logic to use memories if
 * given any (a "what do you remember about me" recall path), but nothing on the bot side ever
 * persisted or supplied them, so that logic was permanently dead in practice.
 */

const MAX_MEMORIES_PER_USER = 25;

function memoryKey(userId) {
  return `nexus:memory:${userId}`;
}

/**
 * Loads the stored memories for a user, in the {key, fact, confidence, timestamp}[] shape the
 * engine's /api/v1/nexus endpoint expects for its `memories` request field.
 */
export async function getUserMemories(client, userId) {
  if (!client?.db?.get || !userId) return [];
  try {
    const stored = await client.db.get(memoryKey(userId));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

/**
 * Saves one new fact for a user, called with the `newMemory` field the engine returns when it
 * extracted something new from the user's message. Replaces any existing entry with the same key
 * (e.g. a new "favoriteTeam" overwrites an old one instead of both piling up) and caps the total
 * list size so it can't grow unbounded over a long relationship with an active user.
 */
export async function saveUserMemory(client, userId, newMemory) {
  if (!client?.db?.set || !userId || !newMemory?.key || !newMemory?.fact) return;
  try {
    const existing = await getUserMemories(client, userId);
    const withoutDuplicateKey = existing.filter((m) => m.key !== newMemory.key);
    const updated = [
      ...withoutDuplicateKey,
      { key: newMemory.key, fact: newMemory.fact, confidence: 1, timestamp: Date.now() },
    ].slice(-MAX_MEMORIES_PER_USER);
    await client.db.set(memoryKey(userId), updated);
  } catch {
    // Best-effort — a failed save shouldn't ever break the actual reply the user is waiting on.
  }
}

/**
 * Clears everything stored about a user. Not currently wired to a command, but available for
 * when one's added (a "forget me"/privacy-request command is the obvious future caller).
 */
export async function forgetUserMemories(client, userId) {
  if (!client?.db?.delete || !userId) return;
  await client.db.delete(memoryKey(userId)).catch(() => {});
}
