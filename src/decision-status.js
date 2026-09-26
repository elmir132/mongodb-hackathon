// Saving a conversation response is not itself a project decision. The local
// adapter records decisions for explicit human answers/lessons and for a
// conflict resolved by an applied lesson. A provisional choice awaiting review
// and a factual lookup do not qualify.
export function isDecisionTurn(turn) {
  return Boolean(turn?.correction || turn?.reviewedConflictId
    || (turn?.conflict && turn?.selected && turn?.applied && !turn?.requiresConfirmation));
}

export function hasSavedDecision(turn, traceIndex) {
  return Boolean(isDecisionTurn(turn) && turn.answer && turn.status === 'completed'
    && turn.trace?.slice(0, traceIndex === undefined ? undefined : traceIndex + 1)
      .some(event => event.stage === 'committed'));
}
