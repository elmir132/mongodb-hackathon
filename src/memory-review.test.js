import test from 'node:test';
import assert from 'node:assert/strict';
import { processPrompt, seedState } from './memory.js';
import { memoryAnalysisContext, validateMemoryAnalysis } from '../server/memory-analysis.mjs';

const budget = {id:'budget-engineering',subject:'budget',attribute:'budget',scope:'project finance',value:'$20,000',text:'The budget is $20,000.',source:'Engineering',author:'Alex'};
const initial = (facts=[budget]) => ({...seedState(),facts});
const claim = (quote, extra={}) => ({ref:'c1',sourceRef:'prompt',quote,subject:'budget',attribute:'budget',scope:'project finance',value:'$15,000',...extra});
const raw = (claims=[],relations=[],relevantFactIds=[]) => ({claims,relations,relevantFactIds});
function fixture(proposal, overrides={}) {
  const calls=[], snapshots=[];
  const services={
    storage:'atlas',
    async save(state) { calls.push('save'); snapshots.push(structuredClone(state)); return {policy:7,lesson:null,trace:[{id:crypto.randomUUID(),service:'atlas',stage:'storage',status:'succeeded',title:'Fixture storage receipt'}]}; },
    async resolve(id,candidates) { calls.push('resolve'); return {policy:7,lesson:null,resolution:{conflict_id:id,selected_fact_id:candidates.find(f=>f.source==='Engineering')?.id || null,applied_precedent_id:null,explanation:'Fixture engine selected Engineering evidence.',policy_version:7},trace:[{id:crypto.randomUUID(),service:'engine',stage:'policy',status:'succeeded'}]}; },
    ...overrides,
  };
  const generate=async input=>{ calls.push('model'); return {answer:'Reviewed the supplied update.',model:'fixture',provider:'fixture',memoryAnalysis:validateMemoryAnalysis(proposal,memoryAnalysisContext(input))}; };
  return {calls,snapshots,services,generate};
}
const run=(state,prompt,fx,options={})=>processPrompt(state,prompt,'Marketing',()=>{},fx.generate,[],{memoryReview:true,services:fx.services,...options});

test('semantic chat makes one model call before the engine, saves evidence first and appends authoritative result',async()=>{
  const prompt='The budget is $15,000.';
  const fx=fixture(raw([claim(prompt)],[{claimRef:'c1',factId:budget.id,type:'contradiction'}]));
  const {turn}=await run(initial(),prompt,fx);
  assert.equal(fx.calls.filter(call=>call==='model').length,1);
  assert.ok(fx.calls.indexOf('model')<fx.calls.indexOf('resolve'));
  assert.equal(fx.calls[fx.calls.indexOf('resolve')-1],'save');
  assert.equal(turn.selected.id,budget.id); assert.equal(turn.conflict,true);
  assert.match(turn.answer,/Reviewed the supplied update/); assert.match(turn.answer,/\*\*Memory decision:\*\*/); assert.match(turn.answer,/20,000/);
  assert.equal(turn.timing.modelCalls,1);
});

test('equivalent budget formatting does not manufacture a conflict or call the engine',async()=>{
  const prompt='The budget is $20k.';
  const fx=fixture(raw([claim(prompt,{value:'$20k'})],[{claimRef:'c1',factId:budget.id,type:'equivalent'}]));
  const {turn}=await run(initial(),prompt,fx);
  assert.equal(turn.conflict,false); assert.equal(turn.conflictQuestion,null); assert.ok(!fx.calls.includes('resolve'));
});

test('equivalent status wording is stored without an invented disagreement',async()=>{
  const old={id:'migration-old',subject:'migration',attribute:'status',scope:'operations',value:'complete',text:'The migration is complete.',source:'Engineering'};
  const prompt='The migration is finished.';
  const fx=fixture(raw([claim(prompt,{subject:'migration',attribute:'status',scope:'operations',value:'finished'})],[{claimRef:'c1',factId:old.id,type:'equivalent'}]));
  const {turn}=await run(initial([old]),prompt,fx);
  assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve'));
});

