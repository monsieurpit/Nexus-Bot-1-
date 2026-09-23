import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTitleAndMessage, successEmbed, errorEmbed } from '../../src/utils/embeds.js';

test('(title, message) order is detected', () => {
  assert.deepEqual(
    resolveTitleAndMessage('Task Added', 'Added "milk" to the shared list.'),
    { title: 'Task Added', message: 'Added "milk" to the shared list.' }
  );
  assert.deepEqual(
    resolveTitleAndMessage('✅ Channel Updated', 'Welcome messages will now be sent in <#1>.'),
    { title: '✅ Channel Updated', message: 'Welcome messages will now be sent in <#1>.' }
  );
});

test('(message, title) order is detected', () => {
  assert.deepEqual(
    resolveTitleAndMessage('All your data was deleted.', '🗑️ Data Wipe Complete'),
    { title: '🗑️ Data Wipe Complete', message: 'All your data was deleted.' }
  );
});

test('multi-line text is never used as a title', () => {
  const r = resolveTitleAndMessage('Line one\nLine two', 'Short title');
  assert.equal(r.title, 'Short title');
});

test('successEmbed builds the right embed for both orders', () => {
  const a = successEmbed('Priority Updated', 'Ticket priority set to high.').toJSON();
  assert.equal(a.title, 'Priority Updated');
  assert.equal(a.description, 'Ticket priority set to high.');
  const b = successEmbed('Done!').toJSON();
  assert.equal(b.title, '✅ Success');
  assert.equal(b.description, 'Done!');
});

test('errorEmbed with two strings keeps the explanation in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const e = errorEmbed('Permission Denied', 'You need Manage Server to do this.').toJSON();
    assert.equal(e.title, 'Permission Denied');
    assert.equal(e.description, 'You need Manage Server to do this.');
    const withError = errorEmbed('Something failed.', new Error('secret stack detail')).toJSON();
    assert.equal(withError.description, 'Something failed.');
  } finally {
    process.env.NODE_ENV = previous;
  }
});
