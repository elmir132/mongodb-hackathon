import test from 'node:test';
import assert from 'node:assert/strict';
import { processPrompt, seedState } from './memory.js';
import { activeOperation, buildReplaySteps } from './replay-model.js';

function fixtureServices(overrides = {}) {
  return {
    storage: 'atlas',
    save: async () => ({ policy: 7, lesson: null, trace: [{ id: crypto.randomUUID(), service: 'atlas', stage: 'storage', status: 'succeeded', title: 'Atlas write acknowledged', route: 'ingest' }] }),
    resolve: async (id, candidates) => ({ policy: 7, lesson: null, resolution: { conflict_id: id, selected_fact_id: candidates.find(f => f.source === 'Engineering').id, applied_precedent_id: null, explanation: 'Actual engine decision', policy_version: 7 }, trace: [{ id: crypto.randomUUID(), stage: 'policy', service: 'engine', status: 'succeeded', route: 'candidates' }] }),
    ...overrides,
  };
}

test('connected engine selection overrides local demo authority and retains actual IDs', async () => {
  const services = fixtureServices();
  let context;
  const result = await processPrompt(seedState(), 'The launch is Friday.', 'Marketing', () => {}, async input => { context = input; return { answer: 'Reviewed', model: 'test' }; }, [], { services });
  assert.equal(result.turn.selected.value, 'Monday, October 5th');
  assert.equal(result.turn.policy, 7);
  assert.equal(context.engineResolution.explanation, 'Actual engine decision');
  assert.equal(result.turn.serviceMode, 'atlas');
  assert.deepEqual(buildReplaySteps(result.turn).flatMap(step => step.events.map(event => event.id)), result.turn.trace.map(event => event.id));
  assert.equal(activeOperation(result.turn.trace.find(e => e.stage === 'compare')).node, 'terminal');
  assert.equal(activeOperation(result.turn.trace.find(e => e.service === 'engine')).node, 'engine');
});

test('failed backend save prevents model generation and local saved acknowledgment', async () => {
  let generated = false, cached = false;
  await assert.rejects(processPrompt(seedState(), 'The launch is Friday.', 'Marketing', () => { cached = true; }, async () => { generated = true; }, [], {
    services: fixtureServices({ save: async () => { throw new Error('Atlas write failed'); } }),
  }), /Atlas write failed/);
  assert.equal(generated, false);
  assert.equal(cached, false);
});

test('explicit service and transfer receipts supersede legacy stage routes', () => {
  assert.deepEqual(activeOperation({ stage: 'policy', service: 'engine', route: 'candidates' }), { node: 'engine', route: 'candidates' });
  assert.deepEqual(activeOperation({ stage: 'generated', service: 'model', route: 'model-answer' }), { node: 'terminal', route: 'model-answer' });
  assert.equal(activeOperation({ stage: 'compare', service: 'local' }).node, 'terminal');
  assert.equal(activeOperation({ stage: 'storage', service: 'storage' }).node, 'atlas');
});

test('explicit revisions reopen confirmation even when the connected engine applies a precedent', async () => {
  const { needsConflictReview } = await import('./conflict-review.js');
  const original = await processPrompt(seedState(), 'The launch is Friday.', 'Marketing', () => {});
  const answered = await processPrompt(original.state, 'Use Monday.', 'Marketing', () => {}, undefined, [], { conflictReview: { conflictTurnId: original.turn.id, factId: original.turn.candidates[0].id, rememberAuthority: true } });
  const services = fixtureServices({
    resolve: async (id, candidates) => ({ policy: 7, lesson: answered.state.lesson, resolution: { conflict_id: id, selected_fact_id: candidates[0].id, applied_precedent_id: answered.state.lesson.id }, trace: [] }),
  });
  const revised = await processPrompt(answered.state, 'actually the launch should be october 2', 'Marketing', () => {}, async () => ({ answer: 'Confirm the revised date.', conflictQuestion: null }), [], { services });
  assert.ok(revised.turn.applied);
  assert.ok(revised.turn.requiresConfirmation);
  assert.ok(needsConflictReview(revised.state, revised.turn));
});

test('UI uses canonical state/correct with scope and subject, never override', async () => {
  const { liveServices } = await import('./services.js');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ value: { policy: 2, trace: [] } }) };
  };
  try {
    const services = liveServices('workspace-test', { storage: 'atlas' });
    await services.resolve('conflict-1', [{ id: 'fact-1', subject: 'launch', source: 'Marketing', text: 'Friday' }], 'launch-readiness');
    await services.correct('conflict-1', 'answer-1', 'fact-1', 'Reason', true, { scope: 'launch-readiness', subject: 'launch' });
    assert.deepEqual(requests.map(r => r.url), ['/api/state', '/api/state/correct']);
    for (const request of requests) {
      assert.equal(request.body.context.scope, 'launch-readiness');
      assert.equal(request.body.context.subject, 'launch');
    }
    assert.equal(requests[1].body.correct_fact_id, 'fact-1');
  } finally { globalThis.fetch = originalFetch; }
});
