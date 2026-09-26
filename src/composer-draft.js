// A failed reply may restore its sent draft only if the user has not started another.
export function recoverDraftAfterFailure(current, submitted) {
  return current.input.length || current.attachments.length ? current : submitted;
}
