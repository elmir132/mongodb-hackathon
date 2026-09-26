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
  assert.doesNotMatch(turn.answer,/Reviewed the supplied update/); assert.match(turn.answer,/\*\*Memory decision:\*\*/); assert.match(turn.answer,/20,000/);
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

test('translations and summaries survive conflicting evidence without replacing the engine choice',async()=>{
  const text='The budget is $15,000.';
  for (const [prompt,answer,label] of [['Translate this memo into French.','Le budget est de 15 000 $.','Translation'],['Summarize this memo.','The memo proposes a $15,000 budget.','Summary']]) {
    const fx=fixture(raw([claim(text,{sourceRef:'attachment:0'})],[{claimRef:'c1',factId:budget.id,type:'contradiction'}]));
    const generate=async input=>({...await fx.generate(input),answer});
    const {turn}=await processPrompt(initial(),prompt,'Marketing',()=>{},generate,[{name:'memo.md',text}],{memoryReview:true,services:fx.services});
    assert.ok(turn.answer.includes(answer)); assert.match(turn.answer,new RegExp(`${label} of supplied text`));
    assert.match(turn.answer,/Memory decision/); assert.match(turn.answer,/20,000/);
    assert.equal(turn.selected.id,budget.id); assert.ok(turn.conflictQuestion);
    assert.equal(fx.calls.filter(call=>call==='model').length,1);
  }
});

test('a source transformation survives a previously saved answer for the same evidence',async()=>{
  const other={...budget,id:'budget-marketing',source:'Marketing',value:'$15,000'};
  const state=answeredState([budget,other],budget.id);
  const fx=fixture(raw([],[],[budget.id,other.id]));
  const generate=async input=>({...await fx.generate(input),answer:'Le budget est de 15 000 $.'});
  const {turn}=await processPrompt(state,'Translate this memo into French.','Marketing',()=>{},generate,[{name:'memo.md',text:'The memo discusses a disputed amount.'}],{memoryReview:true,services:fx.services});
  assert.match(turn.answer,/Le budget/); assert.match(turn.answer,/Saved answer/);
  assert.equal(turn.selected.id,budget.id); assert.equal(turn.conflictQuestion,null);
});

test('omitted assertions remain original sources, never invented facts or successful memory checks',async()=>{
  const fx=fixture(raw());
  fx.generate=async input=>({answer:'',model:'fixture',memoryAnalysis:validateMemoryAnalysis(raw(),memoryAnalysisContext(input))});
  const {turn,state}=await run(initial(),'The budget is $15,000. Check this against project memory.',fx);
  assert.equal(state.facts.length,1); assert.equal(turn.memoryAnalysis.status,'unavailable');
  assert.match(turn.answer,/Memory checking was incomplete/); assert.doesNotMatch(turn.answer,/No saved answer is available|no supported memory conflict/);
  assert.ok(!fx.calls.includes('resolve')); assert.equal(state.turns.at(-1).prompt,turn.prompt);
  assert.equal(turn.trace.find(event=>event.stage==='extract').status,'unavailable');
});

test('partial extraction saves only grounded facts and reports the remaining omission',async()=>{
  const fx=fixture(raw([claim('The budget is $20,000.',{value:'$20,000'})]));
  const {turn,state}=await run(initial(),'The budget is $20,000. The migration is blocked.',fx);
  assert.equal(turn.memoryAnalysis.status,'partial'); assert.equal(state.facts.length,2);
  assert.match(turn.answer,/Only the validated claims were saved/);
  assert.equal(turn.incoming[0].subject,'budget');
});

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

test('a period-specific read uses relevant evidence without resurrecting other periods',async()=>{
  const september={...budget,validFrom:'2026-09-01',validTo:'2026-09-30'};
  const septemberOther={...september,id:'september-marketing',value:'$15,000',source:'Marketing'};
  const october={...budget,id:'october-budget',value:'$25,000',validFrom:'2026-10-01',validTo:'2026-10-31'};
  const fx=fixture(raw([],[],[october.id]));
  const {turn}=await run(initial([september,septemberOther,october]),'What is the budget in October?',fx);
  assert.equal(turn.conflict,false); assert.ok(!fx.calls.includes('resolve'));
  assert.deepEqual(turn.candidates.map(f=>f.id),[october.id]);
});

