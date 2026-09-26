import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, processPrompt } from './memory.js';
import { normalizeConversations } from './conversations.js';
import { needsConflictReview, canRememberAuthority, currentConflictQuestion, authorityScope, authorityLabel, findConflictTurn, matchingConflictReview } from './conflict-review.js';
const persist = () => {};
const setup = () => processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist);
const review = (original, factId, rememberAuthority = false) => ({ conflictTurnId: original.id, factId, rememberAuthority, reason: 'Confirmed with the team.' });

test('a conflict question saves its answer, preserves the original, and teaches scoped reuse', async () => {
  const original = await setup();
  assert.ok(needsConflictReview(original.state, original.turn));
  const engineering = original.turn.candidates.find(fact => fact.source === 'Engineering');
  let modelCalled = false;
  const result = await processPrompt(original.state, 'Use Engineering’s readiness date.', 'You', persist, () => { modelCalled = true; }, [], { conflictReview: review(original.turn, engineering.id, true) });
  assert.equal(modelCalled, false);
  assert.equal(result.turn.selected.value, 'Monday');
  assert.equal(result.turn.reviewedConflictId, original.turn.id);
  assert.deepEqual(result.state.turns[0], original.turn);
  assert.equal(result.state.policy, 2);
  assert.equal(result.state.policyVersions[0].version, 1);
  assert.equal(result.state.conflictReviews[0].reason, 'Confirmed with the team.');
  assert.equal(needsConflictReview(result.state, original.turn), false);
  const restored = JSON.parse(JSON.stringify(result.state));
  assert.equal(needsConflictReview(restored, original.turn), false);
  const next = await processPrompt(restored, 'The next release is Tuesday.', 'Marketing', persist);
  assert.equal(next.turn.selected.value, 'Thursday');
  assert.ok(next.turn.applied);
  assert.equal(needsConflictReview(next.state, next.turn), false);
});

test('keeping a claim or leaving unresolved is explicit and does not change authority', async () => {
  const original = await setup();
  for (const factId of [original.turn.selected.id, null]) {
    const result = await processPrompt(original.state, 'My answer', 'You', persist, undefined, [], { conflictReview: review(original.turn, factId) });
    assert.equal(result.state.policy, 1);
    assert.equal(result.state.lesson, null);
    assert.equal(result.turn.selected?.id || null, factId);
    assert.equal(needsConflictReview(result.state, original.turn), false);
  }
});

test('invalid, cross-chat, duplicate, and out-of-scope answers cannot be saved', async () => {
  const original = await setup();
  for (const options of [{ conflictReview: review(original.turn, 'missing') }, { chatId: 'other', conflictReview: review(original.turn, null) }]) {
    await assert.rejects(processPrompt(original.state, 'My answer', 'You', () => assert.fail('Must not persist'), undefined, [], options));
  }
  const result = await processPrompt(original.state, 'My answer', 'You', persist, undefined, [], { conflictReview: review(original.turn, null) });
  await assert.rejects(processPrompt(result.state, 'Again', 'You', persist, undefined, [], { conflictReview: review(original.turn, null) }), /no longer awaiting/);
  let budget = await processPrompt(original.state, 'The budget is $20000.', 'Marketing', persist);
  budget = await processPrompt(budget.state, 'The budget is $15000.', 'Engineering', persist);
  assert.ok(needsConflictReview(budget.state, budget.turn));
  const engineering = budget.turn.candidates.find(fact => fact.source === 'Engineering');
  assert.equal(canRememberAuthority(budget.turn, engineering), true);
  const learned = await processPrompt(budget.state, 'Remember this', 'You', persist, undefined, [], { conflictReview: review(budget.turn, engineering.id, true) });
  assert.equal(learned.state.policy, 2);
  assert.equal(learned.state.lesson.scope, 'claim:budget:budget');
});

test('failed persistence keeps the original conflict unanswered and retryable', async () => {
  const original = await setup();
  const before = structuredClone(original.state);
  await assert.rejects(processPrompt(original.state, 'My answer', 'You', () => { throw new Error('storage full'); }, undefined, [], { conflictReview: review(original.turn, null) }), /storage full/);
  assert.deepEqual(original.state, before);
  assert.ok(needsConflictReview(original.state, original.turn));
});


