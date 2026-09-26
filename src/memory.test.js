import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState, processPrompt} from './memory.js';
const persist = () => {};

test('Marketing enters one fact, saves it, and finds stored Engineering evidence', async () => {
  const writes=[];
  const {state,turn}=await processPrompt(seedState(),'The launch is Friday. When are we launching?','Marketing', value=>writes.push(value));
  assert.equal(state.facts.length,3); assert.equal(turn.incoming.length,1);
  assert.equal(turn.conflict,true); assert.equal(turn.selected.value,'Friday');
  assert.equal(writes[0].facts[2].value,'Friday'); assert.equal(writes[0].turns[0].status,'recorded');
  assert.ok(turn.trace.findIndex(x=>x.stage==='saved')<turn.trace.findIndex(x=>x.stage==='recall'));
  assert.deepEqual(JSON.parse(JSON.stringify(state)),state);
});
test('correction survives serialized storage and affects a new release only', async () => {
  let {state}=await processPrompt(seedState(),'The launch is Friday.','Marketing',persist);
  ({state}=await processPrompt(state,'Engineering owns launch readiness for this project.','You',persist));
  state=JSON.parse(JSON.stringify(state));
  const {readFile}=await import('node:fs/promises');
  const text=await readFile(new URL('./fixtures/next-release-memo.md',import.meta.url),'utf8');
  const next=await processPrompt(state,'Can you review the next release brief before I circulate it?','Marketing',persist,undefined,[{name:'Next release brief.md',text,example:true}]);
  assert.equal(next.turn.incoming.length,1);
  assert.equal(next.turn.author,'Maya');
  assert.equal(next.turn.selected.author,'Alex');
  assert.equal(next.turn.selected.document,'October release planning notes');
  assert.equal(next.state.documents[0].author,'Maya');
  assert.equal(next.turn.selected.value,'Thursday'); assert.ok(next.turn.applied);
  assert.equal(next.state.turns[0].selected.value,'Friday');
  ({state}=await processPrompt(next.state,'The budget is $20000.','Marketing',persist));
  const budget=await processPrompt(state,'The budget is $15000.','Engineering',persist);
  assert.equal(budget.turn.conflict,true); assert.equal(budget.turn.selected,null); assert.equal(budget.turn.applied,null);
});
test('arbitrary prompts reach a model and queries do not become facts', async () => {
  let calls=0;
  const result=await processPrompt(seedState(),'Write a short haiku about rain.','You',persist, async context=>{calls++; assert.equal(context.prompt,'Write a short haiku about rain.'); return {answer:'Rain taps on the glass.',provider:'test',model:'test-model'};});
  assert.equal(calls,1); assert.equal(result.turn.answer,'Rain taps on the glass.');
  assert.equal(result.state.facts.length,2); assert.equal(result.turn.model,'test-model');
  const query=await processPrompt(result.state,'When is the launch?','You',persist);
  assert.equal(query.turn.incoming.length,0); assert.equal(query.turn.selected.value,'Monday, October 5th');
});
test('storage failure never returns a saved response or calls a model', async () => {
  let called=false;
  await assert.rejects(processPrompt(seedState(),'The launch is Friday.','Marketing',()=>{throw new Error('quota')},async()=>{called=true;}),/quota/);
  assert.equal(called,false);
});
test('failed model retains the already-saved fact without claiming an answer', async () => {
  let latest;
  await assert.rejects(processPrompt(seedState(),'The launch is Friday.','Marketing',state=>{latest=state},async()=>{throw new Error('provider unavailable')}),/provider unavailable/);
  assert.equal(latest.facts.length,3); assert.equal(latest.turns[0].answer,null);
});

test('a natural memo is saved before extracting its launch claim and finding older evidence', async () => {
  const {readFile}=await import('node:fs/promises');
  const text=await readFile(new URL('./fixtures/launch-memo.md',import.meta.url),'utf8');
  const writes=[];
  const result=await processPrompt(seedState(),'Can you review this before I share it?','Marketing',state=>writes.push(state),async context=>{
    assert.equal(context.attachments[0].text,text);
    assert.equal(context.selected.value,'Friday');
    return {answer:'The memo targets Friday, but the earlier readiness update says Monday.',model:'test',provider:'test'};
  },[{name:'Marketing memo.md',text,example:true}]);
  assert.equal(writes[0].documents.length,1);
  assert.equal(writes[0].facts.length,2);
  assert.equal(result.turn.subject,'launch');
  assert.equal(result.turn.incoming[0].author,'Maya');
  assert.equal(writes[1].turns[0].author,'Maya');
  assert.equal(result.turn.conflict,true);
  assert.ok(result.turn.candidates.some(fact=>fact.source==='Engineering'&&fact.sourceDate==='2026-09-18'));
  const trace=result.turn.trace;
  assert.ok(trace.findIndex(item=>item.stage==='saved'&&item.entity==='document')<trace.findIndex(item=>item.stage==='extract'));
  assert.equal(result.state.documents[0].text,text);
});

test('submitted message and attachment persist before the model finishes, with one stable turn ID', async () => {
  const files = [{ name: 'memo.md', text: 'The launch is Friday.', example: true }];
  let latest, finish;
  const response = new Promise(resolve => { finish = resolve; });
  const pending = processPrompt(seedState(), 'Review this memo?', 'Marketing', state => { latest = state; }, () => response, files, { turnId: 'turn-submitted' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(latest.turns.length, 1);
  assert.equal(latest.turns[0].id, 'turn-submitted');
  assert.equal(latest.turns[0].answer, null);
  assert.deepEqual(latest.turns[0].attachments, files);
  finish({ answer: 'The dates conflict.', model: 'test', provider: 'test' });
  const result = await pending;
  assert.equal(result.state.turns.length, 1);
  assert.equal(result.turn.id, 'turn-submitted');
  assert.equal(result.turn.status, 'completed');
});

test('a failed correction response retains its message and the saved lesson', async () => {
  let latest;
  await assert.rejects(processPrompt(seedState(), 'Engineering owns launch readiness for this project.', 'You', state => { latest = state; }, async () => { throw new Error('offline'); }, [], { turnId: 'turn-correction' }), /offline/);
  assert.equal(latest.turns[0].id, 'turn-correction');
  assert.equal(latest.turns[0].status, 'recorded');
  assert.equal(latest.turns[0].answer, null);
  assert.equal(latest.policy, 2);
  assert.ok(latest.lesson);
});

test('expanded preset date agrees with the same calendar date in a new claim', async () => {
  const result = await processPrompt(seedState(), 'The launch is Monday, October 5.', 'Engineering', persist);
  assert.equal(result.turn.conflict, false);
  assert.equal(result.state.facts[0].value, 'Monday, October 5th');
});
