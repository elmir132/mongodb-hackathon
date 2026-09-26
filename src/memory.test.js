import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState, processPrompt} from './memory.js';
const persist = () => {};

test('Marketing enters one fact, saves it, and finds stored Engineering evidence', async () => {
  const writes=[];
  const {state,turn}=await processPrompt(seedState(),'The launch is Friday. When are we launching?','Marketing', value=>writes.push(value));
  assert.equal(state.facts.length,2); assert.equal(turn.incoming.length,1);
  assert.equal(turn.conflict,true); assert.equal(turn.selected.value,'Friday');
  assert.equal(writes[0].facts[1].value,'Friday'); assert.equal(writes[0].turns[0].status,'recorded');
  assert.ok(turn.trace.findIndex(x=>x.stage==='saved')<turn.trace.findIndex(x=>x.stage==='recall'));
  assert.deepEqual(JSON.parse(JSON.stringify(state)),state);
});
test('correction survives serialized storage and affects a new release only', async () => {
  let {state}=await processPrompt(seedState(),'The launch is Friday.','Marketing',persist);
  ({state}=await processPrompt(state,'Engineering owns launch readiness for this project.','You',persist));
  state=JSON.parse(JSON.stringify(state));
  const next=await processPrompt(state,'Marketing says the next release is Tuesday. Engineering says it will be ready Thursday. When is the next release?','Marketing',persist);
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
  assert.equal(result.state.facts.length,1); assert.equal(result.turn.model,'test-model');
  const query=await processPrompt(result.state,'When is the launch?','You',persist);
  assert.equal(query.turn.incoming.length,0); assert.equal(query.turn.selected.value,'Monday');
});
test('storage failure never returns a saved response or calls a model', async () => {
  let called=false;
  await assert.rejects(processPrompt(seedState(),'The launch is Friday.','Marketing',()=>{throw new Error('quota')},async()=>{called=true;}),/quota/);
  assert.equal(called,false);
});
test('failed model retains the already-saved fact without claiming an answer', async () => {
  let latest;
  await assert.rejects(processPrompt(seedState(),'The launch is Friday.','Marketing',state=>{latest=state},async()=>{throw new Error('provider unavailable')}),/provider unavailable/);
  assert.equal(latest.facts.length,2); assert.equal(latest.turns[0].answer,null);
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
  assert.equal(writes[0].facts.length,1);
  assert.equal(result.turn.subject,'launch');
  assert.equal(result.turn.conflict,true);
  assert.ok(result.turn.candidates.some(fact=>fact.source==='Engineering'&&fact.sourceDate==='2026-09-18'));
  const trace=result.turn.trace;
  assert.ok(trace.findIndex(item=>item.stage==='saved'&&item.entity==='document')<trace.findIndex(item=>item.stage==='extract'));
  assert.equal(result.state.documents[0].text,text);
});
