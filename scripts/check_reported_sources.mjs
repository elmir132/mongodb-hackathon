// Real connected acceptance check, isolated from the user's selected workspace.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { processPrompt, seedState } from '../src/memory.js';
import { liveServices, serviceRequest } from '../src/services.js';
import { currentConflictQuestion } from '../src/conflict-review.js';
import { normalizeConversations } from '../src/conversations.js';

const transport = globalThis.fetch;
globalThis.fetch = (url, init) => transport(typeof url === 'string' && url.startsWith('/') ? `http://127.0.0.1:5173${url}` : url, init);
const workspaceId = `workspace-qa-reported-${crypto.randomUUID()}`;
const services = liveServices(workspaceId, {storage:'atlas'});
const measurements = [];
// Optional service-quota pacing belongs to QA, never to application requests.
const paceMs = Math.max(0, Number(process.env.CHRONICLE_QA_PACE_MS) || 0);
let lastRun = 0;
console.log(JSON.stringify({workspaceId}));
async function generate(context) {
  const response = await fetch('/api/respond', {method:'POST',headers:{'Content-Type':'application/json','X-Chronicle-Request':'1'},body:JSON.stringify({...context,provider:'codex',model:'gpt-6-luna'})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || 'Model request failed');
  return data;
}
async function run(state,prompt,options={}) {
  const pause = Math.max(0, lastRun + paceMs - Date.now());
  if (pause) await new Promise(resolve => setTimeout(resolve, pause));
  lastRun = Date.now();
  const result=await processPrompt(state,prompt,'Marketing',()=>{},generate,[],{services,memoryReview:true,...options});
  const record={prompt,...result.turn.timing,status:result.turn.memoryAnalysis?.status,selected:result.turn.selected?.value,policy:result.state.policy,applied:result.turn.applied};
  measurements.push(record); console.log(JSON.stringify(record));
  return result;
}
let result=await run(normalizeConversations(seedState()),'Marketing says the launch is Friday. Engineering says the launch is Monday.');
assert.equal(result.turn.memoryAnalysis.status,'validated');
assert.equal(result.turn.selected.source,'Marketing'); assert.equal(result.turn.selected.value,'Friday');
assert.deepEqual(result.turn.incoming.map(f=>f.source),['Marketing','Engineering']);
assert.ok(result.turn.incoming.every(f=>!f.author && f.submittedBy.author==='Maya'));
const initialTurn=result.turn;
result=await run(result.state,'Engineering owns launch readiness for this project.');
assert.equal(result.state.policy,1); assert.equal(result.turn.correction,false); assert.equal(result.turn.timing.modelCalls,0);
assert.ok(result.turn.authorityRequest); assert.equal(currentConflictQuestion(result.state,result.state.activeChatId).id,result.turn.id);
// Keep a separate UI QA snapshot so browser verification exercises the pending
// card without changing this accepted learning/reuse workspace.
const uiWorkspaceId=`workspace-qa-reported-ui-${crypto.randomUUID()}`;
await serviceRequest('save',{workspaceId:uiWorkspaceId,state:result.state,operation:'Labeled QA pending authority card'});
await writeFile('/tmp/chronicle-reported-ui-qa.json',JSON.stringify({uiWorkspaceId}));
const pending=result.turn;
const choice=pending.candidates.find(f=>f.source==='Engineering');
result=await run(result.state,'Use Monday from Engineering for launch.',{memoryReview:false,conflictReview:{conflictTurnId:pending.id,factId:choice.id,rememberAuthority:true,reason:pending.authorityRequest.reason}});
assert.equal(result.state.policy,2); assert.equal(result.turn.selected.value,'Monday'); assert.equal(result.turn.retrievalReady,true);
const precedent=result.turn.lesson.id;
result=await run(result.state,'Marketing says the next release is Wednesday. Engineering says Thursday.');
assert.equal(result.turn.memoryAnalysis.status,'validated'); assert.equal(result.turn.incoming.length,2);
assert.equal(result.turn.selected.source,'Engineering'); assert.equal(result.turn.selected.value,'Thursday');
assert.equal(result.turn.applied,precedent); assert.equal(result.turn.conflictQuestion,null);
const loaded=await serviceRequest('load',{workspaceId});
assert.equal(loaded.state.policy,2); assert.equal(loaded.state.lessons[precedent].id,precedent);
assert.equal(loaded.state.turns.find(t=>t.id===initialTurn.id).selected.value,'Friday');
const report={workspaceId,uiWorkspaceId,precedent,policy:loaded.state.policy,measurements};
await writeFile('/tmp/chronicle-reported-sources-qa.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
