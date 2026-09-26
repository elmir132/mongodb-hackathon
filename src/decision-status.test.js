import test from 'node:test';
import assert from 'node:assert/strict';
import { processPrompt, seedState } from './memory.js';
import { hasSavedDecision } from './decision-status.js';
const persist = () => {};

test('ordinary saved replies, facts, lookups and provisional conflicts are not decisions', async () => {
  for (const prompt of ['Hello!', 'Thanks!', 'The budget is $20000.', 'When is the launch?', 'The launch is Friday.']) {
    const { turn } = await processPrompt(seedState(), prompt, 'Marketing', persist);
    assert.ok(turn.trace.some(event => event.stage === 'committed'));
    assert.equal(hasSavedDecision(turn), false, prompt);
    assert.equal(turn.trace.find(event => event.stage === 'committed').entity, 'response');
  }
});

test('saved human answers and scoped lesson reuse show the badge only after confirmation', async () => {
  const initial = await processPrompt(seedState(), 'The launch is Friday.', 'Marketing', persist);
  for (const factId of [initial.turn.candidates[0].id, null]) {
    const result = await processPrompt(initial.state, 'My answer', 'You', persist, undefined, [], { conflictReview: { conflictTurnId: initial.turn.id, factId, rememberAuthority: factId !== null } });
    const turn = JSON.parse(JSON.stringify(result.turn));
    const committed = turn.trace.findIndex(event => event.stage === 'committed');
    assert.equal(hasSavedDecision(turn), true);
    assert.equal(hasSavedDecision(turn, committed - 1), false);
    assert.equal(hasSavedDecision(turn, committed), true);
    assert.equal(hasSavedDecision({ ...turn, status: 'recorded' }), false);
    assert.equal(hasSavedDecision({ ...turn, trace: turn.trace.slice(0, committed) }), false);
    assert.equal(turn.trace[committed].entity, 'decision');
    if (factId) {
      const next = await processPrompt(result.state, 'The next release is Tuesday.', 'Marketing', persist);
      assert.equal(hasSavedDecision(next.turn), true);
      assert.equal(hasSavedDecision({ ...next.turn, requiresConfirmation: true }), false);
    }
  }
});
