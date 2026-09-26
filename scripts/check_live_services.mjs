// Explicit live integration check. Creates an isolated, labeled QA workspace.
import assert from 'node:assert/strict';
import { processPrompt, seedState } from '../src/memory.js';
import { readFile } from 'node:fs/promises';
import { liveServices } from '../src/services.js';
if (process.argv.includes('--through-ui')) {
  const transport = globalThis.fetch;
  globalThis.fetch = (url, init) => transport(typeof url === 'string' && url.startsWith('/') ? `http://127.0.0.1:5173${url}` : url, init);
}
const base = 'http://127.0.0.1:8000';
const workspaceId = `workspace-qa-${crypto.randomUUID()}`;
async function api(path, body) {
  const response = await fetch(`${base}/${path.startsWith('state') ? path : `api/ledger/${path}`}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(path.startsWith('state') ? body : { workspaceId, ...body }) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const services = process.argv.includes('--through-ui') ? liveServices(workspaceId, { storage: 'atlas' }) : {
  storage: 'atlas',
  save: (state, operation, route) => api('save', { state, operation, route }),
  resolve: async (conflictId, candidates, scope) => (await api('state', { project_id: workspaceId, conflict_text: candidates.map(f => f.text).join(' vs '), context: { workspace_id: workspaceId, conflict_id: conflictId, fact_ids: candidates.map(f => f.id), scope, subject: candidates[0].subject } })).value,
  correct: async (conflictId, requestId, factId, reason, rememberAuthority, {scope, subject}) => (await api('state/correct', { correct_fact_id: factId, reason, context: { workspace_id: workspaceId, conflict_id: conflictId, request_id: requestId, remember_authority: rememberAuthority, scope, subject } })).value,
};
const persist = () => {};
// Model response is deliberately stubbed here; browser QA exercises real generation.
const review = async () => ({ answer: 'Integration check review.', model: 'QA stub', provider: 'test' });
let result = await processPrompt(seedState(), 'Review this memo?', 'Marketing', persist, review,
  [{ name: 'QA launch memo.md', text: await readFile(new URL('../src/fixtures/launch-memo.md', import.meta.url), 'utf8'), example: true }], { services });
assert.equal(result.turn.selected.source, 'Marketing');
assert(result.turn.engineResolution);
assert(result.turn.trace.some(e => e.service === 'voyage' && e.status === 'succeeded'));
assert(result.turn.trace.some(e => e.service === 'vector' && e.status === 'succeeded'));
const first = result.turn;
result = await processPrompt(result.state, 'Engineering owns launch readiness for this project.', 'You', persist, undefined, [], {
  services, conflictReview: { conflictTurnId: first.id, factId: first.candidates.find(f => f.source === 'Engineering').id, reason: 'Engineering owns readiness.', rememberAuthority: true },
});
assert.equal(result.turn.policy, 2);
assert.equal(result.turn.retrievalReady, true, 'Vector index must return the saved correction before reuse');
const lesson = result.state.lesson.id;
const loaded = await api('load', {});
assert.equal(loaded.state.policy, 2);
result = await processPrompt(loaded.state, 'Review this next release brief?', 'Marketing', persist, review,
  [{ name: 'QA next release.md', text: await readFile(new URL('../src/fixtures/next-release-memo.md', import.meta.url), 'utf8'), example: true }], { services });
assert.equal(result.turn.selected.value, 'Thursday');
assert.equal(result.turn.applied, lesson);
const candidate = result.turn.trace.find(e => e.service === 'vector' && e.stage === 'search').candidates.find(c => c.precedent_id === lesson);
assert(candidate && typeof candidate.score === 'number');
// A separate domain must not inherit the launch-readiness precedent.
const scoped = structuredClone(result.state);
scoped.facts.push({ id: 'qa-budget-m', source: 'Marketing', subject: 'budget', scope: 'budget', value: '100', text: 'Budget is 100.' }, { id: 'qa-budget-e', source: 'Engineering', subject: 'budget', scope: 'budget', value: '200', text: 'Budget is 200.' });
await services.save(scoped, 'Save QA budget claims');
const outside = await services.resolve('qa-budget', scoped.facts.filter(f => f.subject === 'budget'), 'budget');
assert.equal(outside.resolution.applied_precedent_id, null);
assert.equal(outside.resolution.status, 'unresolved');
console.log(JSON.stringify({ workspaceId, first: first.selected.value, policy: result.turn.policy, next: result.turn.selected.value, applied: result.turn.applied, score: candidate.score, outOfScope: outside.resolution.status, events: result.turn.trace.map(e => ({ service: e.service, stage: e.stage, status: e.status })) }, null, 2));