test('different applicability periods are retained without comparing their values',async()=>{
  const old={...budget,validFrom:'2026-09-01',validTo:'2026-09-30'};
  const prompt='The budget is $15,000 from 2026-10-01 to 2026-10-31.';
  const fx=fixture(raw([claim(prompt,{validFrom:'2026-10-01',validTo:'2026-10-31'})],[{claimRef:'c1',factId:old.id,type:'contradiction'}]));
  const {turn,state}=await run(initial([old]),prompt,fx);
  assert.equal(state.facts.length,2); assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve'));
  assert.deepEqual(turn.candidates.map(f=>f.value),['$15,000']);
});

test('unsupported model proposals report unavailable and never become stored facts',async()=>{
  const fx=fixture(raw([claim('The budget is $15,000.')],[{claimRef:'c1',factId:budget.id,type:'contradiction'}]));
  const {turn,state}=await run(initial(),'Hello there.',fx);
  assert.equal(turn.memoryAnalysis.status,'unavailable'); assert.equal(state.facts.length,1);
  assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve')); assert.match(turn.answer,/Memory checking was unavailable/);
});

test('ordinary conversation reaches the model without raising historical questions',async()=>{
  const fx=fixture(raw());
  const {turn,state}=await run(initial([budget,{...budget,id:'other',source:'Marketing',value:'$15,000'}]),'Tell me a joke.',fx);
  assert.equal(fx.calls.filter(call=>call==='model').length,1); assert.ok(!fx.calls.includes('resolve'));
  assert.equal(turn.conflict,false); assert.equal(turn.conflictQuestion,null); assert.equal(state.facts.length,2);
  assert.equal(turn.answer,'Reviewed the supplied update.');
});

test('failed initial persistence prevents the model, while failed fact persistence prevents resolution',async()=>{
  const prompt='The budget is $15,000.';
  const proposal=raw([claim(prompt)],[{claimRef:'c1',factId:budget.id,type:'contradiction'}]);
  const first=fixture(proposal,{save:async()=>{throw new Error('save failed');}});
  await assert.rejects(run(initial(),prompt,first),/save failed/); assert.deepEqual(first.calls,[]);
  let saves=0;
  const afterModel=fixture(proposal,{save:async()=>{ if (++saves===2) throw new Error('fact save failed'); return {policy:1,lesson:null,trace:[]}; }});
  await assert.rejects(run(initial(),prompt,afterModel),/fact save failed/);
  assert.deepEqual(afterModel.calls,['model']);
});

test('a rejected cross-currency relationship cannot reappear as a deterministic conflict',async()=>{
  const prompt='The budget is €15,000.';
  const fx=fixture(raw([claim(prompt,{value:'€15,000'})],[{claimRef:'c1',factId:budget.id,type:'contradiction'}]));
  const {turn}=await run(initial(),prompt,fx);
  assert.equal(turn.memoryAnalysis.relations.length,0); assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve'));
});

test('weekday-only uncertainty does not override the validator with a false calendar conflict',async()=>{
  const old={id:'launch-old',subject:'launch',scope:'launch readiness',value:'Friday',text:'The launch is Friday, October 2.',sourceDate:'2026-09-26',source:'Engineering'};
  const prompt='The launch is Monday.';
  const fx=fixture(raw([claim(prompt,{subject:'launch',attribute:'date',scope:'launch readiness',value:'Monday'})],[{claimRef:'c1',factId:old.id,type:'contradiction'}]));
  const {turn}=await run(initial([old]),prompt,fx);
  assert.equal(turn.memoryAnalysis.relations.length,0); assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve'));
});

function answeredState(facts,selectedFactId) {
  return {...initial(facts),turns:[{id:'old-review',subject:facts[0].subject,candidates:facts,conflict:true,answer:'Please choose.',selected:facts[0],status:'completed'}, {id:'old-answer',subject:facts[0].subject,candidates:facts,selected:facts.find(f=>f.id===selectedFactId),correction:true,reviewedConflictId:'old-review',answer:'Saved.',status:'completed'}],conflictReviews:[{conflictTurnId:'old-review',resolutionTurnId:'old-answer',selectedFactId,source:'Marketing',author:'Maya'}]};
}

test('an equivalent repeat preserves the saved answer without reopening historic disagreement',async()=>{
  const facts=[budget,{...budget,id:'budget-marketing',source:'Marketing',value:'$15,000'}];
  const prompt='The budget is $20k.';
  const fx=fixture(raw([claim(prompt,{value:'$20k'})],[{claimRef:'c1',factId:budget.id,type:'equivalent'}]));
  const {turn}=await run(answeredState(facts,budget.id),prompt,fx);
  assert.equal(turn.selected.id,budget.id); assert.equal(turn.conflictQuestion,null); assert.ok(!fx.calls.includes('resolve'));
  assert.match(turn.answer,/Saved answer/);
});

