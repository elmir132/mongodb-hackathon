// Local prototype adapter. A real engine can replace this module while returning
// the same turn + trace shape; this is not a team-agreed backend API contract.
export const STORAGE_KEY = 'chronicle.local-demo.v3';
const days = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const id = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const tokens = text => text.toLowerCase().match(/[a-z0-9]+/g) || [];
const title = value => value[0].toUpperCase() + value.slice(1).toLowerCase();

export function seedState() {
  return { version: 3, policy: 1, lesson: null, turns: [], notes: [], documents: [], facts: [{ id: 'fact-seed-engineering', source: 'Engineering', subject: 'launch', scope: 'launch readiness', value: 'Monday', text: 'The final readiness checks complete Monday, October 5. Public access should wait until those checks are complete.', document: 'Release readiness update', sourceDate: '2026-09-18', seeded: true }] };
}

function extractFacts(prompt, source) {
  const result = [];
  const subject = /next (?:release|launch)|release (?:b|2)/i.test(prompt) ? 'next release' : 'launch';
  const sentences = prompt.match(/[^.!?]+[.!?]?/g) || [prompt];
  for (const sentence of sentences) {
    // Questions are recorded as messages, never silently promoted to facts.
    if (/\?\s*$/.test(sentence) || /^\s*(what|when|why|how|who|can|could|should|is|are|do|does)\b/i.test(sentence)) continue;
    const named = /\b(marketing|engineering)\b/i.exec(sentence);
    const author = named ? title(named[1]) : source;
    const day = new RegExp(`\\b(${days})\\b`, 'i').exec(sentence);
    if (day && /launch|release|ready|readiness|marketing|engineering/i.test(sentence)) {
      result.push({ id: id('fact'), source: author, subject, scope: 'launch readiness', value: title(day[1]), text: sentence.trim() });
      continue;
    }
    const structured = /^\s*(?:remember(?: that)?[: ,]+)?(?:the |our )?([\w -]{2,55}?)\s+(?:is|are|will be|=)\s+(.+?)[.!]?\s*$/i.exec(sentence);
    if (structured) result.push({ id: id('fact'), source: author, subject: structured[1].trim().toLowerCase(), scope: 'other', value: structured[2].trim(), text: sentence.trim() });
  }
  return result;
}