test('an old launch conflict never takes over a later unrelated response or another chat', async () => {
  const original = await setup();
  assert.equal(currentConflictQuestion(original.state, original.state.activeChatId).id, original.turn.id);
  assert.equal(currentConflictQuestion(original.state, original.state.activeChatId, [original.turn.id]), null);
  for (const prompt of ['Hello!', 'Are you ready?', 'Explain release notes.', 'Engineering meets Friday.']) {
    const result = await processPrompt(original.state, prompt, 'Marketing', persist);
    assert.equal(result.turn.conflict, false, prompt);
    assert.equal(currentConflictQuestion(result.state, result.state.activeChatId), null, prompt);
    assert.equal(needsConflictReview(result.state, original.turn), true, 'older question remains manually available');
  }
  assert.equal(currentConflictQuestion(original.state, 'another-chat'), null);
});

test('a later conflicting subject supplies its own question and options', async () => {
  const original = await setup();
  const first = await processPrompt(original.state, 'The budget is $20000.', 'Marketing', persist);
  const result = await processPrompt(first.state, 'The owner is Maya. The budget is $15000.', 'Engineering', persist);
  assert.equal(result.turn.subject, 'budget');
  assert.match(result.turn.conflictQuestion.question, /budget.*20000.*15000/);
  assert.doesNotMatch(result.turn.conflictQuestion.question, /launch|Friday|Monday/);
  assert.equal(currentConflictQuestion(result.state, result.state.activeChatId).id, result.turn.id);
});

test('a saved answer is reused for the same facts without another question', async () => {
  const original = await setup();
  for (const factId of [original.turn.candidates[0].id, null]) {
    const answered = await processPrompt(original.state, 'My answer', 'You', persist, undefined, [], { conflictReview: review(original.turn, factId) });
    const result = await processPrompt(answered.state, 'When is the launch?', 'Marketing', persist);
    assert.equal(result.turn.selected?.id || null, factId);
    assert.equal(needsConflictReview(result.state, result.turn), false);
    assert.equal(result.turn.conflictQuestion, null);
  }
});

test('the model can adapt or omit the current question but cannot invent evidence', async () => {
  const generator = question => async ({ reviewContext }) => ({ answer: 'Review complete.', model: 'test', conflictQuestion: question === null ? null : { question, factIds: reviewContext.candidates.map(fact => fact.id) } });
  const result = await processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist, generator('Should the customer email wait for Monday readiness?'));
  assert.equal(result.turn.conflictQuestion.question, 'Should the customer email wait for Monday readiness?');
  assert.ok(needsConflictReview(result.state, result.turn));
  const unrelated = await processPrompt(result.state, 'Explain the word launch.', 'Marketing', persist, generator(null));
  assert.equal(unrelated.turn.conflictQuestion, null);
  assert.equal(currentConflictQuestion(unrelated.state, unrelated.state.activeChatId), null);
  const invalid = await processPrompt(normalizeConversations(seedState()), 'The launch is Friday.', 'Marketing', persist, async () => ({ answer: 'Review.', conflictQuestion: { question: 'Choose Saturday?', factIds: ['invented'] } }));
  assert.equal(invalid.turn.conflictQuestion, null);
});


