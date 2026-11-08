#!/usr/bin/env node
// Full backup of the bot's PRIMARY database (Firestore). The existing backup:db / restore:db /
// backup:drill scripts only cover the PostgreSQL fallback (pg_dump), so the database Nexus
// actually runs on had no backup tooling at all.
//
// Usage:  npm run backup:firestore [-- --out ./backups] [--retention-days 30]
// Output: <out>/firestore-<timestamp>.json  (raw documents of every bot collection + sha256)
// Env:    FIREBASE_AUTH_EMAIL / FIREBASE_AUTH_PASSWORD when the Firestore rules require auth.
import 'dotenv/config';
import { mkdir, writeFile, readdir, stat, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { connectFirestore } from './lib/firestoreConnect.js';
import { TOP_LEVEL_COLLECTIONS, GUILD_SUBCOLLECTIONS, encodeValue, buildBackup } from './lib/firestoreBackupFormat.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const isTimestamp = (v) => v instanceof Timestamp;

async function dumpCollection(db, pathSegments) {
  const snap = await getDocs(collection(db, ...pathSegments));
  return snap.docs.map((d) => ({ id: d.id, data: encodeValue(d.data(), isTimestamp) }));
}

async function main() {
  const outDir = path.resolve(arg('out', process.env.BACKUP_DIR || './backups'));
  const retentionDays = Number(arg('retention-days', process.env.BACKUP_RETENTION_DAYS || 30));
  const fs = await connectFirestore();
  const collections = {};
  try {
    for (const name of TOP_LEVEL_COLLECTIONS) {
      collections[name] = await dumpCollection(fs.db, [name]);
    }
    for (const guild of collections.guilds || []) {
      for (const sub of GUILD_SUBCOLLECTIONS) {
        const docs = await dumpCollection(fs.db, ['guilds', guild.id, sub]);
        if (docs.length) collections[`guilds/${guild.id}/${sub}`] = docs;
      }
    }
  } finally {
    await fs.close();
  }

  const backup = buildBackup({ projectId: fs.projectId, databaseId: fs.databaseId, collections });
  if (backup.totalDocuments === 0) {
    // An empty dump almost always means missing permissions, not an empty bot.
    throw new Error('Backup contains 0 documents — refusing to write it (check Firestore rules / FIREBASE_AUTH_* variables).');
  }

  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `firestore-${stamp}.json`);
  // Write to a temp name first so a crash never leaves a half-written file that looks complete.
  await writeFile(`${file}.partial`, JSON.stringify(backup));
  await rename(`${file}.partial`, file);
  console.log(`✅ Firestore backup written: ${file}`);
  console.log(`   ${backup.totalDocuments} documents in ${Object.keys(collections).length} collections, sha256 ${backup.sha256.slice(0, 16)}…`);

  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    const cutoff = Date.now() - retentionDays * 86400000;
    let removed = 0;
    for (const entry of await readdir(outDir)) {
      if (!/^firestore-.*\.json$/.test(entry)) continue;
      const full = path.join(outDir, entry);
      if (full !== file && (await stat(full)).mtimeMs < cutoff) {
        await unlink(full);
        removed++;
      }
    }
    if (removed) console.log(`   Pruned ${removed} backup(s) older than ${retentionDays} days.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`❌ Firestore backup failed: ${err.message}`);
  process.exit(1);
});
