import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFact, memoryAnalysisContext, validateMemoryAnalysis, memoryValueKey } from '../server/memory-analysis.mjs';
const fact = { id:'budget-old',subject:'budget',scope:'project finance',attribute:'budget',value:'$20,000',text:'The budget is $20,000.',source:'Finance',author:'Lee' };
const context = (prompt, facts = [fact], attachments = []) => memoryAnalysisContext({prompt,state:{facts},attachments,source:'Marketing',author:'Maya'});
const claim = (quote, extra = {}) => ({ref:'c1',sourceRef:'prompt',quote,subject:'budget',scope:'project finance',attribute:'budget',value:'$15,000',...extra});
const analysis = (claims, relations = [], relevantFactIds = []) => ({claims,relations,relevantFactIds});

test('explicit new budget claim has exact evidence and trusted composer attribution', () => {
  const quote = 'The budget is $15,000.';
  const output = validateMemoryAnalysis(analysis([claim(quote,{source:'CEO',author:'Invented'})],[{claimRef:'c1',factId:'budget-old',type:'contradiction'}],['budget-old','invented']),context(quote));
  assert.equal(output.status,'validated');
  assert.equal(output.claims[0].source,'Marketing'); assert.equal(output.claims[0].author,'Maya');
  assert.equal(output.relations[0].type,'contradiction');
  assert.deepEqual(output.relevantFactIds,['budget-old']);
});

test('paraphrased amounts and status synonyms cannot become false conflicts', () => {
  const quote = 'The budget is $20k.';
  const output = validateMemoryAnalysis(analysis([claim(quote,{value:'$20,000'})],[{claimRef:'c1',factId:'budget-old',type:'contradiction'}]),context(quote));
  assert.equal(output.claims.length,1); assert.equal(output.relations.length,0);
  assert.equal(memoryValueKey(output.claims[0]),memoryValueKey(fact));
  const done = {id:'task-status',subject:'migration',scope:'operations',attribute:'status',value:'complete'};
  const text = 'The migration is finished.';
  const equivalent = validateMemoryAnalysis(analysis([claim(text,{subject:'migration',scope:'operations',attribute:'status',value:'complete'})],[{claimRef:'c1',factId:done.id,type:'equivalent'}]),context(text,[done]));
  assert.equal(equivalent.relations[0].type,'equivalent');
});

test('unknown IDs, hallucinated quotes, duplicate IDs and unsupported attributes are rejected', () => {
  const quote = 'The budget is $15,000.';
  const output = validateMemoryAnalysis(analysis([claim('The budget is $5.'),claim(quote),claim(quote),claim(quote,{ref:'c2',attribute:'secret'})],[{claimRef:'c1',factId:'invented',type:'contradiction'}]),context(quote));
  assert.equal(output.claims.length,1); assert.equal(output.rejected.claims,3); assert.equal(output.rejected.relations,1);
});

test('questions, hypothetical contexts, header dates and negation cannot be laundered through short quotes', () => {
  for (const prompt of ['Is the budget $15,000?', 'If the budget is $15,000, we can proceed.', 'Imagine the budget is $15,000.', 'The budget is not $15,000.']) {
    const quote = prompt.includes('budget is') ? 'budget is $15,000' : prompt;
    const output = validateMemoryAnalysis(analysis([claim(quote)]),context(prompt));
    assert.equal(output.claims.length,0,prompt);
  }
  const header = 'Prepared: Friday';
  const output = validateMemoryAnalysis(analysis([claim(header,{subject:'prepared',attribute:'date',scope:'schedule',value:'Friday'})]),context(header));
  assert.equal(output.claims.length,0);
});

test('different scope, subject, currencies and applicability periods never establish conflicts', () => {
  const quote = 'The budget is $15,000 from 2026-10-01 to 2026-10-31.';
  for (const old of [ {...fact,scope:'another project'}, {...fact,subject:'travel budget'}, {...fact,value:'€20,000'}, {...fact,validFrom:'2026-09-01',validTo:'2026-09-30'} ]) {
    const output = validateMemoryAnalysis(analysis([claim(quote,{validFrom:'2026-10-01',validTo:'2026-10-31'})],[{claimRef:'c1',factId:fact.id,type:'contradiction'}]),context(quote,[old]));
    assert.equal(output.claims.length,1); assert.equal(output.relations.length,0);
  }
});

test('revision requires explicit revision evidence and retains a separate relation type', () => {
  for (const [quote,expected] of [['The budget is $15,000.',0],['Actually, the budget is $15,000.',1]]) {
    const output = validateMemoryAnalysis(analysis([claim(quote)],[{claimRef:'c1',factId:fact.id,type:'revision'}]),context(quote));
    assert.equal(output.relations.length,expected);
  }
});

test('calendar dates normalize legacy weekday evidence without making unknown weeks conflict', () => {
  const old = {id:'old-launch',subject:'launch',scope:'launch readiness',value:'Friday',text:'The launch is Friday, October 2.',sourceDate:'2026-09-26'};
  assert.equal(canonicalFact(old).attribute,'date');
  const quote = 'The public rollout is October 2, 2026.';
  const newClaim = claim(quote,{subject:'rollout',attribute:'date',scope:'launch-readiness',value:'2026-10-02'});
  const output = validateMemoryAnalysis(analysis([newClaim],[{claimRef:'c1',factId:old.id,type:'equivalent'}]),context(quote,[old]));
  assert.equal(output.claims.length,1); assert.equal(output.claims[0].subject,'launch'); assert.equal(output.relations[0].type,'equivalent');
  const vague = 'The launch is Monday.';
  const uncertain = validateMemoryAnalysis(analysis([claim(vague,{subject:'launch',attribute:'date',scope:'launch readiness',value:'Monday'})],[{claimRef:'c1',factId:old.id,type:'contradiction'}]),context(vague,[old]));
  assert.equal(uncertain.relations.length,0);
});

