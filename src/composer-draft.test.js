import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverDraftAfterFailure } from './composer-draft.js';
const sent = { input: 'Review the memo', attachments: [{ name: 'memo.md', text: 'Original memo' }], source: 'Marketing' };

test('a failed reply restores the submitted message and attachments into an empty composer', () => {
  assert.deepEqual(recoverDraftAfterFailure({ input: '', attachments: [], source: 'Marketing' }, sent), sent);
});
test('a failed reply cannot overwrite text or attachments drafted while it was pending', () => {
  for (const current of [
    { input: 'My next question', attachments: [], source: 'You' },
    { input: '', attachments: [{ name: 'next.md', text: 'Next memo' }], source: 'Engineering' },
    { input: 'Next question', attachments: [{ name: 'next.md' }], source: 'You' },
  ]) assert.equal(recoverDraftAfterFailure(current, sent), current);
});
