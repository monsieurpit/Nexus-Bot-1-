import test from 'node:test';
import assert from 'node:assert/strict';

import { validateRepoUrl, validateFilePath, lockStatus } from '../../dashboard/server/services/repoEditService.js';

// --- validateRepoUrl ---

test('validateRepoUrl accepts a plain https GitHub URL', () => {
  const { owner, repo, clean } = validateRepoUrl('https://github.com/octocat/Hello-World');
  assert.equal(owner, 'octocat');
  assert.equal(repo, 'Hello-World');
  assert.equal(clean, 'https://github.com/octocat/Hello-World.git');
});

test('validateRepoUrl accepts a URL already ending in .git and a trailing slash', () => {
  assert.equal(validateRepoUrl('https://github.com/octocat/Hello-World.git').clean, 'https://github.com/octocat/Hello-World.git');
  assert.equal(validateRepoUrl('https://github.com/octocat/Hello-World/').clean, 'https://github.com/octocat/Hello-World.git');
});

test('validateRepoUrl rejects non-GitHub hosts', () => {
  assert.throws(() => validateRepoUrl('https://gitlab.com/owner/repo'), /must look like/);
});

test('validateRepoUrl rejects non-https schemes', () => {
  assert.throws(() => validateRepoUrl('git@github.com:owner/repo.git'), /must look like/);
  assert.throws(() => validateRepoUrl('ssh://github.com/owner/repo'), /must look like/);
  assert.throws(() => validateRepoUrl('file:///etc/passwd'), /must look like/);
});

test('validateRepoUrl rejects empty or missing input', () => {
  assert.throws(() => validateRepoUrl(''), /required/);
  assert.throws(() => validateRepoUrl(undefined), /required/);
});

// --- validateFilePath ---

test('validateFilePath accepts a normal relative path', () => {
  assert.equal(validateFilePath('src/index.js'), 'src/index.js');
});

test('validateFilePath strips a leading slash', () => {
  assert.equal(validateFilePath('/src/index.js'), 'src/index.js');
});

test('validateFilePath rejects path traversal', () => {
  assert.throws(() => validateFilePath('../../etc/passwd'), /relative path/);
  assert.throws(() => validateFilePath('src/../../etc/passwd'), /relative path/);
});

test('validateFilePath strips a leading slash rather than treating it as absolute', () => {
  // A leading slash is a common accidental typo (pasting a path from a file browser); stripping
  // it rather than rejecting it is the friendlier, still-safe behavior since the result is
  // re-validated as relative afterward.
  assert.equal(validateFilePath('/etc/passwd'), 'etc/passwd');
});

test('validateFilePath rejects empty or missing input', () => {
  assert.throws(() => validateFilePath(''), /required/);
  assert.throws(() => validateFilePath(undefined), /required/);
});

// --- lockStatus ---

test('lockStatus reports unlocked when nothing is in flight', () => {
  const status = lockStatus();
  assert.equal(status.locked, false);
  assert.equal(status.since, null);
});