export async function processPrompt(previous, prompt, source, persist, generate, attachments = []) {
  const state = structuredClone(previous);
  state.documents ||= [];
  const trace = [];
  const emit = (stage, title, detail, extra = {}) => trace.push({ id: id('event'), stage, title, detail, at: new Date().toISOString(), ...extra });
  const write = () => persist(structuredClone(state)); // Throws on failure; never report a failed write as saved.
  const turnId = id('turn');
  emit('receive', attachments.length ? `${source} uploaded a memo` : `Received ${source}’s message`, attachments.length ? `${attachments.map(file => file.name).join(', ')} · ${prompt}` : prompt, { source });
  const correction = /engineering (?:owns|is responsible for) (?:this project.?s )?launch readiness/i.test(prompt);
  let incoming = [], candidates = [], selected = null, applied = null, conflict = false, answer, subject;

  if (correction) {
    const previousTurn = [...state.turns].reverse().find(turn => turn.subject && ['launch', 'next release'].includes(turn.subject));
    subject = previousTurn?.subject || 'launch';
    candidates = state.facts.filter(fact => fact.subject === subject);
    state.lesson = { id: id('lesson'), text: 'Engineering owns launch readiness for this project.', project: 'Atlas launch', scope: 'launch readiness', reason: prompt };
    state.policy = 2;
    emit('write', 'Writing the correction', 'Append the reason, project scope, and a new policy version.');
    write();
    emit('saved', 'Correction saved locally', 'Scoped lesson + policy v2 written to this browser. Policy v1 and earlier facts remain in history.', { count: state.facts.length });
    emit('recall', 'Read the affected facts', `${candidates.length} existing claims about ${subject}.`);
    selected = [...candidates].reverse().find(fact => fact.source === 'Engineering') || null;
    emit('policy', 'Apply the human correction', 'Engineering owns launch readiness within Atlas launch only.');
    answer = selected ? `Corrected to ${selected.value}. I saved your reason as a lesson for this project’s launch readiness and created policy v2. The original claims and decision are preserved.` : 'I saved the scoped lesson and policy v2. There is no Engineering claim for this release yet, so I still need its readiness date.';
  } else {
    if (attachments.length) {
      emit('write', 'Saving the original memo', 'Retain the uploaded text, filename, source, and upload time before extracting facts.', { entity: 'document' });
      for (const file of attachments) state.documents.push({ id: id('document'), name: file.name, text: file.text, source, uploadedAt: new Date().toISOString(), example: Boolean(file.example) });
      write();
      emit('saved', 'Memo saved locally', 'The original document is retained as evidence, not just the extracted date.', { entity: 'document' });
      emit('extract', 'Read the memo for factual claims', 'The local demo parser identifies date claims; the connected model reviews the full document.');
      incoming = attachments.flatMap(file => extractFacts(file.text, source).map(fact => ({ ...fact, document: file.name, sourceDate: new Date().toISOString().slice(0, 10) })));
    } else incoming = extractFacts(prompt, source);
    const before = state.facts.length;
    state.facts.push(...incoming);
    if (!incoming.length && !attachments.length && !/[?]|^\s*(what|when|why|how|summari[sz]e|list|show|tell|can|could|write|draft|create|review|explain|translate)\b/i.test(prompt)) state.notes.push({ id: id('note'), text: prompt, source });
    emit('write', incoming.length ? 'Saving the incoming fact' : 'Recording the message', incoming.length ? `${incoming.map(fact => `${fact.source}: ${fact.value}`).join(' · ')} → local fact store. Existing facts are retained.` : 'Keep the message in the session; do not treat a question as a fact.', { entity: attachments.length && incoming.length ? 'extracted-facts' : 'message' });
    // The message is written before lookup, then completed with its response below.
    state.turns.push({ id: turnId, prompt, source, status: 'recorded', answer: null });
    write();
    emit('saved', incoming.length ? 'Fact saved locally' : 'Message saved locally', incoming.length ? `${before} → ${state.facts.length} retained facts. The new claim now has a record ID.` : 'The message is recorded in this browser.', { count: state.facts.length, factIds: incoming.map(fact => fact.id) });
    subject = incoming[0]?.subject || (/next (?:release|launch)|release (?:b|2)/i.test(prompt) ? 'next release' : /launch|release|ready/i.test(prompt) ? 'launch' : null);
    if (!subject) {
      const words = tokens(prompt);
      const match = [...state.facts].reverse().find(fact => tokens(fact.subject).some(word => words.includes(word)));
      subject = match?.subject;
    }
    candidates = subject ? state.facts.filter(fact => fact.subject === subject) : [];
    emit('recall', 'Look up existing project memory', candidates.length ? `${candidates.length} ${subject} claims found. ${candidates.filter(fact => fact.seeded).map(fact => `Earlier evidence: ${fact.document || 'Engineering update'}${fact.sourceDate ? ` · ${fact.sourceDate}` : ''}.`).join(' ')}` : `${state.facts.length} facts available; no matching structured evidence found.`);
    conflict = new Set(candidates.map(fact => fact.value.toLowerCase())).size > 1;
    emit('compare', conflict ? 'A conflict is present' : candidates.length ? 'Check the evidence' : 'No supported answer in memory', candidates.length ? candidates.map(fact => `${fact.source}: ${fact.value}`).join(' · ') : 'A connected model is needed to interpret this request beyond local project facts.');
    const inScope = candidates.length && candidates.every(fact => fact.scope === 'launch readiness');
    if (state.lesson && inScope && conflict) {
      selected = [...candidates].reverse().find(fact => fact.source === 'Engineering') || null;
      applied = selected ? state.lesson.id : null;
    } else if (inScope && conflict) {
      selected = [...candidates].reverse().find(fact => fact.source === 'Marketing') || null;
    } else if (candidates.length && !conflict) selected = candidates.at(-1);
    emit('policy', applied ? 'Scoped precedent applied' : state.lesson && conflict && !inScope ? 'Launch lesson is out of scope' : 'Evaluate the current policy', applied ? 'Same project + launch readiness. Engineering’s stored claim is selected.' : conflict && inScope ? 'Policy v1 prioritizes Marketing. No precedent applied.' : conflict ? 'No authority rule supports a choice here. Ask a human.' : 'Do not invent conflicts or apply an unnecessary precedent.', { applied });
    const saved = incoming.length ? `I saved ${incoming.map(fact => `${fact.source}’s ${fact.value} claim`).join(' and ')}. ` : '';
    if (selected) {
      answer = `${saved}${conflict ? `It conflicts with ${candidates.filter(fact => fact.id !== selected.id).map(fact => `${fact.source}’s ${fact.value}`).join(' and ')} in memory. ` : ''}${subject === 'launch' || subject === 'next release' ? `The ${subject} date is ${selected.value}.` : `${subject}: ${selected.value}.`} ${applied ? 'Engineering owns readiness here, so I applied your saved lesson under policy v2.' : conflict ? 'The starting policy gives Marketing priority. Both claims remain saved.' : 'This is the current recorded information.'}`;
    } else if (conflict) answer = `${saved}The stored claims disagree: ${candidates.map(fact => `${fact.source} says ${fact.value}`).join('; ')}. I need a human to identify the right authority. ${state.lesson ? 'The launch-readiness lesson does not settle this question.' : 'No applicable rule establishes a winner.'}`;
    else if (/summari[sz]e|list|show.*(?:facts|memory)/i.test(prompt)) answer = `Here is the stored project memory:\n${state.facts.map(fact => `• ${fact.source}: ${fact.subject} — ${fact.value}${fact.seeded ? ' (seeded example)' : ''}`).join('\n')}${state.notes.length ? `\n${state.notes.length} unstructured note(s) are also retained.` : ''}`;
    else answer = `${state.notes.some(note => note.text === prompt) ? 'I saved your note locally. ' : 'I recorded your question. '}I don’t have enough structured project evidence to answer it. This prototype accepts any prompt, but a general AI model is not connected yet. You can add facts, ask about stored facts, or request a memory summary.`;
  }

  let modelResult = null;
  if (generate) {
    emit('generate', 'Send context to the selected model', 'Pass the prompt, stored evidence, current policy, and conversation to the connected provider.');
    modelResult = await generate({ prompt, source, state, draft: answer, selected, conflict, attachments });
    answer = modelResult.answer;
    emit('generated', 'Model response received', `${modelResult.model} returned the response. No database integration is implied.`);
  }
  emit('resolve', selected ? `Selected ${selected.value}` : correction ? 'Lesson recorded' : conflict ? 'Human input needed' : 'Answer prepared', answer);
  const turn = { id: turnId, prompt, source, attachments, answer, subject, incoming, candidates, selected, applied, conflict, correction, policy: state.policy, lesson: state.lesson, factCount: state.facts.length, model: modelResult?.model || 'Local rules', provider: modelResult?.provider || 'local', status: 'completed', trace: [] };
  emit('commit', 'Save the decision and its evidence', `Append the answer, supporting IDs, applied precedent, and policy v${state.policy}.`);
  const placeholder = state.turns.findIndex(item => item.id === turnId);
  if (placeholder >= 0) state.turns[placeholder] = turn; else state.turns.push(turn);
  write();
  emit('committed', 'Decision saved locally', 'The response and its evidence are retained across reloads in this browser.');
  emit('respond', 'Return the answer', 'The terminal response is ready. Replay visualizes this recorded trace without writing again.');
  turn.trace = trace;
  write();
  return { state, turn };
}