test('an explicit revision reopens a subject previously decided as a secondary group',async()=>{
  const owner={id:'owner-engineering',subject:'migration owner',attribute:'owner',scope:'operations',value:'Alex',text:'The migration owner is Alex.',source:'Engineering'};
  const other={...owner,id:'owner-marketing',value:'Maya',source:'Marketing'};
  const state=initial([budget,owner,other]);
  state.turns=[{id:'old-multi',subject:'budget',selected:budget,applied:'budget-lesson',answer:'Recorded both decisions.',status:'completed',conflicts:[{id:'old-multi:conflict:2',subject:'migration owner',candidates:[owner,other],selected:owner,applied:'owner-lesson',conflict:true}]}];
  const prompt='Actually, the migration owner is Jordan.';
  const fx=fixture(raw([claim(prompt,{subject:'migration owner',attribute:'owner',scope:'operations',value:'Jordan'})],[{claimRef:'c1',factId:owner.id,type:'revision'}]));
  fx.services.resolve=async(id)=>({policy:7,lesson:null,resolution:{conflict_id:id,selected_fact_id:owner.id,applied_precedent_id:'owner-lesson',policy_version:7},trace:[]});
  const {turn}=await run(state,prompt,fx);
  assert.equal(turn.requiresConfirmation,true); assert.ok(turn.conflictQuestion);
});

test('multiple applicability periods remain separate resolution evidence groups',async()=>{
  const {memoryEvidence}=await import('./memory-review.js');
  const september={...budget,id:'september-old',validFrom:'2026-09-01',validTo:'2026-09-30'};
  const october={...budget,id:'october-old',value:'$25,000',validFrom:'2026-10-01',validTo:'2026-10-31'};
  const newSeptember={...september,id:'september-new',source:'Marketing',provenance:{claimRef:'c1'}};
  const newOctober={...october,id:'october-new',source:'Marketing',value:'$15,000',provenance:{claimRef:'c2'}};
  const groups=memoryEvidence(initial([september,october,newSeptember,newOctober]),[newSeptember,newOctober],raw());
  assert.equal(groups.length,2); assert.equal(groups[0].conflict,true); assert.equal(groups[1].conflict,false);
  assert.deepEqual(groups[0].candidates.map(f=>f.id),['october-old','october-new']);
  assert.deepEqual(groups[1].candidates.map(f=>f.id),['september-old','september-new']);
});

test('a broad applicability claim cannot merge incompatible months through transitive overlap',async()=>{
  const {memoryEvidence}=await import('./memory-review.js');
  const september={...budget,id:'september-old',validFrom:'2026-09-01',validTo:'2026-09-30'};
  const october={...budget,id:'october-old',value:'$25,000',validFrom:'2026-10-01',validTo:'2026-10-31'};
  const broad={...budget,id:'year-budget',value:'$15,000',validFrom:'2026-01-01',validTo:'2026-12-31',provenance:{claimRef:'c1'}};
  const groups=memoryEvidence(initial([september,october,broad]),[broad],raw());
  assert.equal(groups.length,2);
  assert.ok(groups.every(group=>group.candidates.length===2 && group.candidates.some(f=>f.id===broad.id)));
  assert.ok(groups.every(group=>!(group.candidates.some(f=>f.id===september.id)&&group.candidates.some(f=>f.id===october.id))));
});

test('a relevant read preserves recorded semantic disagreements without replaying old revision intent',async()=>{
  const {memoryEvidence}=await import('./memory-review.js');
  const old={id:'status-old',subject:'migration',attribute:'status',scope:'operations',value:'complete',source:'Engineering'};
  const newer={...old,id:'status-new',value:'blocked',source:'Marketing'};
  const state=initial([old,newer]);
  state.turns=[{evidenceGroups:[{relations:[{newFactId:newer.id,factId:old.id,type:'revision'}]}]}];
  const groups=memoryEvidence(state,[],raw([],[],[newer.id]));
  assert.equal(groups.length,1); assert.equal(groups[0].conflict,true); assert.equal(groups[0].revision,false);
  assert.equal(groups[0].relations.length,1);
});

