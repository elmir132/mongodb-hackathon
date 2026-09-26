import { validateConflictQuestion } from '../src/conflict-review.js';

export function parseModelResponse(text, reviewContext) {
  let result;
  try { result = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')); }
  catch { return { answer: text.trim(), conflictQuestion: null }; }
  if (typeof result?.answer !== 'string' || !result.answer.trim()) throw new Error('The model returned no usable answer. Try again.');
  return { answer: result.answer.trim(), conflictQuestion: validateConflictQuestion(result.conflictQuestion, reviewContext?.candidates) };
}