test('Maya can revise the saved launch date and answer a fresh source-of-truth question', async () => {
  const original = await setup();
  const first = await processPrompt(original.state, 'Use Monday.', 'Marketing', persist, undefined, [], { conflictReview: review(original.turn, original.turn.candidates[0].id, true) });
  assert.equal(first.turn.source, 'Marketing');
  assert.equal(first.turn.author, 'Maya');
  assert.equal(first.state.conflictReviews[0].author, 'Maya');
  const lookup = await processPrompt(first.state, 'when will the launch be', 'Marketing', persist, async context => {
    assert.equal(context.decisionContext.status, 'human-confirmed');
    assert.equal(context.selected.value, 'Monday');
    assert.equal(context.reviewContext, null);
    return { answer: 'Monday, October 5.', conflictQuestion: null };
  });
  assert.equal(needsConflictReview(lookup.state, lookup.turn), false);
  let captured;
  const changed = await processPrompt(lookup.state, 'actually the launch should be october 2', 'Marketing', persist, async context => {
    captured = context;
    // A model omission must not silently dismiss an explicit correction.
    return { answer: 'Please confirm the revised date.', conflictQuestion: null };
  });
  assert.equal(changed.turn.incoming[0].value, 'October 2');
  assert.equal(changed.turn.incoming[0].subject, 'launch');
  assert.equal(changed.turn.requiresConfirmation, true);
  assert.equal(captured.decisionContext.status, 'confirmation-required');
  assert.equal(captured.reviewContext.requiresConfirmation, true);
  assert.ok(needsConflictReview(changed.state, changed.turn));
  const newFact = changed.turn.incoming[0];
  const second = await processPrompt(changed.state, 'Use October 2 from Maya.', 'Marketing', persist, undefined, [], { conflictReview: review(changed.turn, newFact.id) });
  assert.equal(second.turn.author, 'Maya');
  assert.equal(second.turn.selected.id, newFact.id);
  assert.equal(second.state.conflictReviews.length, 2);
  assert.equal(second.state.lesson.id, first.state.lesson.id, 'the one-conflict answer does not silently replace project authority');
  const final = await processPrompt(JSON.parse(JSON.stringify(second.state)), 'when will the launch be', 'Marketing', persist);
  assert.equal(final.turn.selected.value, 'October 2');
  assert.equal(needsConflictReview(final.state, final.turn), false);
  assert.equal(final.state.turns.find(turn => turn.id === first.turn.id).selected.value, 'Monday');
});

test('calendar-only claims are accepted without turning a question or memo header into a fact', async () => {
  for (const prompt of ['actually the launch should be October 2', 'Change the launch to 2026-10-02']) {
    const result = await processPrompt(normalizeConversations(seedState()), prompt, 'Marketing', persist);
    assert.equal(result.turn.incoming.length, 1);
    assert.equal(result.turn.incoming[0].scope, 'launch readiness');
  }
  const result = await processPrompt(normalizeConversations(seedState()), 'Should the launch be October 2?', 'Marketing', persist);
  assert.equal(result.turn.incoming.length, 0);
});


test('explicit authority choices use the recorded source and isolate generic claims', () => {
  const finance = { id: 'finance', source: 'Finance', subject: 'budget', scope: 'other' };
  const marketing = { ...finance, id: 'marketing', source: 'Marketing' };
  const turn = { candidates: [finance, marketing] };
  assert.equal(canRememberAuthority(turn, finance), true);
  assert.equal(canRememberAuthority(turn, marketing), true);
  assert.equal(authorityScope(finance), 'claim:budget:budget');
  assert.equal(authorityLabel(turn, finance), 'Remember Finance’s authority for budget in this project.');
  assert.equal(canRememberAuthority(turn, { ...finance, id: 'invented' }), false);
  assert.equal(canRememberAuthority({ candidates: [finance, { ...marketing, attribute: 'owner' }] }, finance), false);
  assert.equal(canRememberAuthority({ candidates: [finance, { ...marketing, scope: 'launch readiness' }] }, finance), false);
  assert.equal(authorityScope({ subject: 'launch', scope: 'launch readiness' }), 'launch-readiness');
  assert.equal(authorityScope({ subject: 'launch', scope: 'launch readiness', attribute: 'owner' }), 'launch-readiness:owner');
});