test('attachment evidence is validated against its own source and cannot invent applicability', () => {
  const quote = 'The budget is $15,000.';
  const ctx = context('Review the memo.',[fact],[{name:'memo.md',text:quote}]);
  const good = validateMemoryAnalysis(analysis([claim(quote,{sourceRef:'attachment:0'})]),ctx);
  assert.equal(good.claims.length,1);
  const bad = validateMemoryAnalysis(analysis([claim(quote),claim(quote,{ref:'c2',sourceRef:'attachment:0',validFrom:'2026-10-01'})]),ctx);
  assert.equal(bad.claims.length,0);
});

test('malformed analysis is unavailable and empty valid analysis is an explicit completed check', () => {
  const ctx = context('Hello');
  for (const raw of [null,{}, {claims:'bad',relations:[],relevantFactIds:[]}]) assert.equal(validateMemoryAnalysis(raw,ctx).status,'unavailable');
  assert.equal(validateMemoryAnalysis(analysis([]),ctx).status,'validated');
});

test('context and proposal limits bound work without exposing unrelated state', () => {
  const ctx = memoryAnalysisContext({prompt:'x'.repeat(200_000),attachments:Array.from({length:20},()=>({text:'y'.repeat(100_000)})),state:{facts:Array.from({length:150},(_,i)=>({...fact,id:`f${i}`})),secret:'not for model'}});
  assert.equal(ctx.facts.length,80); assert.equal(ctx.sources.length,9);
  assert.ok(ctx.sources.reduce((n,item)=>n+item.text.length,0)<=160_000); assert.equal(ctx.secret,undefined);
  const quote='The budget is $15,000.';
  const output=validateMemoryAnalysis(analysis(Array.from({length:100},(_,i)=>claim(quote,{ref:`c${i+1}`}))),context(quote));
  assert.equal(output.claims.length,8); assert.equal(output.rejected.claims,92);
});

test('value grounding respects whole words and calendar validity', () => {
  const cases = [
    ['The migration is incomplete.',{subject:'migration',attribute:'status',scope:'operations',value:'complete'}],
    ['The migration owner is Alice.',{subject:'migration',attribute:'owner',scope:'operations',value:'Al'}],
    ['The launch is 2026-02-30.',{subject:'launch',attribute:'date',scope:'launch readiness',value:'2026-02-30'}],
  ];
  for (const [quote,fields] of cases) {
    const output=validateMemoryAnalysis(analysis([claim(quote,fields)]),context(quote));
    assert.equal(output.claims.length,0,quote);
  }
});

test('written dates reject impossible days and respect explicit and document leap years', () => {
  for (const [value, valid] of [['February 31, 2027',false],['February 29, 2027',false],['February 29, 2028',true],['April 31',false],['April 30',true],['February 29',true],['2028-02-29',true]]) {
    const quote = `The launch is ${value}.`;
    const result = validateMemoryAnalysis(analysis([claim(quote,{subject:'launch',attribute:'date',scope:'launch readiness',value})]),context(quote));
    assert.equal(result.claims.length,Number(valid),value);
  }
  for (const year of [2027,2028]) {
    const quote = 'The launch is February 29.';
    const result = validateMemoryAnalysis(analysis([claim(quote,{sourceRef:'attachment:0',subject:'launch',attribute:'date',scope:'launch readiness',value:'February 29'})]),context('Review this.',[],[{text:`Prepared: January 1, ${year}\n${quote}`} ]));
    assert.equal(result.claims.length,Number(year===2028));
  }
  const quote='The launch is Friday, February 31, 2027.';
  assert.equal(validateMemoryAnalysis(analysis([claim(quote,{subject:'launch',attribute:'date',scope:'launch readiness',value:'Friday'})]),context(quote)).claims.length,0);
});

test('empty or partial model analysis cannot silently pass over explicit assertions', () => {
  const quote='The acquisition budget is $20,000.';
  const ctx=context(`${quote} Check this against project memory.`,[{...fact,subject:'acquisition budget'}]);
  assert.deepEqual(ctx.reviewTargets,[{sourceRef:'prompt',quote}]);
  const empty=validateMemoryAnalysis(analysis([]),ctx);
  assert.equal(empty.status,'unavailable'); assert.equal(empty.claims.length,0);
  assert.deepEqual(empty.coverage.omitted,ctx.reviewTargets);
  const complete=validateMemoryAnalysis(analysis([claim(quote,{subject:'acquisition budget',value:'$20,000'})]),ctx);
  assert.equal(complete.status,'validated'); assert.equal(complete.coverage.omitted.length,0);
  const partial=validateMemoryAnalysis(analysis([claim(quote,{subject:'acquisition budget',value:'$20,000'})]),context(`${quote} The migration is blocked.`));
  assert.equal(partial.status,'partial'); assert.equal(partial.claims.length,1);
  assert.equal(partial.coverage.omitted[0].quote,'The migration is blocked.');
});

test('omission checks do not turn greetings, questions, hypotheticals or headers into assertions', () => {
  for (const prompt of ['Hello!', 'What is the budget?', 'If the budget is $20,000, we can proceed.', 'Imagine the budget is $20,000.', 'Prepared: February 31, 2027', 'Translate "the budget is $20,000" into French.', 'We also need a support owner for the first wave and a short explanation for teams who are halfway through the old setup flow.']) {
    const result=validateMemoryAnalysis(analysis([]),context(prompt));
    assert.equal(result.status,'validated',prompt); assert.equal(result.coverage.omitted.length,0,prompt);
  }
});
