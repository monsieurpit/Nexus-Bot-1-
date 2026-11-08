#!/usr/bin/env node
// Restores a backup made by scripts/firestore-backup.js.
//
// SAFE BY DEFAULT: without --apply it only validates the file and prints what would be written.
//   npm run restore:firestore -- --file backups/firestore-XXXX.json            (dry run)
//   npm run restore:firestore -- --file backups/firestore-XXXX.json --apply    (write)
//   ... --collections economy_balances,leveling   restore only these collections
//
// Before anything is written:
//   - the file's format, version, structure and sha256 are verified (a truncated or edited file is
//     refused), and so is the source project/database (override: --allow-other-project);
//   - a fresh safety backup of the CURRENT data is taken (skip: --no-safety-backup).
// Restore overwrites the documents contained in the backup and never deletes documents that are
// not in it, so data created after the backup is kept.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { doc, getDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { connectFirestore } from './lib/firestoreConnect.js';
import { validateBackup, decodeValue } from './lib/firestoreBackupFormat.js';

const has = (flag) => process.argv.includes(`--${flag}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg('file');
  if (!file) throw new Error('Missing --file <backup.json>');
  const apply = has('apply');
  const only = arg('collections') ? new Set(arg('collections').split(',').map((s) => s.trim())) : null;

  const backup = JSON.parse(await readFile(file, 'utf8'));
  const fs = await connectFirestore();
  try {
    validateBackup(backup, has('allow-other-project') ? {} : { projectId: fs.projectId, databaseId: fs.databaseId });
    console.log(`✅ Backup verified: ${backup.totalDocuments} documents from ${backup.createdAt} (${backup.projectId}/${backup.databaseId})`);

    const plan = Object.entries(backup.collections).filter(([p]) => !only || only.has(p) || only.has(p.split('/')[0]));
    let existing = 0;
    let total = 0;
    for (const [p, docs] of plan) {
      let colExisting = 0;
      for (const d of docs) {
        if ((await getDoc(doc(fs.db, ...p.split('/'), d.id))).exists()) colExisting++;
      }
      existing += colExisting;
      total += docs.length;
      console.log(`   ${p}: ${docs.length} document(s), ${colExisting} would be overwritten`);
    }

    if (!apply) {
      console.log(`\nDry run: ${total} document(s) would be written (${existing} overwritten). Re-run with --apply to restore.`);
      return;
    }

    if (!has('no-safety-backup')) {
      console.log('\n📦 Taking a safety backup of the current data first…');
      const backupScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'firestore-backup.js');
      const res = spawnSync(process.execPath, [backupScript, '--out', path.resolve(process.env.BACKUP_DIR || './backups', 'pre-restore'), '--retention-days', '0'], { stdio: 'inherit' });
      if (res.status !== 0) throw new Error('Safety backup failed — restore aborted, nothing was written.');
    }

    const makeTimestamp = (s, ns) => new Timestamp(s, ns);
    let written = 0;
    for (const [p, docs] of plan) {
      // Firestore batches are limited to 500 writes.
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(fs.db);
        for (const d of docs.slice(i, i + 400)) {
          batch.set(doc(fs.db, ...p.split('/'), d.id), decodeValue(d.data, makeTimestamp));
        }
        await batch.commit();
        written += Math.min(400, docs.length - i);
      }
    }
    console.log(`\n✅ Restore complete: ${written} document(s) written. Restart the bot so its read cache is cleared.`);
  } finally {
    await fs.close();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`❌ Firestore restore failed: ${err.message}`);
  process.exit(1);
});
