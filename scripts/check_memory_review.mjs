// Real model + Atlas/Voyage acceptance check. Uses an isolated QA workspace.
// No existing workspace, provider setting, or demo transcript is changed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { processPrompt, seedState } from '../src/memory.js';
import { liveServices, serviceRequest } from '../src/services.js';

const transport = globalThis.fetch;
globalThis.fetch = (url, init) => transport(typeof url === 'string' && url.startsWith('/') ? `http://127.0.0.1:5173${url}` : url, init);
const workspaceId = `workspace-qa-semantic-${crypto.randomUUID()}`;
const services = liveServices(workspaceId, { storage: 'atlas' });
const measurements = [];
console.error(JSON.stringify({ workspaceId }));
// Optional QA pacing for low-quota Voyage accounts, excluded from latency
// measurements. No application retry or delay is introduced.
const paceMs = Math.max(0, Number(process.env.CHRONICLE_QA_PACE_MS) || 0);
let lastRun = 0;
async function generate(context) {
  const response = await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chronicle-Request': '1' },
    body: JSON.stringify({ ...context, provider: 'codex', model: 'gpt-6-luna' }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Model request failed');
  return data;
}
async function run(state, prompt, attachments = [], options = {}) {
  const pause = Math.max(0, lastRun + paceMs - Date.now());
  if (pause) await new Promise(resolve => setTimeout(resolve, pause));
  lastRun = Date.now();
  const start = performance.now();
  const result = await processPrompt(state, prompt, 'Marketing', () => {}, generate, attachments, { services, memoryReview: true, ...options });
  const measurement = { action: prompt, totalMs: Math.round(performance.now() - start), ...result.turn.timing };
  measurements.push(measurement);
  console.error(JSON.stringify({ ...measurement, analysisStatus: result.turn.memoryAnalysis?.status }));
  return result;
}
const file = name => readFile(new URL(`../src/fixtures/${name}`, import.meta.url), 'utf8');
let result = await run(seedState(), 'Review this launch memo before I share it.', [{ name: 'QA launch.md', text: await file('launch-memo.md'), example: true }]);
assert.equal(result.turn.memoryAnalysis.status, 'validated');
assert.equal(result.turn.conflict, true);
assert.equal(result.turn.selected.source, 'Marketing');
assert.ok(result.turn.incoming.every(f => f.provenance?.quote === f.text));
const first = result.turn;
result = await run(result.state, 'Use Engineering for this project’s launch readiness.', [], { memoryReview: false, conflictReview: {
  conflictTurnId: first.id, factId: first.candidates.find(f => f.source === 'Engineering').id, rememberAuthority: true, reason: 'Engineering owns the readiness gate.' } });
assert.equal(result.turn.retrievalReady, true);
const launchLesson = result.turn.lesson.id;
result = await run(result.state, 'When is the launch?');
assert.equal(result.turn.timing.modelCalls, 0);
assert.match(result.turn.answer, /Monday/);
result = await run(result.state, 'Review this next release brief.', [{ name: 'QA next release.md', text: await file('next-release-memo.md'), example: true }]);
assert.equal(result.turn.memoryAnalysis.status, 'validated');
assert.equal(result.turn.applied, launchLesson);
assert.equal(result.turn.selected.source, 'Engineering');
assert.equal(result.turn.conflictQuestion, null);

// A second domain, different authority, and later different subject.
let state = result.state;
state.facts.push({ id: 'qa-acquisition', source: 'Engineering', author: 'Alex', subject: 'acquisition budget', attribute: 'budget', scope: 'project finance', value: '$15,000', text: 'The acquisition budget is $15,000.', sourceDate: '2026-09-18' });
await services.save(state, 'Seed labeled QA finance evidence');
result = await run(state, 'The acquisition budget is $20,000. Check this against project memory.');
assert.equal(result.turn.memoryAnalysis.status, 'validated');
assert.equal(result.turn.conflict, true);
const finance = result.turn;
result = await run(result.state, 'Use Marketing for the project finance budget.', [], { memoryReview: false, conflictReview: {
  conflictTurnId: finance.id, factId: finance.candidates.find(f => f.source === 'Marketing').id, rememberAuthority: true, reason: 'Marketing owns campaign budget approval for this project.' } });
assert.equal(result.turn.retrievalReady, true);
const financeLesson = result.turn.lesson.id;
state = result.state;
state.facts.push({ id: 'qa-retention', source: 'Engineering', author: 'Alex', subject: 'retention budget', attribute: 'budget', scope: 'project finance', value: '$25,000', text: 'The retention budget is $25,000.', sourceDate: '2026-09-18' });
await services.save(state, 'Seed labeled QA retention evidence');
result = await run(state, 'The retention budget is $30,000. Check this against project memory.');
assert.equal(result.turn.applied, financeLesson);
assert.equal(result.turn.selected.source, 'Marketing');
assert.equal(result.turn.lesson.id, financeLesson);
assert.notEqual(financeLesson, launchLesson);
// Exercise both repaired response composition and scope isolation with a real
// model. Source output must survive even while the engine asks for a decision.
state = result.state;
state.facts.push({ id: 'qa-travel', source: 'Engineering', author: 'Alex', subject: 'travel budget', attribute: 'budget', scope: 'business travel', value: '$5,000', text: 'The travel budget is $5,000.', sourceDate: '2026-09-18' });
await services.save(state, 'Seed labeled QA travel evidence');
result = await run(state, 'Translate this memo into French.', [{ name: 'QA travel.md', text: 'The travel budget is $8,000.' }]);
assert.equal(result.turn.conflict, true);
assert.equal(result.turn.applied, null);
assert.ok(result.turn.conflictQuestion);
assert.match(result.turn.answer, /Translation of supplied text/);
assert.match(result.turn.answer, /(?:Le |Les |voyage|déplacement)/i);
assert.match(result.turn.answer, /Memory decision/);
result = await run(result.state, 'Summarize this memo in one sentence.', [{ name: 'QA travel summary.md', text: 'The travel budget is $8,000. It covers train tickets for the customer workshop.' }]);
assert.match(result.turn.answer, /Summary of supplied text/);
assert.match(result.turn.answer, /(?:train|workshop)/i);
assert.match(result.turn.answer, /Memory decision/);
const priorCount = result.state.facts.length;
result = await run(result.state, 'The launch is February 31, 2027. Check this date.');
assert.equal(result.turn.incoming.length, 0);
assert.equal(result.state.facts.length, priorCount);
assert.equal(result.turn.memoryAnalysis.status, 'unavailable');
assert.match(result.turn.answer, /Memory checking was (?:incomplete|unavailable)/);
const loaded = await serviceRequest('load', { workspaceId });
assert.equal(loaded.state.lessons[launchLesson].id, launchLesson);
assert.equal(loaded.state.lessons[financeLesson].id, financeLesson);
assert.equal(loaded.state.policy, 3);
console.log(JSON.stringify({ workspaceId, launchLesson, financeLesson, policy: loaded.state.policy, measurements }, null, 2));
