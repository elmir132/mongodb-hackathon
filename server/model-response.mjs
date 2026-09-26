import { validateConflictQuestion } from '../src/conflict-review.js';

// These comments are deliberately separate from the authoritative memory
// outcome. A model-generated policy/date comparison must never be displayed
// beside a contradictory engine decision.
export function validateReviewNotes(notes, context, analysis) {
  if (!Array.isArray(notes)) return [];
  const blocked = /\b(?:conflict|disagree|memory|policy|precedent|authority|decision|selected|chosen|resolved|saved|confirm|reconcile|approve|launch|release|budget|date|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|[$€£\d]/i;
  const terms = [...(context?.facts || []), ...(analysis?.claims || [])].flatMap(f => [f.subject, f.source, f.value]).filter(Boolean).map(s => s.toLowerCase());
  return notes.slice(0, 2).filter(note => {
    const source = context?.sources.find(source => source.ref === note?.sourceRef);
    return typeof note?.quote === 'string' && note.quote.length > 4 && note.quote.length <= 400 && source?.text.includes(note.quote)
      && typeof note.comment === 'string' && note.comment.trim() && note.comment.length <= 240
      && !blocked.test(note.comment) && !terms.some(term => note.comment.toLowerCase().includes(term));
  }).map(note => ({ sourceRef: note.sourceRef, quote: note.quote, comment: note.comment.trim() }));
}

export function parseModelResponse(text, reviewContext) {
  let result;
  try { result = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')); }
  catch { return { answer: text.trim(), conflictQuestion: null }; }
  if (typeof result?.answer !== 'string' || !result.answer.trim()) throw new Error('The model returned no usable answer. Try again.');
  return { answer: result.answer.trim(), conflictQuestion: validateConflictQuestion(result.conflictQuestion, reviewContext?.candidates) };
}
