// "Nexus Code" — repo-editing service. Shared by dashboard/server/routes/codeedit.js.
//
// Owns the actual git/filesystem/diff mechanics for the feature: shallow-clone a user's own repo
// into a per-request temp dir, read one named file, diff the AI's proposed rewrite against it,
// and (only after explicit approval) commit + push with the user's own token. Also owns the
// single global concurrency lock — see acquireLock() below for why this must be bot-wide, not
// just a per-session guard.
import { randomUUID } from 'crypto';
import { mkdtemp, readFile as fsReadFile, writeFile, rm, realpath, lstat } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize, isAbsolute, sep } from 'path';
import simpleGit from 'simple-git';
import { createTwoFilesPatch, diffLines } from 'diff';
import { logger } from '../../../src/utils/logger.js';

const MAX_FILE_BYTES = 200 * 1024; // one file, not a whole-codebase refactor — see plan v1 scope
const CLONE_TIMEOUT_MS = 30_000;
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 min — matches the plan's "always cleaned up" window

// Bot-wide, not per-session: the Mac mini this runs against is documented (localLlmClient.ts) as
// already tight on memory with nexus-12b loaded. Any concurrent second clone+AI-call would stack
// on top of that, so exactly one code-edit operation may be in flight at a time, full stop.
let lockHolder = null; // { requestId, acquiredAt } | null

// requestId -> { dir, repoUrl, filePath, oldContent, newContent, diffText, createdAt, sessionToken }
const pendingRequests = new Map();

function isLocked() {
  return lockHolder !== null;
}

function acquireLock(requestId) {
  if (lockHolder) return false;
  lockHolder = { requestId, acquiredAt: Date.now() };
  return true;
}

function releaseLock(requestId) {
  if (lockHolder && lockHolder.requestId === requestId) {
    lockHolder = null;
  }
}

/** Best-effort periodic sweep so an abandoned request (crash, closed tab) can't hold the lock forever. */
setInterval(() => {
  const now = Date.now();
  for (const [requestId, req] of pendingRequests.entries()) {
    if (now - req.createdAt > PENDING_TTL_MS) {
      cleanup(requestId).catch(() => {});
    }
  }
}, 60_000).unref();

export function validateRepoUrl(repoUrl) {
  if (typeof repoUrl !== 'string' || !repoUrl.trim()) {
    throw new Error('Repo URL is required.');
  }
  const trimmed = repoUrl.trim();
  // Only accept an https GitHub URL shape — this is what the token-injection logic below assumes,
  // and it rules out ssh:// / git:// / file:// / arbitrary-host URLs that could be used to probe
  // internal network addresses from the server.
  const match = trimmed.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match) {
    throw new Error('Repo URL must look like https://github.com/<owner>/<repo>.');
  }
  return { owner: match[1], repo: match[2], clean: `https://github.com/${match[1]}/${match[2]}.git` };
}

export function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('File path is required.');
  }
  const trimmed = filePath.trim().replace(/^\/+/, '');
  const normalized = normalize(trimmed);
  if (isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error('File path must be a relative path inside the repo.');
  }
  return normalized;
}

/**
 * Clones the repo (shallow) into a fresh temp dir and reads the target file.
 * Throws on any failure — caller is responsible for cleanup on the request id it already has.
 */
/**
 * The file must be a regular file that really lives inside the clone. A repository can contain
 * symlinks (to a file, or a directory on the way to it) pointing anywhere on THIS server — e.g.
 * `/proc/self/environ`, which holds every secret (bot token, API keys, database URLs). Following
 * one would have returned that content in the "diff", and the apply step would have WRITTEN
 * through it (overwriting the bot's own files). realpath() resolves every link on the path.
 */
export async function isSafeRepoFile(dir, absoluteFilePath) {
  try {
    const [realDir, realFile, info] = await Promise.all([realpath(dir), realpath(absoluteFilePath), lstat(absoluteFilePath)]);
    return info.isFile() && !info.isSymbolicLink() && realFile.startsWith(realDir + sep);
  } catch {
    return false;
  }
}

