import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareModelContext, modelReceipt } from '../server/model-context.mjs';
import { processPrompt, seedState } from './memory.js';
import { buildReplaySteps, recordedModelTrace } from './replay-model.js';

test('request receipt matches the actual serialized, capped provider context without credentials', () => {
  const state = { facts: Array.from({ length: 60 }, (_, i) => ({ id: `f${i}` })), notes: Array.from({ length: 25 }, (_, i) => ({ id: `n${i}` })), turns: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, prompt: `question${i}`, answer: `answer${i}` })), policy: 2, lesson: { id: 'p1' } };
  const { content, receipt } = prepareModelContext({ prompt: 'Compare these dates.', source: 'Marketing', state, attachments: [{ name: 'memo.md', text: 'Friday 🗓' }], selected: { id: 'f59' }, apiKey: 'not-for-the-browser', headers: { Authorization: 'secret' }, baseUrl: 'private-url' });
  const context = JSON.parse(content);
  assert.deepEqual(receipt.factIds, context.facts.map(fact => fact.id));
  assert.deepEqual(receipt.noteIds, context.notes.map(note => note.id));
  assert.equal(receipt.history.length, context.conversation.length);
  assert.deepEqual(receipt.history.map(turn => turn.prompt), context.conversation.map(turn => turn.user));
  assert.equal(receipt.history[0].id, 't4');
  assert.equal(receipt.factIds.length, 50);
  assert.equal(receipt.noteIds.length, 20);
  assert.equal(receipt.contextBytes, Buffer.byteLength(content));
  assert.equal(receipt.attachments[0].characters, Array.from(context.attachments[0].text).length);
  assert.equal(receipt.selectedFactId, context.selectedFact.id);
  assert.doesNotMatch(JSON.stringify(receipt), /not-for-the-browser|Authorization|private-url/);
});

test('completed model receipt is persisted with its actual events and drives replay', async () => {
  let receipt;
  const { turn, state } = await processPrompt(seedState(), 'What do you know?', 'You', () => {}, async context => {
    const { receipt: request } = prepareModelContext(context);
    receipt = modelReceipt(request, { provider: 'fixture', model: 'test-model', transport: 'test', startedAt: new Date().toISOString(), startedMs: performance.now(), answer: 'Test answer' });
    return { answer: 'Test answer', provider: 'fixture', model: 'test-model', modelTrace: receipt };
  });
  const savedTurn = JSON.parse(JSON.stringify(state)).turns.find(item => item.id === turn.id);
  assert.deepEqual(recordedModelTrace(savedTurn), receipt);
  const steps = buildReplaySteps(savedTurn);
  const sent = steps.find(step => step.event.stage === 'generate');
  assert.equal(sent.input, 'What do you know?');
  assert.match(sent.output, /0 files · 2 facts · 0 notes · 0 prior exchanges/);
  assert.match(steps.find(step => step.event.stage === 'generated').output, /11 characters/);
  assert.equal(sent.motion.packetRoute, 'terminal:model');
});

test('legacy turns expose missing request detail rather than reconstructed input counts', () => {
  const steps = buildReplaySteps({ prompt: 'A general question', model: 'Older model', trace: [{ id: 'old', stage: 'generate' }] });
  assert.match(steps[0].output, /not captured/);
  assert.equal(recordedModelTrace({ trace: [] }).request, undefined);
});


test('structured model responses keep optional questions grounded in supplied evidence', async () => {
  const { parseModelResponse } = await import('../server/model-response.mjs');
  const candidates = [{ id: 'a', value: '$20000' }, { id: 'b', value: '$15000' }];
  const response = JSON.stringify({ answer: 'The budget needs confirmation.', conflictQuestion: { question: 'Which budget should the plan use?', factIds: ['a', 'b'] } });
  assert.equal(parseModelResponse(response, { candidates }).conflictQuestion.question, 'Which budget should the plan use?');
  assert.equal(parseModelResponse(response, null).conflictQuestion, null);
  assert.deepEqual(parseModelResponse('Hello!', null), { answer: 'Hello!', conflictQuestion: null });
  assert.equal(parseModelResponse(JSON.stringify({ answer: 'Hello!', conflictQuestion: null })).answer, 'Hello!');
  assert.throws(() => parseModelResponse('{"conflictQuestion":null}'), /no usable answer/);
});
