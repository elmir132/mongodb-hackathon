import { memoryAnalysisContext } from './memory-analysis.mjs';
import { reviewTask } from './review-task.mjs';
// The context and its receipt are built together, before transport credentials
// enter the request. Never include headers, API keys, endpoint URLs or CLI logs.
export function prepareModelContext({ prompt, source, author, state, draft, selected, conflict, attachments = [], reviewContext = null, engineResolution = null, decisionContext = null, memoryReview = false }) {
  const history = state.turns.filter(turn => turn.answer).slice(-8);
  const context = { prompt, source, author, attachments, project: 'Atlas launch', reviewContext, decisionContext, selectedFact: selected, unresolvedConflict: Boolean(conflict && !selected), localEngineDraft: draft, ...(engineResolution ? { engineResolution } : {}), facts: state.facts.slice(-50), notes: state.notes.slice(-20), policy: state.policy, lesson: state.lesson, conversation: history.map(turn => ({ user: turn.prompt, assistant: turn.answer })) };
  const analysisContext = memoryReview ? memoryAnalysisContext({ prompt, source, author, state, attachments }) : null;
  // The full source text appears once. Avoid sending the same memo as both
  // attachments and analysis sources, or the entire saved replay history.
  const sent = memoryReview ? { task: 'memory-review', currentRequest: { sourceRef: 'prompt', ...reviewTask(prompt, attachments) }, memoryInput: analysisContext,
    conversation: context.conversation.slice(-4), policyVersion: state.policy,
    savedDecisions: state.turns.flatMap(turn => [turn, ...(turn.conflicts || [])]).filter(turn => turn.reviewedConflictId || turn.applied).slice(-8)
      .map(turn => ({ subject: turn.subject, selectedFactId: turn.selected?.id || null, appliedPrecedentId: turn.applied || null })) } : context;
  const content = JSON.stringify(sent);
  const receipt = {
    version: 1, prompt, source, author: author || null,
    attachments: attachments.map(file => ({ name: file.name, characters: Array.from(file.text || '').length })),
    factIds: (analysisContext?.facts || context.facts).map(fact => fact.id), noteIds: memoryReview ? [] : context.notes.map(note => note.id),
    history: (memoryReview ? history.slice(-4) : history).map(turn => ({ id: turn.id, prompt: turn.prompt })),
    policyVersion: context.policy, lessonId: context.lesson?.id || null,
    selectedFactId: selected?.id || null, unresolvedConflict: context.unresolvedConflict,
    reviewFactIds: reviewContext?.candidates.map(fact => fact.id) || [],
    contextBytes: Buffer.byteLength(content), instructions: memoryReview ? 'Memory reviewer: grounded claims and semantic relations; provisional prose; no resolution or tools' : 'Chronicle review instructions; JSON answer and optional grounded conflict question; tools disabled',
    ...(memoryReview ? { task: 'memory-review' } : {}),
  };
  return { content, receipt, analysisContext };
}

export function modelReceipt(request, { provider, model, transport, startedAt, startedMs, answer }) {
  return {
    request: { ...request, provider, model, transport, startedAt },
    response: { completedAt: new Date().toISOString(), elapsedMs: Math.max(0, Math.round(performance.now() - startedMs)), characters: Array.from(answer).length },
  };
}
