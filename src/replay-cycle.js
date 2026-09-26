import { buildReplaySteps, compileReplayMotion } from './replay-model.js';
import { turnsForChat } from './conversations.js';
import { findConflictTurn, needsConflictReview } from './conflict-review.js';

const isComplete = turn => Boolean(turn?.answer && turn.status === 'completed'
  && turn.trace?.some(event => event.stage === 'committed')
  && turn.trace.at(-1)?.stage === 'respond');

// The latest cycle owns one replay action, rather than each intermediate reply.
export function completedReplayCycle(state, chatId = state.activeChatId) {
  const turns = turnsForChat(state, chatId);
  const last = turns.at(-1);
  if (!isComplete(last) || needsConflictReview(state, last)) return null;
  let original;
  if (last.reviewedConflictId) {
    const reviewed = findConflictTurn(state, last.reviewedConflictId);
    original = turns.find(turn => turn.id === (reviewed?.parentTurnId || last.reviewedConflictId));
    const review = state.conflictReviews?.find(item => item.resolutionTurnId === last.id && item.conflictTurnId === reviewed?.id);
    if (!review || !isComplete(original)) return null;
    if (original.conflicts?.length) {
      if (needsConflictReview(state, original)) return null;
      const ids = new Set(original.conflicts.map(group => group.id));
      const answers = turns.filter(turn => ids.has(turn.reviewedConflictId));
      if (answers.some(turn => !isComplete(turn))) return null;
      return { id: last.id, turns: [original, ...answers] };
    }
  } else if (last.correction) {
    // Compatibility with the earlier typed-correction flow.
    original = turns.slice(0, -1).reverse().find(turn => turn.conflict && turn.subject === last.subject);
    if (original && !isComplete(original)) return null;
  }
  return { id: last.id, turns: original ? [original, last] : [last] };
}

export function buildCycleReplaySteps(cycle) {
  // Keep each event's original turn and local trace index so evidence, policy,
  // provider receipts and save confirmations match that phase of the cycle.
  return compileReplayMotion(cycle?.turns.flatMap(turn => buildReplaySteps(turn).map(step => {
    const group = turn.conflicts?.find(item => item.id === step.event.conflictGroupId);
    return { ...step, turn: group ? { ...turn, ...group } : turn };
  })) || []);
}

// Service history belongs to the whole replay, while decisions and transcript
// remain tied to each step's original turn. Gate receipts on packet arrival.
export function cycleServiceRecording(steps, cursor, arrived) {
  const trace = steps.flatMap(step => step.events);
  const visibleCount = steps.slice(0, cursor + (arrived ? 1 : 0))
    .reduce((count, step) => count + step.events.length, 0);
  return { trace, evidenceCursor: visibleCount - 1,
    serviceMode: steps.length && steps.every(step => step.turn?.serviceMode === 'browser'
      || (!step.turn?.serviceMode && !step.turn?.trace.some(event => event.service && event.service !== 'model'))) ? 'browser' : 'connected' };
}