test('reported facts persist submitter identity without inventing claim authors',async()=>{
  const first='Marketing says the launch is Friday.', second='Engineering says the launch is Monday.';
  const fields={subject:'launch',attribute:'date',scope:'launch readiness'};
  const fx=fixture(raw([claim(first,{...fields,value:'Friday'}),claim(second,{...fields,ref:'c2',value:'Monday'})]));
  const result=await run(initial([]),`${first} ${second}`,fx);
  assert.equal(result.turn.conflict,true);
  assert.deepEqual(result.turn.candidates.map(f=>f.source),['Marketing','Engineering']);
  for (const fact of result.turn.incoming) {
    assert.equal(fact.author,undefined); assert.deepEqual(fact.submittedBy,{source:'Marketing',author:'Maya'});
    assert.equal(fact.provenance.reportedSource,fact.source);
  }
});

test('omitted reported shorthand is quoted in the reply and requests clarification',async()=>{
  const prompt='Marketing says the next release is Wednesday. Engineering says Thursday.';
  const fx=fixture(raw([claim('Marketing says the next release is Wednesday.',{subject:'next release',attribute:'date',scope:'launch readiness',value:'Wednesday'})]));
  const {turn}=await run(initial([]),prompt,fx);
  assert.equal(turn.memoryAnalysis.status,'partial'); assert.match(turn.answer,/Engineering says Thursday/);
  assert.match(turn.answer,/Please clarify/); assert.doesNotMatch(turn.answer,/Reviewed the supplied update/);
});

test('authority statement opens a fresh explicit question, without a correction or policy update',async()=>{
  const {currentConflictQuestion,needsConflictReview}=await import('./conflict-review.js');
  const {completedReplayCycle}=await import('./replay-cycle.js');
  const facts=[{id:'m',subject:'launch',attribute:'date',scope:'launch readiness',value:'Friday',source:'Marketing'}, {id:'e',subject:'launch',attribute:'date',scope:'launch readiness',value:'Monday',source:'Engineering'}];
  const previous=answeredState(facts,'m');
  const fx=fixture(raw());
  const prompt='Engineering owns launch readiness for this project.';
  const result=await run(previous,prompt,fx);
  assert.equal(result.turn.timing.modelCalls,0); assert.equal(result.turn.correction,false);
  assert.equal(result.turn.incoming.length,0); assert.equal(result.turn.authorityRequest.reason,prompt);
  assert.equal(result.turn.requiresConfirmation,true); assert.ok(needsConflictReview(result.state,result.turn));
  assert.equal(currentConflictQuestion(result.state,undefined).id,result.turn.id);
  assert.equal(completedReplayCycle(result.state),null);
  assert.equal(result.state.conflictReviews.length,1); assert.deepEqual(result.state.facts,previous.facts);
  assert.match(result.turn.answer,/No choice or policy change has been saved/);
  assert.ok(fx.calls.includes('resolve'));
});

test('answering reopened authority context preserves the original review in one completed replay',async()=>{
  const {completedReplayCycle}=await import('./replay-cycle.js');
  const facts=[{id:'m',subject:'launch',attribute:'date',scope:'launch readiness',value:'Friday',source:'Marketing'}, {id:'e',subject:'launch',attribute:'date',scope:'launch readiness',value:'Monday',source:'Engineering'}];
  const fx=fixture(raw([],[],facts.map(f=>f.id)));
  const {normalizeConversations}=await import('./conversations.js');
  const original=await run(normalizeConversations(initial(facts)),'Review the launch.',fx);
  const reopened=await run(original.state,'Engineering owns launch readiness for this project.',fx);
  const answered=await processPrompt(reopened.state,'Use Monday.','Marketing',()=>{},undefined,[],{conflictReview:{conflictTurnId:reopened.turn.id,factId:'e',rememberAuthority:false,reason:reopened.turn.authorityRequest.reason}});
  assert.deepEqual(completedReplayCycle(answered.state).turns.map(t=>t.id),[original.turn.id,reopened.turn.id,answered.turn.id]);
});

