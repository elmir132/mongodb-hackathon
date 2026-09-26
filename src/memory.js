import { isDecisionTurn } from './decision-status.js';
import { authorityScope, authorityLabel, authorityReviewRequest, findConflictTurn, canRememberAuthority, needsConflictReview, matchingConflictReview, fallbackConflictQuestion, validateConflictQuestion } from './conflict-review.js';
import { materializeClaims, memoryEvidence, savedAnswerLookup, decisionSummary } from './memory-review.js';
import { reviewTask } from '../server/review-task.mjs';
// One orchestration path for persisted turns. The legacy parser remains an
// explicit fallback; connected memory review proposes evidence, never decisions.
export const STORAGE_KEY = 'chronicle.local-demo.v3';
// Fictional people in the labeled example workspace; roles remain policy keys.
export const DEMO_MEMBERS = { Marketing: 'Maya', Engineering: 'Alex' };
export const sourceLabel = ({ source = 'You', author, submittedBy }) => submittedBy
  ? `${source} (reported by ${submittedBy.author ? `${submittedBy.author} [${submittedBy.source}]` : submittedBy.source})`
  : author ? `${author} [${source}]` : source;
const days = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const id = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const words = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mentionsSubject = (text, subject) => ` ${words(text)} `.includes(` ${words(subject)} `);
const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
const calendarDate = text => new RegExp(`\\b(?:${months})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, 'i').exec(text)?.[0];
const claimValue = fact => (calendarDate(fact.value) || calendarDate(fact.text || '') || fact.value).toLowerCase();
const explicitRevision = text => /\b(?:actually|correction|instead|change|revise|override|should be|must be|needs to be)\b/i.test(text);
const title = value => value[0].toUpperCase() + value.slice(1).toLowerCase();

export function seedState() {
  return { version: 3, policy: 1, lesson: null, turns: [], notes: [], documents: [], facts: [{ id: 'fact-seed-engineering', source: 'Engineering', author: 'Alex', subject: 'launch', scope: 'launch readiness', value: 'Monday', text: 'The final readiness checks complete Monday, October 5. Public access should wait until those checks are complete.', document: 'Release readiness update', sourceDate: '2026-09-18', seeded: true }, { id: 'fact-seed-next-engineering', source: 'Engineering', author: 'Alex', subject: 'next release', scope: 'launch readiness', value: 'Thursday', text: 'The next release will be ready Thursday, October 15, after the migration rehearsal and accessibility checks. Keep the customer announcement behind that gate.', document: 'October release planning notes', sourceDate: '2026-09-24', seeded: true }] };
}

function extractFacts(prompt, source) {
  const result = [];
  const subject = /next (?:release|launch)|release (?:b|2)/i.test(prompt) ? 'next release' : 'launch';
  const content = prompt.replace(/^(?:#{1,6}\s.*|(?:From|To|Prepared|Status):.*)$/gm, '');
  const sentences = content.match(/[^.!?]+[.!?]?/g) || [content];
  for (const sentence of sentences) {
    // Questions are recorded as messages, never silently promoted to facts.
    if (/\?\s*$/.test(sentence) || /^\s*(what|when|why|how|who|can|could|should|is|are|do|does)\b/i.test(sentence)) continue;
    const named = /\b(marketing|engineering)\b/i.exec(sentence);
    const author = named ? title(named[1]) : source;
    const date = calendarDate(sentence);
    const day = new RegExp(`\\b(${days})\\b`, 'i').exec(sentence);
    if ((day || date) && /\b(?:launch|release)\b/i.test(sentence)) {
      result.push({ id: id('fact'), source: author, subject, scope: 'launch readiness', value: day ? title(day[1]) : date[0].toUpperCase() + date.slice(1), text: sentence.trim() });
      continue;
    }
    const structured = /^\s*(?:(?:actually|correction)[,:]?\s+)?(?:remember(?: that)?[: ,]+)?(?:the |our )?([\w -]{2,55}?)\s+(?:is|are|will be|should be|must be|needs to be|=)\s+(.+?)[.!]?\s*$/i.exec(sentence);
    if (structured) result.push({ id: id('fact'), source: author, subject: structured[1].trim().toLowerCase(), scope: 'other', value: structured[2].trim(), text: sentence.trim() });
  }
  return result;
}

export async function processPrompt(previous, prompt, source, persist, generate, attachments = [], { turnId = id('turn'), chatId = previous.activeChatId, conflictReview = null, services = null, memoryReview = false } = {}) {
  const startedMs = performance.now();
  const state = structuredClone(previous);
  const reviewedTurn = conflictReview && findConflictTurn(state, conflictReview.conflictTurnId);
  if (conflictReview) {
    if (!reviewedTurn || reviewedTurn.chatId !== chatId || !needsConflictReview(state, reviewedTurn)) throw new Error('This conflict is no longer awaiting an answer in this chat.');
    if (conflictReview.factId !== null && !reviewedTurn.candidates.some(fact => fact.id === conflictReview.factId)) throw new Error('Choose one of the recorded claims or leave the conflict unresolved.');
    if (conflictReview.rememberAuthority && !canRememberAuthority(reviewedTurn, reviewedTurn.candidates.find(fact => fact.id === conflictReview.factId))) throw new Error('Choose a recorded source within one claim scope to remember its authority.');
  }
  const author = DEMO_MEMBERS[source];
  const authorityRequest = !conflictReview && memoryReview ? authorityReviewRequest(previous, prompt, chatId, attachments) : null;
  const speaker = sourceLabel({ source, author });
  state.documents ||= [];
  const trace = [];
  const emit = (stage, title, detail, extra = {}) => {
    const confirmation = services && ['saved', 'committed'].includes(stage) && ['atlas', 'storage'].includes(trace.at(-1)?.service) ? trace.at(-1).service : 'local';
    const event = { id: id('event'), stage, title, detail, at: new Date().toISOString(), ...(services ? { service: confirmation, recordedBy: 'browser' } : {}), ...extra }; trace.push(event); return event; };
  const write = async (operation = 'Save conversation and trace', route = null) => {
    if (services) {
      const pending = trace.at(-1);
      const path = route || (pending?.stage === 'write' ? pending.entity === 'extracted-facts' ? 'fact-write' : 'ingest' : pending?.stage === 'commit' ? 'decision-write' : null);
      const result = await services.save(structuredClone(state), pending?.title || operation, path);
      state.policy = result.policy; state.lesson = result.lesson; state.lessons = { ...state.lessons, ...result.lessons };
      trace.push(...result.trace);
    }
    await persist(structuredClone(state));
  }; // Confirm server persistence before reporting success; browser cache is secondary.
  emit('receive', attachments.length ? `${speaker} uploaded a memo` : `Received ${speaker}’s message`, attachments.length ? `${attachments.map(file => file.name).join(', ')} · ${prompt}` : prompt, { source });
  function recordModel(event, result) {
    if (result.modelTrace?.request) {
      const request = result.modelTrace.request;
      Object.assign(event, { request, service: 'model', route: 'prompt-to-model', at: request.startedAt,
        detail: `${request.model} · ${request.attachments.length} document(s), ${request.factIds.length} facts, policy v${request.policyVersion}.` });
    }
    emit('generated', 'Model response received', `${result.model} returned its response.`, result.modelTrace ? { service: 'model', route: 'model-answer', response: result.modelTrace.response, at: result.modelTrace.response.completedAt } : {});
  }
  const correction = Boolean(conflictReview) || (!services && /engineering (?:owns|is responsible for) (?:this project.?s )?launch readiness/i.test(prompt));
  let incoming = [], candidates = [], selected = null, applied = null, conflict = false, answer, subject, engineResolution = null, retrievalReady = null, requiresConfirmation = false, savedReview = null, modelResult = null, analysis = null, evidenceGroups = [], newDocuments = [], lookup = null, conflictRecords = [];

  if (correction) {
    const previousTurn = reviewedTurn || [...state.turns].reverse().find(turn => (!chatId || turn.chatId === chatId) && turn.subject && ['launch', 'next release'].includes(turn.subject));
    subject = previousTurn?.subject || 'launch';
    candidates = reviewedTurn ? reviewedTurn.candidates : state.facts.filter(fact => fact.subject === subject);
    selected = conflictReview ? candidates.find(fact => fact.id === conflictReview.factId) || null : [...candidates].reverse().find(fact => fact.source === 'Engineering') || null;
    const rememberAuthority = !conflictReview || conflictReview.rememberAuthority;
    if (services) {
      const result = await services.correct(previousTurn.id, turnId, selected?.id || null, conflictReview?.reason || prompt, rememberAuthority, { scope: previousTurn.engineResolution?.scope || authorityScope(previousTurn.candidates[0]), subject });
      trace.push(...result.trace.map(event => memoryReview && evidenceGroups.filter(g => g.conflict).length > 1 ? { ...event, conflictGroupId: `${turnId}:conflict:1` } : event)); state.policy = result.policy; state.lesson = result.lesson; state.lessons = { ...state.lessons, ...result.lessons };
      engineResolution = result.resolution; retrievalReady = result.retrievalReady;
      selected = candidates.find(fact => fact.id === result.resolution.selected_fact_id) || null;
    }
    if (!services && rememberAuthority && (!state.lesson || state.lesson.scope !== authorityScope(selected) || state.lesson.source !== selected?.source)) {
      state.policyVersions ||= [{ version: state.policy, lesson: state.lesson }];
      state.lesson = { id: id('lesson'), text: authorityLabel(previousTurn, selected).replace(/^Remember /, ''), project: 'Atlas launch', scope: authorityScope(selected), source: selected.source, reason: prompt };
      state.lessons = { ...state.lessons, [state.lesson.id]: state.lesson };
      state.policy += 1;
      state.policyVersions.push({ version: state.policy, lesson: structuredClone(state.lesson) });
    }
    if (conflictReview) {
      state.conflictReviews ||= [];
      state.conflictReviews.push({ conflictTurnId: reviewedTurn.id, resolutionTurnId: turnId, chatId, selectedFactId: selected?.id || null, reason: conflictReview.reason || '', source, author, rememberedAuthority: Boolean(rememberAuthority), at: new Date().toISOString() });
    }
    state.turns.push({ id: turnId, ...(chatId ? { chatId } : {}), prompt, source, author, attachments, status: 'recorded', answer: null });
    emit('write', 'Writing the human answer', rememberAuthority ? `Save the answer and scoped authority lesson under policy v${state.policy}.` : 'Save the answer for this conflict without changing project authority.');
    await write();
    emit('saved', services ? 'Human answer confirmed' : 'Human answer saved locally', 'Original claims, decisions, and earlier policies remain in history.', { count: state.facts.length });
    emit('recall', 'Read the affected facts', `${candidates.length} existing claims about ${subject}.`);
    emit('policy', 'Apply the human answer', rememberAuthority ? authorityLabel(previousTurn, selected) : 'This answer applies only to the reviewed conflict; project authority is unchanged.');
    answer = selected ? `Using **${selected.value}** from ${sourceLabel(selected)} for ${subject}. ${rememberAuthority ? `${selected.source}’s authority for ${selected.scope === 'other' ? selected.subject : selected.scope} is saved within this project under policy v${state.policy}.` : 'This choice applies to this conflict only.'} The original claims and decision are preserved.` : 'Left unresolved. Both claims are preserved; more information is needed before choosing one.';
    if (services && rememberAuthority) answer += retrievalReady ? ' Retrieval readiness was confirmed.' : ' The lesson is saved; vector indexing is still pending.';
    if (conflictReview?.reason) answer += `\n\nYour context: ${conflictReview.reason}`;
  } else {
    lookup = memoryReview && savedAnswerLookup(state, prompt, attachments);
    if (memoryReview) state.turns.push({ id: turnId, ...(chatId ? { chatId } : {}), prompt, source, author, attachments, status: 'recorded', answer: null });
    if (attachments.length) {
      emit('write', 'Saving the original memo', 'Retain the uploaded text, filename, source, and upload time before extracting facts.', { entity: 'document' });
      for (const file of attachments) {
        const document = { id: id('document'), name: file.name, text: file.text, source, author, uploadedAt: new Date().toISOString(), example: Boolean(file.example) };
        state.documents.push(document); newDocuments.push(document);
      }
      await write();
      emit('saved', services ? 'Memo save confirmed' : 'Memo saved locally', 'The original document is retained as evidence, not just the extracted date.', { entity: 'document' });
      if (!memoryReview) emit('extract', 'Read the memo for factual claims', 'Limited local parsing; semantic review is disabled.');
      if (!memoryReview) incoming = attachments.flatMap(file => extractFacts(file.text, source).map(fact => ({ ...fact, document: file.name, sourceDate: new Date().toISOString().slice(0, 10) })));
    } else if (!memoryReview) incoming = extractFacts(prompt, source);
    if (memoryReview) {
      if (!attachments.length) {
        emit('write', 'Recording the message', 'Save the submitted message before reviewing its claims.');
        await write();
        emit('saved', 'Message save confirmed', 'The backend acknowledged this message.');
      }
      if (authorityRequest) {
        analysis = { status: 'authority-request', claims: [], relations: [], relevantFactIds: authorityRequest.candidates.map(f => f.id) };
        emit('recall', 'Reopen the recorded authority question', 'Retain the ownership statement as proposed context. A choice and optional scoped lesson still require an explicit answer.');
      } else if (lookup) {
        analysis = { status: 'saved-answer', claims: [], relations: [], relevantFactIds: lookup.candidates.map(f => f.id) };
        emit('recall', 'Read the saved human answer', 'An exact lookup uses the recorded answer without another model call.');
      } else {
        if (!generate) throw new Error('The memory reviewer needs a connected model.');
        const event = emit('generate', 'Review the request and propose memory evidence', 'One constrained model task extracts grounded claims and checks their meaning; the engine decides afterward.');
        modelResult = await generate({ prompt, source, author, state: { ...state, turns: state.turns.filter(turn => !chatId || turn.chatId === chatId) }, attachments, memoryReview: true });
        recordModel(event, modelResult);
        analysis = modelResult.memoryAnalysis || { status: 'unavailable', claims: [], relations: [], relevantFactIds: [] };
        emit('extract', analysis.status === 'validated' ? 'Validate proposed claims and relationships' : 'Memory check incomplete',
          `${analysis.claims.length} source-backed claims; ${analysis.relations.length} checked relationships. ${analysis.coverage?.omitted.length || 0} likely assertions not covered.`,
          { analysis: { status: analysis.status, rejected: analysis.rejected, coverage: analysis.coverage }, status: analysis.status === 'validated' ? 'succeeded' : 'unavailable' });
        incoming = materializeClaims(analysis, { turnId, source, author, documents: newDocuments });
      }
    }
    incoming = incoming.map(fact => ({ ...fact, ...(fact.source === source && author && !fact.provenance?.reportedSource ? { author } : {}) }));
    const before = state.facts.length;
    state.facts.push(...incoming);
    if (!incoming.length && !attachments.length && !/[?]|^\s*(what|when|why|how|summari[sz]e|list|show|tell|can|could|write|draft|create|review|explain|translate)\b/i.test(prompt)) state.notes.push({ id: id('note'), text: prompt, source });
    if (!memoryReview || incoming.length) emit('write', incoming.length ? 'Saving the incoming fact' : 'Recording the message', incoming.length ? `${incoming.map(fact => `${fact.source}: ${fact.value}`).join(' · ')} → project fact store. Existing facts are retained.` : 'Keep the message in the session; do not treat a question as a fact.', { entity: attachments.length && incoming.length ? 'extracted-facts' : 'message' });
    // The message is written before lookup, then completed with its response below.
    if (!memoryReview) state.turns.push({ id: turnId, ...(chatId ? { chatId } : {}), prompt, source, author, attachments, status: 'recorded', answer: null });
    if (!memoryReview || incoming.length) await write();
    if (!memoryReview || incoming.length) emit('saved', services ? 'Record save confirmed' : incoming.length ? 'Fact saved locally' : 'Message saved locally', incoming.length ? `${before} → ${state.facts.length} retained facts. The new claim now has a record ID.` : services ? 'The backend acknowledged this message.' : 'The message is recorded in this browser.', { count: state.facts.length, factIds: incoming.map(fact => fact.id) });
    // Only current claims or an explicitly named subject select evidence. A
    // generic mention of “ready” or one shared word must not select launch.
    const subjects = [...new Set(incoming.map(fact => fact.subject))];
    if (!subjects.length && !attachments.length) {
      const mentioned = [...new Set(state.facts.map(fact => fact.subject))].filter(value => mentionsSubject(prompt, value));
      subjects.push(...mentioned.filter(value => !mentioned.some(other => other !== value && other.includes(value))));
    }
    subject = subjects.find(value => new Set(state.facts.filter(fact => fact.subject === value).map(fact => fact.value.toLowerCase())).size > 1) || subjects[0];
    candidates = subject ? state.facts.filter(fact => fact.subject === subject) : [];
    if (memoryReview) {
      evidenceGroups = authorityRequest ? [{ subject: authorityRequest.subject, candidates: authorityRequest.candidates, conflict: true, relations: [] }] : memoryEvidence(state, incoming, analysis);
      const first = evidenceGroups[0];
      subject = first?.subject; candidates = first?.candidates || [];
    }
    emit('recall', 'Look up existing project memory', candidates.length ? `${candidates.length} ${subject} claims found. ${candidates.filter(fact => fact.seeded).map(fact => `Earlier evidence: ${fact.document || 'Engineering update'}${fact.sourceDate ? ` · ${fact.sourceDate}` : ''}.`).join(' ')}` : `${state.facts.length} facts available; no matching structured evidence found.`);
    conflict = memoryReview ? Boolean(evidenceGroups[0]?.conflict) : new Set(candidates.map(fact => fact.value.toLowerCase())).size > 1;
    emit('compare', conflict ? 'A conflict is present' : candidates.length ? 'Check the evidence' : 'No supported answer in memory', candidates.length ? candidates.map(fact => `${fact.source}: ${fact.value}`).join(' · ') : 'A connected model is needed to interpret this request beyond local project facts.');
    const inScope = candidates.length && candidates.every(fact => fact.scope === 'launch readiness');
    const previousReview = !authorityRequest && (lookup?.review || (conflict && matchingConflictReview(state, candidates)));
    savedReview = previousReview || null;
    const previousDecision = previous.turns.flatMap(turn => [turn, ...(turn.conflicts || [])]).reverse().find(turn => turn.subject === subject && turn.selected && (turn.correction || turn.reviewedConflictId || turn.applied));
    requiresConfirmation = Boolean(authorityRequest || conflict && previousDecision && (explicitRevision(prompt) || evidenceGroups[0]?.revision)
      && incoming.some(fact => fact.subject === subject && claimValue(fact) !== claimValue(previousDecision.selected)));
    if (previousReview) {
      selected = candidates.find(fact => fact.id === previousReview.selectedFactId) || null;
    } else if (services && conflict) {
      const result = await services.resolve(memoryReview && evidenceGroups.filter(g => g.conflict).length > 1 ? `${turnId}:conflict:1` : turnId, candidates, authorityScope(candidates[0]));
      trace.push(...result.trace.map(event => memoryReview && evidenceGroups.filter(g => g.conflict).length > 1 ? { ...event, conflictGroupId: `${turnId}:conflict:1` } : event)); state.policy = result.policy; state.lesson = result.lesson; state.lessons = { ...state.lessons, ...result.lessons };
      engineResolution = result.resolution;
      selected = candidates.find(fact => fact.id === engineResolution.selected_fact_id) || null;
      applied = engineResolution.applied_precedent_id;
    } else if (!services && conflict && Object.values(state.lessons || (state.lesson ? { [state.lesson.id]: state.lesson } : {})).some(lesson => lesson.scope === authorityScope(candidates[0]) || (lesson.scope === 'launch readiness' && inScope))) {
      const lesson = Object.values(state.lessons || { [state.lesson.id]: state.lesson }).filter(lesson => lesson.scope === authorityScope(candidates[0]) || (lesson.scope === 'launch readiness' && inScope)).at(-1);
      selected = [...candidates].reverse().find(fact => fact.source === (lesson.source || 'Engineering')) || null;
      applied = selected ? lesson.id : null;
    } else if (inScope && conflict) {
      selected = [...candidates].reverse().find(fact => fact.source === 'Marketing') || null;
    } else if (candidates.length && !conflict) selected = candidates.at(-1);
    if (!engineResolution) emit('policy', previousReview ? 'Use the saved human answer' : applied ? 'Scoped precedent applied' : state.lesson && conflict && !inScope ? 'Launch lesson is out of scope' : 'Evaluate the current policy', previousReview ? 'The same evidence was already reviewed; retain the saved human choice without asking again.' : applied ? 'Same project + launch readiness. Engineering’s stored claim is selected.' : conflict && inScope ? 'Policy v1 prioritizes Marketing. No precedent applied.' : conflict ? 'No authority rule supports a choice here. Ask a human.' : 'Do not invent conflicts or apply an unnecessary precedent.', { applied, ...(previousReview ? { humanReview: previousReview.resolutionTurnId } : {}) });
    const saved = incoming.length ? `I saved ${incoming.map(fact => `${fact.source}’s ${fact.value} claim`).join(' and ')}. ` : '';
    if (selected) {
      answer = `${saved}${conflict ? `It conflicts with ${candidates.filter(fact => fact.id !== selected.id).map(fact => `${fact.source}’s ${fact.value}`).join(' and ')} in memory. ` : ''}${subject === 'launch' || subject === 'next release' ? `The ${subject} date is ${selected.value}.` : `${subject}: ${selected.value}.`} ${previousReview ? 'I retained your saved answer for these claims.' : applied ? `I applied the saved scoped lesson under policy v${state.policy}.` : conflict ? engineResolution ? engineResolution.explanation : 'The starting policy gives Marketing priority. Both claims remain saved.' : 'This is the current recorded information.'}`;
    } else if (conflict) answer = `${saved}The stored claims disagree: ${candidates.map(fact => `${fact.source} says ${fact.value}`).join('; ')}. I need a human to identify the right authority. ${state.lesson ? 'The launch-readiness lesson does not settle this question.' : 'No applicable rule establishes a winner.'}`;
    else if (/summari[sz]e|list|show.*(?:facts|memory)/i.test(prompt)) answer = `Here is the stored project memory:\n${state.facts.map(fact => `• ${fact.source}: ${fact.subject} — ${fact.value}${fact.seeded ? ' (seeded example)' : ''}`).join('\n')}${state.notes.length ? `\n${state.notes.length} unstructured note(s) are also retained.` : ''}`;
    else answer = `${state.notes.some(note => note.text === prompt) ? 'I saved your note locally. ' : 'I recorded your question. '}I don’t have enough structured project evidence to answer it. This prototype accepts any prompt, but a general AI model is not connected yet. You can add facts, ask about stored facts, or request a memory summary.`;
  }

  if (memoryReview && evidenceGroups.filter(group => group.conflict).length > 1) {
    conflictRecords.push({ id: `${turnId}:conflict:1`, subject, candidates, selected, applied, conflict: true, requiresConfirmation,
      engineResolution, policy: state.policy, lesson: state.lessons?.[applied] || state.lesson,
      conflictQuestion: savedReview || (applied && !requiresConfirmation) ? null : fallbackConflictQuestion(subject, candidates) });
    for (const [index, group] of evidenceGroups.filter(group => group.conflict).slice(1).entries()) {
      const groupId = `${turnId}:conflict:${index + 2}`;
      const reviewed = matchingConflictReview(state, group.candidates);
      let result = null;
      if (!reviewed && services) {
        result = await services.resolve(groupId, group.candidates, authorityScope(group.candidates[0]));
        trace.push(...result.trace.map(event => ({ ...event, conflictGroupId: groupId })));
        state.policy = result.policy; state.lessons = { ...state.lessons, ...result.lessons };
      }
      const choice = group.candidates.find(fact => fact.id === (reviewed?.selectedFactId || result?.resolution.selected_fact_id)) || null;
      const precedent = result?.resolution.applied_precedent_id || null;
      const previousChoice = previous.turns.flatMap(turn => [turn, ...(turn.conflicts || [])]).reverse().find(turn => turn.subject === group.subject && turn.selected && (turn.correction || turn.applied));
      const confirm = Boolean(previousChoice && (group.revision || explicitRevision(prompt)) && incoming.some(f => f.subject === group.subject && claimValue(f) !== claimValue(previousChoice.selected)));
      conflictRecords.push({ id: groupId, ...group, selected: choice, applied: precedent, requiresConfirmation: confirm,
        engineResolution: result?.resolution || null, policy: state.policy, lesson: state.lessons?.[precedent] || null,
        conflictQuestion: reviewed || (precedent && !confirm) ? null : fallbackConflictQuestion(group.subject, group.candidates) });
    }
  }

  const reviewCandidates = conflict && (requiresConfirmation || (!applied && !matchingConflictReview(state, candidates))) ? candidates : [];
  const decisionContext = { status: requiresConfirmation ? 'confirmation-required' : savedReview ? 'human-confirmed' : applied ? 'policy-applied' : 'provisional', selectedFactId: selected?.id || null, humanReviewId: savedReview?.resolutionTurnId || null };
  let conflictQuestion = fallbackConflictQuestion(subject, reviewCandidates);
  if (generate && !conflictReview && !memoryReview) {
    const requestEvent = emit('generate', 'Send context to the selected model', 'Pass the prompt, stored evidence, current policy, and conversation to the connected provider.');
    modelResult = await generate({ prompt, source, author, state: { ...state, turns: state.turns.filter(turn => !chatId || turn.chatId === chatId) }, draft: answer, engineResolution, selected, conflict, attachments, decisionContext, reviewContext: conflictQuestion ? { subject, candidates: reviewCandidates, requiresConfirmation } : null });
    answer = modelResult.answer;
    if (Object.hasOwn(modelResult, 'conflictQuestion')) {
      const proposed = validateConflictQuestion(modelResult.conflictQuestion, reviewCandidates);
      conflictQuestion = requiresConfirmation ? proposed || conflictQuestion : proposed;
    }
    recordModel(requestEvent, modelResult);
  }
  if (memoryReview && !conflictReview) {
    const summary = authorityRequest ? `Choose the recorded claim to use for ${subject} below. I added your ownership statement as context. Submit an answer to save a decision; select Remember authority only if you want a reusable lesson. No choice or policy change has been saved.` : (conflict || savedReview) ? decisionSummary({ subject, candidates, selected, applied, policy: state.policy, requiresConfirmation, savedReview, engineResolution }) : '';
    // The reviewer runs before resolution. Its free prose cannot overrule the
    // engine or a human answer; memory findings always come from these records.
    const comments = (modelResult?.reviewNotes || []).map(note => note.comment).join(' ');
    const task = reviewTask(prompt, attachments);
    const transformed = task.sourceTask && modelResult?.answer?.trim();
    const prose = lookup ? '' : task.sourceTask ? (transformed ? `**${task.label}:**\n\n${transformed}` : 'The requested text could not be produced. Please try again.')
      : (conflict || savedReview || task.kind === 'review' || ['partial', 'unavailable'].includes(analysis.status)) ? comments : modelResult?.answer;
    const factual = !summary && candidates.length && selected && !attachments.length ? `Recorded ${subject}: **${selected.value}** (${sourceLabel(selected)}).` : '';
    answer = (task.sourceTask ? [prose, summary] : [summary || factual, prose]).filter(Boolean).join('\n\n')
      || (incoming.length ? 'I saved the source-backed project claims.' : analysis.status === 'unavailable' ? 'Your original message and documents are retained.' : attachments.length ? 'I reviewed the document; no supported memory conflict was detected in this check.' : 'No saved answer is available.');
    if (analysis.status === 'unavailable' || analysis.status === 'partial') {
      const omitted = analysis.coverage?.omitted || [];
      const excerpts = omitted.slice(0, 3).map(item => `> ${item.quote.replaceAll('\n', ' ')}`).join('\n\n');
      answer += `\n\n${omitted.length || analysis.status === 'partial' ? 'Memory checking was incomplete: some possible claims were not validated.' : 'Memory checking was unavailable for this reply.'} ${incoming.length ? 'Only the validated claims were saved.' : 'No new facts were saved.'}${excerpts ? `\n\nNot validated:\n\n${excerpts}\n\nPlease clarify these claims with an explicit source, subject, and value, then retry the memory check.` : ' Please retry the memory check.'}`;
    }
    if (conflictRecords.length) answer += '\n\n' + conflictRecords.slice(1).map(group => decisionSummary({ ...group, savedReview: matchingConflictReview(state, group.candidates) })).join('\n\n');
  }
  emit('resolve', selected ? `Selected ${selected.value}` : reviewedTurn ? 'Left unresolved' : correction ? 'Lesson recorded' : conflict ? 'Human input needed' : 'Answer prepared', answer);
  const turn = { id: turnId, ...(chatId ? { chatId } : {}), prompt, source, author, attachments, answer, subject, incoming, candidates, selected, applied, conflict, conflictQuestion, requiresConfirmation, correction, ...(authorityRequest ? {authorityRequest: {conflictTurnId:authorityRequest.conflictTurnId, reason:authorityRequest.reason}} : {}), ...(reviewedTurn ? { reviewedConflictId: reviewedTurn.id } : {}), policy: state.policy, lesson: state.lessons?.[applied] || state.lesson, ...(memoryReview ? { memoryAnalysis: analysis, evidenceGroups, ...(conflictRecords.length ? { conflicts: conflictRecords } : {}) } : {}), factCount: state.facts.length, engineResolution, retrievalReady, serviceMode: services?.storage || 'browser', model: modelResult?.model || (services ? 'Python engine' : 'Local rules'), provider: modelResult?.provider || 'local', status: 'completed', trace: [] };
  const savedEntity = isDecisionTurn(turn) ? 'decision' : 'response';
  emit('commit', savedEntity === 'decision' ? 'Save the decision and its evidence' : 'Save the conversation response', `Append the answer, supporting IDs, applied precedent, and policy v${state.policy}.`);
  const placeholder = state.turns.findIndex(item => item.id === turnId);
  if (placeholder >= 0) state.turns[placeholder] = turn; else state.turns.push(turn);
  await write();
  emit('committed', savedEntity === 'decision' ? 'Decision saved locally' : 'Response saved locally', 'The response and its evidence are retained across reloads in this browser.', { entity: savedEntity });
  emit('respond', 'Return the answer', 'The terminal response is ready. Replay visualizes this recorded trace without writing again.');
  turn.trace = [...trace];
  turn.timing = { elapsedMs: Math.round(performance.now() - startedMs), modelMs: modelResult?.modelTrace?.response?.elapsedMs || 0, modelCalls: modelResult ? 1 : 0 };
  if (services) await services.save(structuredClone(state), 'Retain completed trace', null);
  await persist(structuredClone(state));
  return { state, turn };
}