test('multiple conflicts queue within one response and advance after saved answers', () => {
  const first = { id: 'memo:conflict:1', subject: 'budget', conflict: true, candidates: [{ id: 'b1', value: '$100' }, { id: 'b2', value: '$200' }], conflictQuestion: { question: 'Which budget?' } };
  const second = { id: 'memo:conflict:2', subject: 'owner', conflict: true, candidates: [{ id: 'o1', value: 'Maya' }, { id: 'o2', value: 'Alex' }], conflictQuestion: { question: 'Which owner?' } };
  const memo = { id: 'memo', chatId: 'chat', answer: 'Two disagreements.', conflicts: [first, second] };
  const state = { turns: [memo], conflictReviews: [] };
  assert.equal(currentConflictQuestion(state, 'chat').id, first.id);
  assert.equal(findConflictTurn(state, second.id).parentTurnId, memo.id);
  assert.equal(needsConflictReview(state, memo), true);
  assert.equal(currentConflictQuestion(state, 'chat', [first.id]).id, second.id);
  state.conflictReviews.push({ conflictTurnId: first.id, selectedFactId: 'b1', resolutionTurnId: 'answer-1' });
  state.turns.push({ id: 'answer-1', chatId: 'chat', answer: 'Saved budget.', correction: true, reviewedConflictId: first.id });
  assert.equal(currentConflictQuestion(state, 'chat').id, second.id);
  assert.equal(needsConflictReview(state, memo), true);
  state.conflictReviews.push({ conflictTurnId: second.id, selectedFactId: null, resolutionTurnId: 'answer-2' });
  state.turns.push({ id: 'answer-2', chatId: 'chat', answer: 'Owner unresolved.', correction: true, reviewedConflictId: second.id });
  assert.equal(currentConflictQuestion(state, 'chat'), null);
  assert.equal(needsConflictReview(state, memo), false);
});

test('a queued conflict cannot replace a newer unrelated response or another chat', () => {
  const memo = { id: 'memo', chatId: 'chat', answer: 'Disagreements.', conflicts: [{ id: 'memo:conflict:1', subject: 'budget', conflict: true, candidates: [{ id: 'b1', value: '$100' }, { id: 'b2', value: '$200' }] }] };
  const state = { turns: [memo, { id: 'hello', chatId: 'chat', answer: 'Hello.' }] };
  assert.equal(currentConflictQuestion(state, 'chat'), null);
  assert.equal(currentConflictQuestion(state, 'other'), null);
  assert.equal(needsConflictReview(state, memo), true);
});

test('equivalent same-source duplicates retain the saved answer without broadening its evidence', () => {
  const candidates = [{ id: 'a', subject: 'budget', scope: 'other', attribute: 'budget', source: 'Finance', value: '$25k' }, { id: 'b', subject: 'budget', scope: 'other', attribute: 'budget', source: 'Marketing', value: '$30,000' }];
  const original = { id: 'review', candidates };
  const saved = { conflictTurnId: original.id, selectedFactId: 'a' };
  const state = { turns: [original], conflictReviews: [saved] };
  const equivalent = { ...candidates[0], id: 'c', value: '$25,000' };
  assert.equal(matchingConflictReview(state, [...candidates, equivalent]), saved);
  for (const change of [{ source: 'Engineering' }, { value: '$26,000' }, { validFrom: '2026-10-01' }, { attribute: 'owner' }, { scope: 'procurement' }]) {
    assert.equal(matchingConflictReview(state, [...candidates, { ...equivalent, ...change }]), null);
  }
  assert.equal(matchingConflictReview(state, [candidates[1], equivalent]), null, 'original evidence cannot disappear');
});

test('authority context is scoped to an unambiguous recorded conflict in this chat', async () => {
  const {authorityReviewRequest}=await import('./conflict-review.js');
  const facts=[{id:'m',subject:'launch',scope:'launch readiness',value:'Friday',source:'Marketing'}, {id:'e',subject:'launch',scope:'launch readiness',value:'Monday',source:'Engineering'}];
  const turn={id:'launch-review',chatId:'chat',answer:'Review',status:'completed',conflict:true,subject:'launch',candidates:facts};
  const state={turns:[turn]};
  assert.equal(authorityReviewRequest(state,'Engineering owns launch readiness for this project.','chat').conflictTurnId,turn.id);
  for (const prompt of ['Does Engineering own launch readiness for this project?', 'Engineering owns budget for this project.', 'Maybe Engineering owns launch readiness for this project.', 'Engineering owns launch readiness for another project.']) {
    assert.equal(authorityReviewRequest(state,prompt,'chat'),null,prompt);
  }
  assert.equal(authorityReviewRequest(state,'Engineering owns launch readiness for this project.','other'),null);
  assert.equal(authorityReviewRequest(state,'Engineering owns launch readiness for this project.','chat',[{text:'memo'}]),null);
  state.turns.push({...turn,id:'next',subject:'next release',candidates:facts.map(f=>({...f,subject:'next release'}))});
  assert.equal(authorityReviewRequest(state,'Engineering owns launch readiness for this project.','chat'),null,'several subjects require clarification');
});