test('a saved status lookup returns the human choice without requiring a fresh semantic relationship',async()=>{
  const old={id:'status-engineering',subject:'migration',attribute:'status',scope:'operations',value:'complete',text:'The migration is complete.',source:'Engineering'};
  const other={...old,id:'status-marketing',source:'Marketing',value:'blocked',text:'The migration is blocked.'};
  const fx=fixture(raw());
  const {turn}=await run(answeredState([old,other],old.id),'What is the migration status?',fx);
  assert.equal(turn.selected.id,old.id); assert.equal(turn.timing.modelCalls,0);
  assert.match(turn.answer,/complete/); assert.match(turn.answer,/Saved answer/); assert.equal(turn.conflictQuestion,null);
});

test('a temporally qualified lookup cannot use the saved-answer shortcut for an earlier period',async()=>{
  const first={...budget,validFrom:'2026-09-01',validTo:'2026-09-30'};
  const second={...first,id:'budget-marketing',source:'Marketing',value:'$15,000'};
  const fx=fixture(raw());
  const {turn}=await run(answeredState([first,second],first.id),'What is the budget for October?',fx);
  assert.equal(turn.timing.modelCalls,1); assert.ok(fx.calls.includes('model'));
  assert.equal(turn.answer,'Reviewed the supplied update.');
});

test('an unrelated currency update cannot reactivate an older currency disagreement',async()=>{
  const prompt='The budget is €30,000.';
  const fx=fixture(raw([claim(prompt,{value:'€30,000'})]));
  const {turn}=await run(initial([budget,{...budget,id:'budget-marketing',source:'Marketing',value:'$15,000'}]),prompt,fx);
  assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve'));
  assert.deepEqual(turn.candidates.map(f=>f.value),['€30,000']);
});

test('multiple conflicts persist distinct engine decisions and queue answers before one complete replay', async () => {
  const { currentConflictQuestion } = await import('./conflict-review.js');
  const { completedReplayCycle, buildCycleReplaySteps } = await import('./replay-cycle.js');
  const owner = { id: 'old-owner', source: 'Engineering', subject: 'migration', attribute: 'owner', scope: 'operations', value: 'Alex', text: 'Alex owns the migration.' };
  const prompt = 'The budget is $15,000. Maya owns the migration.';
  const fx = fixture(raw([claim('The budget is $15,000.'), claim('Maya owns the migration.', { ref: 'c2', subject: 'migration', attribute: 'owner', scope: 'operations', value: 'Maya' })], [
    { claimRef: 'c1', factId: budget.id, type: 'contradiction' }, { claimRef: 'c2', factId: owner.id, type: 'contradiction' },
  ]), { async correct(id, requestId, factId) { return { policy: 7, lesson: null, resolution: { selected_fact_id: factId }, trace: [] }; } });
  const { normalizeConversations } = await import('./conversations.js');
  let result = await run(normalizeConversations(initial([budget, owner])), prompt, fx);
  const original = result.turn;
  assert.equal(original.conflicts.length, 2);
  assert.equal(fx.calls.filter(call => call === 'resolve').length, 2);
  assert.equal(completedReplayCycle(result.state), null);
  for (const [index, group] of original.conflicts.entries()) {
    assert.equal(currentConflictQuestion(result.state, result.state.activeChatId).id, group.id);
    result = await processPrompt(result.state, 'Use the recorded choice.', 'Marketing', () => {}, undefined, [], { services: fx.services,
      conflictReview: { conflictTurnId: group.id, factId: group.candidates[0].id, rememberAuthority: false } });
    if (!index) assert.equal(completedReplayCycle(result.state), null);
  }
  assert.equal(currentConflictQuestion(result.state, result.state.activeChatId), null);
  assert.deepEqual(result.state.turns[0], original, 'original decisions stay immutable');
  const cycle = completedReplayCycle(result.state);
  assert.equal(cycle.turns.length, 3);
  const steps = buildCycleReplaySteps(cycle);
  const engineSteps = steps.filter(step => step.event.service === 'engine');
  assert.deepEqual(engineSteps.map(step => step.turn.subject), ['budget', 'migration']);
});
