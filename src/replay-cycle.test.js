import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, processPrompt } from './memory.js';
import { normalizeConversations } from './conversations.js';
import { completedReplayCycle, buildCycleReplaySteps, cycleServiceRecording } from './replay-cycle.js';
import { serviceEvidence } from './replay-model.js';
const persist = () => {};

test('search receipts survive the correction boundary and disappear when scrubbing before arrival', () => {
  const review = { id: 'review', serviceMode: 'atlas', trace: [
    { id: 'query', service: 'voyage', stage: 'embedding', status: 'succeeded' },
    { id: 'search', service: 'vector', stage: 'search', status: 'succeeded', candidates: [] },
    { id: 'policy', service: 'engine', stage: 'policy', status: 'succeeded', applied: null },
    { id: 'reply', service: 'local', stage: 'respond' },
  ] };
  const correction = { id: 'correction', serviceMode: 'atlas', correction: true, trace: [
    { id: 'answer', service: 'local', stage: 'receive' },
    { id: 'write', service: 'local', stage: 'write' },
    { id: 'receipt', service: 'atlas', stage: 'storage', status: 'succeeded' },
    { id: 'saved', service: 'atlas', stage: 'saved' },
    { id: 'ready', service: 'vector', stage: 'readiness', status: 'succeeded' },
    { id: 'done', service: 'local', stage: 'respond' },
  ] };
  const cycle = { turns: [review, correction] };
  const before = JSON.stringify(cycle);
  const steps = buildCycleReplaySteps(cycle);
  const evidenceAt = (cursor, arrived) => {
    const recording = cycleServiceRecording(steps, cursor, arrived);
    assert.deepEqual(recording.trace, [...review.trace, ...correction.trace]);
    return serviceEvidence(recording, 'vector', recording.evidenceCursor);
  };
  const search = steps.findIndex(step => step.id === 'search');
  assert.equal(evidenceAt(search, false).tag, 'NOT REACHED YET');
  assert.equal(evidenceAt(search, false).events.length, 0);
  assert.equal(evidenceAt(search, true).tag, 'LIVE · RECORDED');
  const boundary = steps.findIndex(step => step.turn === correction);
  assert.deepEqual(evidenceAt(boundary, false).events.map(event => event.id), ['search']);
  const save = steps.findIndex(step => step.id === 'write');
  assert.equal(steps[save].events.length, 3, 'coalesced saves retain every event');
  assert.deepEqual(evidenceAt(save, true).events.map(event => event.id), ['search']);
  assert.deepEqual(evidenceAt(steps.length - 1, true).events.map(event => event.id), ['search', 'ready']);
  assert.equal(evidenceAt(search, false).events.length, 0, 'scrubbing backwards hides future receipts again');
  assert.equal(JSON.stringify(cycle), before, 'inspection never mutates saved events');
});

test('conflict replay waits for a saved human answer and includes both recorded phases once', async () => {
  const first = await processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist);
  assert.equal(completedReplayCycle(first.state), null);
  const result = await processPrompt(first.state, 'Use Engineering.', 'You', persist, undefined, [], {
    conflictReview: { conflictTurnId: first.turn.id, factId: first.turn.candidates.find(fact => fact.source === 'Engineering').id, rememberAuthority: true },
  });
  const snapshot = JSON.stringify(result.state);
  const cycle = completedReplayCycle(result.state);
  assert.equal(cycle.id, result.turn.id);
  assert.deepEqual(cycle.turns.map(turn => turn.id), [first.turn.id, result.turn.id]);
  const steps = buildCycleReplaySteps(cycle);
  assert.deepEqual(steps.flatMap(step => step.events.map(event => event.id)), [...first.turn.trace, ...result.turn.trace].map(event => event.id));
  assert.equal(new Set(steps.map(step => step.id)).size, steps.length);
  assert.equal(steps[0].turn.policy, 1);
  assert.equal(steps.find(step => step.turn.id === result.turn.id).turn.policy, 2);
  assert.equal(steps.find(step => step.turn.id === result.turn.id).traceStartIndex, 0);
  assert.equal(JSON.stringify(result.state), snapshot);
});

test('explicit unresolved answer completes a cycle; skipping or partial saves do not', async () => {
  const first = await processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist);
  assert.equal(completedReplayCycle(first.state), null);
  const result = await processPrompt(first.state, 'Leave unresolved.', 'You', persist, undefined, [], { conflictReview: { conflictTurnId: first.turn.id, factId: null } });
  assert.equal(completedReplayCycle(result.state).turns.length, 2);
  for (const change of [{ status: 'recorded' }, { trace: result.turn.trace.filter(event => event.stage !== 'committed') }, { trace: result.turn.trace.slice(0, -1) }]) {
    assert.equal(completedReplayCycle({ ...result.state, turns: [first.turn, { ...result.turn, ...change }] }), null);
  }
});

test('only the latest completed cycle in the selected chat is offered', async () => {
  let result = await processPrompt(normalizeConversations(seedState()), 'What is a database?', 'Marketing', persist);
  const firstId = result.turn.id;
  result = await processPrompt(result.state, 'What is a document?', 'Engineering', persist);
  const cycle = completedReplayCycle(result.state);
  assert.equal(cycle.turns.length, 1);
  assert.equal(cycle.id, result.turn.id);
  assert.notEqual(cycle.id, firstId);
  assert.equal(completedReplayCycle(result.state, 'another-chat'), null);
  const failed = { ...result.state, turns: [...result.state.turns, { id: 'failed', chatId: result.state.activeChatId, status: 'recorded', answer: null }] };
  assert.equal(completedReplayCycle(failed), null);
});

test('older typed corrections retain their original conflict in the cycle', async () => {
  const first = await processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist);
  const result = await processPrompt(first.state, 'Engineering owns launch readiness for this project.', 'You', persist);
  assert.deepEqual(completedReplayCycle(result.state).turns.map(turn => turn.id), [first.turn.id, result.turn.id]);
});


test('an applied lesson completes the new conflict cycle without another human question', async () => {
  const first = await processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist);
  const answered = await processPrompt(first.state, 'Use Engineering.', 'You', persist, undefined, [], { conflictReview: { conflictTurnId: first.turn.id, factId: first.turn.candidates[0].id, rememberAuthority: true } });
  const next = await processPrompt(answered.state, 'The next release is Tuesday.', 'Marketing', persist);
  assert.ok(next.turn.applied);
  assert.equal(completedReplayCycle(next.state).id, next.turn.id);
});