test('the exact pasted line-wrapped conflict saves both sources before engine resolution',async()=>{
  const prompt='Marketing says the launch is Friday. Engineering says the launch is\n  Monday.';
  const fields={subject:'launch',attribute:'date',scope:'launch readiness'};
  const fx=fixture(raw([
    claim('Marketing says the launch is Friday.',{...fields,value:'Friday'}),
    claim('Engineering says the launch is Monday.',{...fields,ref:'c2',value:'Monday'})
  ]));
  const result=await run(initial([]),prompt,fx);
  assert.equal(result.turn.memoryAnalysis.status,'validated');
  assert.equal(result.turn.conflict,true); assert.ok(fx.calls.includes('resolve'));
  assert.deepEqual(result.turn.incoming.map(f=>f.source),['Marketing','Engineering']);
  assert.equal(result.turn.incoming[1].provenance.quote,'Engineering says the launch is\n  Monday.');
  assert.doesNotMatch(result.turn.answer,/Memory checking was incomplete/);
  assert.ok(result.turn.conflictQuestion);
});

test('reported Q4 budgets save both departments and open a budget-specific question',async()=>{
  const prompt='Finance says the Q4 budget is $50,000. Product says the Q4 budget is\n  $75,000.';
  const fields={subject:'q4 budget',attribute:'budget',scope:'project finance'};
  const fx=fixture(raw([
    claim('Finance says the Q4 budget is $50,000.',{...fields,value:'$50,000'}),
    claim('Product says the Q4 budget is $75,000.',{...fields,ref:'c2',value:'$75,000'})
  ]));
  const {turn}=await run(initial([]),prompt,fx);
  assert.equal(turn.memoryAnalysis.status,'validated');assert.equal(turn.conflict,true);
  assert.deepEqual(turn.incoming.map(f=>[f.source,f.value]),[['Finance','$50,000'],['Product','$75,000']]);
  assert.equal(turn.incoming[1].text,'Product says the Q4 budget is\n  $75,000.');
  assert.ok(fx.calls.includes('resolve'));assert.match(turn.conflictQuestion.question,/q4 budget/);
  assert.doesNotMatch(turn.answer,/Memory checking was incomplete/);
});

test('new hire access conflict reaches the engine and requires a source-backed answer', async () => {
  const {currentConflictQuestion}=await import('./conflict-review.js');
  const {completedReplayCycle}=await import('./replay-cycle.js');
  const quotes=['Security says the new hire needs read-only access.', 'Manager says the new hire needs admin access.'];
  const claims=quotes.map((quote,i)=>claim(quote,{ref:`c${i+1}`,subject:'new hire',scope:'access control',attribute:'access',value:i ? 'admin access' : 'read-only access'}));
  const fx=fixture(raw(claims));
  const {turn,state}=await run(initial([]),quotes.join(' '),fx);
  assert.equal(turn.memoryAnalysis.status,'validated');
  assert.equal(turn.conflict,true);
  assert.equal(fx.calls.filter(c=>c==='resolve').length,1);
  assert.equal(fx.calls.filter(c=>c==='model').length,1);
  assert.deepEqual(turn.candidates.map(f=>f.source),['Security','Manager']);
  assert.ok(turn.candidates.every(f=>f.submittedBy.source==='Marketing' && !f.author));
  assert.match(turn.conflictQuestion.question,/read-only access or admin access/);
  assert.match(turn.answer,/claims disagree/);
  assert.equal(currentConflictQuestion(state,state.activeChatId)?.id,turn.id);
  assert.equal(completedReplayCycle(state,state.activeChatId),null);
});

test('equivalent access levels and separate resource subjects do not manufacture conflicts', async () => {
  for (const [subject,value] of [['new hire','administrator access'],['contractor','read-only access']]) {
    const old={id:'old-access',subject:'new hire',scope:'access control',attribute:'access',value:'admin access',source:'Security',text:'Security says the new hire needs admin access.'};
    const prompt=`Manager says the ${subject} needs ${value}.`;
    const fx=fixture(raw([claim(prompt,{subject,scope:'access control',attribute:'access',value})]));
    const {turn}=await run(initial([old]),prompt,fx);
    assert.equal(turn.conflict,false);
    assert.equal(turn.conflictQuestion,null);
    assert.ok(!fx.calls.includes('resolve'));
  }
});