async function cloneAndReadFile({ repoUrl, filePath, githubToken }) {
  const { clean } = validateRepoUrl(repoUrl);
  const safeFilePath = validateFilePath(filePath);

  const dir = await mkdtemp(join(tmpdir(), 'nexus-codeedit-'));

  // Token is injected into the clone URL only in-memory, for this one git invocation — never
  // written to .git/config as a persistent remote, never logged.
  const authedUrl = githubToken
    ? clean.replace('https://', `https://x-access-token:${encodeURIComponent(githubToken)}@`)
    : clean;

  const git = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });
  try {
    await git.clone(authedUrl, dir, ['--depth', '1']);
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const msg = String(err?.message || err);
    if (/authentication|403|could not read/i.test(msg)) {
      throw new Error('Could not clone the repo — check the repo URL and that the token has access to it.');
    }
    throw new Error('Could not clone the repo — it may not exist or may be unreachable.');
  }

  const absoluteFilePath = join(dir, safeFilePath);
  if (!existsSync(absoluteFilePath)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`File "${safeFilePath}" was not found in this repo.`);
  }
  if (!(await isSafeRepoFile(dir, absoluteFilePath))) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error('Invalid file path.');
  }

  const stat = await fsReadFile(absoluteFilePath).catch(() => null);
  if (!stat) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not read "${safeFilePath}".`);
  }
  if (stat.byteLength > MAX_FILE_BYTES) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`"${safeFilePath}" is too large for Nexus Code (v1 limit: ${Math.round(MAX_FILE_BYTES / 1024)}KB, one file at a time).`);
  }

  return { dir, safeFilePath, oldContent: stat.toString('utf8'), repoUrl: clean };
}

function computeDiff(filePath, oldContent, newContent) {
  const patch = createTwoFilesPatch(filePath, filePath, oldContent, newContent, '', '', { context: 3 });
  const lineDiff = diffLines(oldContent, newContent);
  return { patch, lineDiff, changed: oldContent !== newContent };
}

/**
 * Full propose flow: acquire the global lock, clone, read, ask the caller-provided AI function
 * for the rewritten file, diff, and stash the pending change server-side (NOT the token — that's
 * discarded the moment this function returns, per the plan's "never persisted" rule).
 *
 * @param {Object} opts
 * @param {string} opts.repoUrl
 * @param {string} opts.filePath
 * @param {string} opts.instruction
 * @param {string} opts.githubToken
 * @param {(oldContent: string, filePath: string, instruction: string) => Promise<string>} opts.generateEdit
 * @returns {Promise<{ requestId: string, filePath: string, patch: string, lineDiff: any[], changed: boolean }>}
 */
export async function proposeEdit({ repoUrl, filePath, instruction, githubToken, generateEdit }) {
  if (typeof instruction !== 'string' || !instruction.trim()) {
    throw new Error('An instruction describing the change is required.');
  }

  const requestId = randomUUID();
  if (!acquireLock(requestId)) {
    const err = new Error('Nexus is already working on another repo edit — try again in a minute.');
    err.code = 'BUSY';
    throw err;
  }

  try {
    const { dir, safeFilePath, oldContent, repoUrl: cleanUrl } = await cloneAndReadFile({ repoUrl, filePath, githubToken });

    let newContent;
    try {
      newContent = await generateEdit(oldContent, safeFilePath, instruction.trim());
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Nexus couldn't generate a change: ${err.message}`);
    }

    if (typeof newContent !== 'string' || !newContent.trim()) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw new Error('Nexus returned an empty response — try rephrasing the instruction.');
    }

    const { patch, lineDiff, changed } = computeDiff(safeFilePath, oldContent, newContent);
    if (!changed) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw new Error("Nexus didn't propose any actual change to this file — try a more specific instruction.");
    }

    pendingRequests.set(requestId, {
      dir,
      repoUrl: cleanUrl,
      filePath: safeFilePath,
      instruction: instruction.trim(),
      oldContent,
      newContent,
      diffText: patch,
      createdAt: Date.now(),
    });

    return { requestId, filePath: safeFilePath, patch, lineDiff, changed };
  } catch (err) {
    releaseLock(requestId);
    throw err;
  }
}

/**
 * Writes the approved content, commits, and pushes using the token (which the caller must supply
 * again here — it was never stored from proposeEdit). Releases the lock and cleans up either way.
 */
export async function applyEdit({ requestId, githubToken }) {
  const req = pendingRequests.get(requestId);
  if (!req) {
    throw new Error('This proposed change has expired or was already resolved.');
  }

  try {
    const targetPath = join(req.dir, req.filePath);
    if (!(await isSafeRepoFile(req.dir, targetPath))) {
      throw new Error('Invalid file path.');
    }
    await writeFile(targetPath, req.newContent, 'utf8');

    const git = simpleGit({ baseDir: req.dir, timeout: { block: CLONE_TIMEOUT_MS } });
    await git.addConfig('user.name', 'Nexus Code');
    await git.addConfig('user.email', 'nexus-code@noreply.local');
    await git.add(req.filePath);

    const commitMessage = `Nexus Code: ${req.instruction}`.slice(0, 200);
    await git.commit(commitMessage);

    const authedUrl = req.repoUrl.replace('https://', `https://x-access-token:${encodeURIComponent(githubToken)}@`);
    let pushResult;
    try {
      pushResult = await git.push(authedUrl, 'HEAD');
    } catch (err) {
      const msg = String(err?.message || err);
      if (/authentication|403|could not read/i.test(msg)) {
        throw new Error('Push rejected — check that the token has write access to this repo.');
      }
      if (/protected branch|rejected/i.test(msg)) {
        throw new Error('Push rejected by the remote (branch protection or a stale ref) — pull the latest changes and try again.');
      }
      throw new Error(`Push failed: ${msg}`);
    }

    const log = await git.log({ maxCount: 1 });
    const commitSha = log.latest?.hash || null;
    const { owner, repo } = validateRepoUrl(req.repoUrl);
    const commitUrl = commitSha ? `https://github.com/${owner}/${repo}/commit/${commitSha}` : null;

    return { commitSha, commitUrl, pushResult: Boolean(pushResult) };
  } finally {
    await cleanup(requestId);
  }
}

export async function rejectEdit(requestId) {
  const req = pendingRequests.get(requestId);
  if (!req) return;
  await cleanup(requestId);
}

export async function cleanup(requestId) {
  const req = pendingRequests.get(requestId);
  pendingRequests.delete(requestId);
  releaseLock(requestId);
  if (req?.dir) {
    await rm(req.dir, { recursive: true, force: true }).catch((err) => {
      logger.warn(`[repoEditService] cleanup failed for ${req.dir}: ${err.message}`);
    });
  }
}

export function getPendingRequest(requestId) {
  const req = pendingRequests.get(requestId);
  if (!req) return null;
  return { filePath: req.filePath, diffText: req.diffText, createdAt: req.createdAt };
}

export function lockStatus() {
  return { locked: isLocked(), since: lockHolder?.acquiredAt || null };
}
