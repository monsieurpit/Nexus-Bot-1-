// Pure helpers for the Firestore backup file format (no Firebase connection here, so they can be
// unit-tested). Used by scripts/firestore-backup.js and scripts/firestore-restore.js.
import { createHash } from 'node:crypto';

export const BACKUP_FORMAT = 'nexus-firestore-backup';
export const BACKUP_VERSION = 1;

// Every top-level collection the bot reads or writes (src/utils/firestoreDatabase.js). Nexus AI
// does not use Firestore, so nothing outside the bot depends on these.
export const TOP_LEVEL_COLLECTIONS = [
  'afk', 'app_roles', 'app_settings', 'app_users', 'applications', 'autosave_configs',
  'economy_balances', 'economy_configs', 'economy_inventories', 'economy_participants', 'economy_shops',
  'embed_buttons', 'embeds', 'fake_accounts', 'football', 'football_configs', 'giveaways', 'guilds',
  'invite_tracking', 'invite_uses', 'jointocreate_channels', 'jointocreate_configs', 'kv_data',
  'laliga_standings_configs', 'leveling', 'leveling_configs', 'logging_configs', 'member_invites',
  'moderation', 'modlog_settings', 'modlog_users', 'modlogs', 'quarantines', 'raidshield_configs',
  'reaction_roles', 'reports', 'server_save_snapshots', 'server_saves', 'serverstats_cache',
  'serverstats_configs', 'serverstats_counters', 'sticky_notes', 'system', 'ticket_configs',
  'ticket_counters', 'tickets', 'vc_event_configs', 'verification_audit', 'verification_configs',
  'weekly_stats', 'weekly_stats_history', 'welcome',
];

// Legacy per-guild subcollections (guilds/{guildId}/<name>) still read as a fallback.
export const GUILD_SUBCOLLECTIONS = ['user_levels', 'tickets', 'afk'];

/**
 * Firestore values → JSON. Plain JSON round-trips as-is; Timestamps (if any were ever written)
 * are tagged so a restore writes a Timestamp back rather than a plain map.
 */
export function encodeValue(value, isTimestamp) {
  if (value === null || typeof value !== 'object') return value;
  if (isTimestamp(value)) return { __nexusType: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map((v) => encodeValue(v, isTimestamp));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v, isTimestamp);
  return out;
}

export function decodeValue(value, makeTimestamp) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => decodeValue(v, makeTimestamp));
  if (value.__nexusType === 'timestamp') return makeTimestamp(value.seconds, value.nanoseconds);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = decodeValue(v, makeTimestamp);
  return out;
}

// Deterministic JSON (sorted keys) so the checksum doesn't depend on property order.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function checksumOf(collections) {
  return createHash('sha256').update(stableStringify(collections)).digest('hex');
}

export function buildBackup({ projectId, databaseId, collections, createdAt = new Date().toISOString() }) {
  const counts = Object.fromEntries(Object.entries(collections).map(([path, docs]) => [path, docs.length]));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    projectId,
    databaseId,
    counts,
    totalDocuments: Object.values(counts).reduce((a, b) => a + b, 0),
    sha256: checksumOf(collections),
    collections,
  };
}

/**
 * Throws with a precise reason when a backup must NOT be restored: wrong format, unknown version,
 * a different Firebase project/database than the target, malformed entries, or a checksum that
 * no longer matches (truncated or edited file).
 */
export function validateBackup(backup, { projectId, databaseId } = {}) {
  if (!backup || typeof backup !== 'object') throw new Error('Not a backup file (not a JSON object).');
  if (backup.format !== BACKUP_FORMAT) throw new Error(`Unexpected format "${backup.format}" (expected ${BACKUP_FORMAT}).`);
  if (backup.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${backup.version} (this tool reads version ${BACKUP_VERSION}).`);
  if (!backup.collections || typeof backup.collections !== 'object') throw new Error('Backup has no collections.');
  for (const [path, docs] of Object.entries(backup.collections)) {
    if (!Array.isArray(docs)) throw new Error(`Collection ${path} is not a list.`);
    const segments = path.split('/');
    if (segments.length % 2 !== 1 || segments.some((s) => !s)) throw new Error(`Invalid collection path "${path}".`);
    for (const d of docs) {
      if (!d || typeof d.id !== 'string' || !d.id || d.id.includes('/')) throw new Error(`Invalid document id in ${path}.`);
      if (!d.data || typeof d.data !== 'object' || Array.isArray(d.data)) throw new Error(`Invalid document data for ${path}/${d.id}.`);
    }
  }
  const actual = checksumOf(backup.collections);
  if (actual !== backup.sha256) throw new Error('Checksum mismatch: the backup file is corrupted or was modified.');
  if (projectId && backup.projectId && backup.projectId !== projectId) {
    throw new Error(`Backup is from project "${backup.projectId}", target is "${projectId}" (use --allow-other-project to override).`);
  }
  if (databaseId && backup.databaseId && backup.databaseId !== databaseId) {
    throw new Error(`Backup is from database "${backup.databaseId}", target is "${databaseId}" (use --allow-other-project to override).`);
  }
  return true;
}
