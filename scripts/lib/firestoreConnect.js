// Side-effect-free Firestore connection for the backup/restore scripts. The bot's own
// firestoreDb.connect() writes a status document and starts a background migration, which a
// backup tool must never do.
import { initializeApp } from 'firebase/app';
import { getFirestore, terminate } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function connectFirestore() {
  const config = require('../../firebase-applet-config.json');
  const app = initializeApp(config, `nexus-backup-${process.pid}-${Date.now()}`);
  const { FIREBASE_AUTH_EMAIL: email, FIREBASE_AUTH_PASSWORD: password } = process.env;
  if (email && password) {
    await signInWithEmailAndPassword(getAuth(app), email, password);
  }
  const databaseId = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)' ? config.firestoreDatabaseId : undefined;
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  return {
    db,
    projectId: config.projectId,
    databaseId: config.firestoreDatabaseId || '(default)',
    close: () => terminate(db).catch(() => {}),
  };
}
