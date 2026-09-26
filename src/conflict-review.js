import { canonicalFact, memoryValueKey } from '../server/memory-analysis.mjs';

// Review groups stay attached to one response; synthetic records never become
// transcript messages and retain stable backend conflict IDs.
export function findConflictTurn(state, id) {
  const direct = state.turns.find(turn => turn.id === id);
  if (direct) return direct;
  for (const parent of state.turns) {
    const group = parent.conflicts?.find(item => item.id === id);
    if (group) return { ...parent, ...group, conflicts: undefined, parentTurnId: parent.id };
  }
  return null;
}

export function matchingConflictReview(state, candidates = []) {
  if (!candidates.length) return null;
  const candidateIds = new Set(candidates.map(fact => fact.id));
  const evidenceKey = fact => {
    const normalized = canonicalFact(fact);
    return JSON.stringify([normalized.subject, normalized.attribute, normalized.scope, String(fact.source || '').trim().toLowerCase(), fact.validFrom || null, fact.validTo || null, memoryValueKey(normalized)]);
  };
  return [...(state.conflictReviews || [])].reverse().find(review => {
    const original = findConflictTurn(state, review.conflictTurnId);
    const prior = original?.candidates || [];
    if (!prior.length || !prior.every(fact => candidateIds.has(fact.id))) return false;
    const priorIds = new Set(prior.map(fact => fact.id));
    const keys = new Set(prior.map(evidenceKey));
    return candidates.every(fact => priorIds.has(fact.id) || keys.has(evidenceKey(fact))); 
  }) || null;
}

export function needsConflictReview(state, turn) {
  if (turn?.conflicts?.length) return turn.conflicts.some(group => needsConflictReview(state, findConflictTurn(state, group.id)));
  if (!turn?.answer || !turn.conflict || turn.reviewedConflictId || (turn.applied && !turn.requiresConfirmation)) return false;
  if (Object.hasOwn(turn, 'conflictQuestion') && !turn.conflictQuestion) return false;
  if (state.conflictReviews?.some(review => review.conflictTurnId === turn.id) || (!turn.authorityRequest && matchingConflictReview(state, turn.candidates))) return false;
  const index = state.turns.findIndex(item => item.id === (turn.parentTurnId || turn.id));
  return !state.turns.slice(index + 1).some(item => item.correction && !item.reviewedConflictId && item.chatId === turn.chatId && item.subject === turn.subject);
}

export function currentConflictQuestion(state, chatId, dismissed = []) {
  const latest = state.turns.filter(turn => turn.chatId === chatId).at(-1);
  if (!latest) return null;
  const reviewed = latest.reviewedConflictId && findConflictTurn(state, latest.reviewedConflictId);
  const parent = reviewed?.parentTurnId ? findConflictTurn(state, reviewed.parentTurnId) : latest;
  if (dismissed.includes(parent.id)) return null;
  const pending = parent.conflicts?.length
    ? parent.conflicts.map(group => findConflictTurn(state, group.id))
    : [parent];
  return pending.find(turn => !dismissed.includes(turn.id) && needsConflictReview(state, turn)) || null;
}

export function fallbackConflictQuestion(subject, candidates = []) {
  const values = [...new Set(candidates.map(fact => fact.value))];
  if (values.length < 2) return null;
  return { question: `For ${subject}, should I use ${values.slice(0, 3).join(' or ')}${values.length > 3 ? ', or another recorded claim' : ''}?`, factIds: candidates.map(fact => fact.id) };
}

// Model wording can only refer to the candidate evidence actually supplied.
export function validateConflictQuestion(question, candidates = []) {
  if (!question || typeof question.question !== 'string' || !question.question.trim() || question.question.length > 300 || !Array.isArray(question.factIds)) return null;
  const ids = new Set(question.factIds);
  if (ids.size !== candidates.length || !candidates.every(fact => ids.has(fact.id)) || new Set(candidates.map(fact => fact.value.toLowerCase())).size < 2) return null;
  return { question: question.question.trim(), factIds: candidates.map(fact => fact.id) };
}

export const normalizeAuthorityKey = value => String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
const genericScopes = new Set(['', 'other', 'general', 'project', 'unknown']);
export const authorityAttribute = fact => {
  const subject = normalizeAuthorityKey(fact?.subject);
  const fallback = ['launch', 'next-release'].includes(subject) || normalizeAuthorityKey(fact?.scope) === 'launch-readiness' ? 'date' : /\bbudget\b/.test(subject) ? 'budget' : /\bowner(?:ship)?\b/.test(subject) ? 'owner' : /\bstatus\b/.test(subject) ? 'status' : 'value';
  return normalizeAuthorityKey(fact?.attribute || fact?.predicate || fallback);
};

// A generic domain is never permission to teach an authority for every claim.
export function authorityScope(fact) {
  if (!fact) return null;
  const scope = normalizeAuthorityKey(fact.scope);
  const subject = normalizeAuthorityKey(fact.subject);
  const attribute = authorityAttribute(fact);
  if (genericScopes.has(scope)) return subject ? `claim:${subject}:${attribute}` : null;
  return attribute === 'value' || scope === attribute || scope.endsWith(`:${attribute}`) || (scope === 'launch-readiness' && attribute === 'date') ? scope : `${scope}:${attribute}`;
}

export function authorityLabel(turn, fact) {
  const scope = authorityScope(fact);
  const description = scope?.startsWith('claim:')
    ? `${fact.subject}${['value', normalizeAuthorityKey(fact.subject)].includes(authorityAttribute(fact)) ? '' : ` ${authorityAttribute(fact).replaceAll('-', ' ')}`}`
    : scope?.replaceAll('-', ' ').replaceAll(':', ' · ');
  return `Remember ${fact?.source}’s authority for ${description} in this project.`;
}

export function authorityCoverage(fact) {
  const scope = authorityScope(fact);
  const specific = scope?.startsWith('claim:') || normalizeAuthorityKey(fact?.scope) === normalizeAuthorityKey(fact?.subject);
  return specific ? `Limited to ${fact.subject}; other subjects will still need review.`
    : `Applies to other ${String(fact?.scope || '').replaceAll('-', ' ')} decisions about ${authorityAttribute(fact).replaceAll('-', ' ')} in this project.`;
}

export function canRememberAuthority(turn, fact) {
  const candidates = turn?.candidates || [];
  const scope = authorityScope(fact);
  return Boolean(fact?.id && fact.source?.trim() && !['unknown', 'you'].includes(fact.source.trim().toLowerCase())
    && candidates.some(item => item.id === fact.id) && candidates.length >= 2 && scope
    && candidates.every(item => authorityScope(item) === scope && authorityAttribute(item) === authorityAttribute(fact))
    && new Set(candidates.map(item => item.source?.trim().toLowerCase())).size > 1);
}

// A narrow explicit authority statement is a request to review recorded
// evidence, never consent to save a choice or a reusable policy.
export function authorityReviewRequest(state, prompt, chatId, attachments = []) {
  if (attachments.length) return null;
  const match = /^\s*([A-Za-z][A-Za-z0-9 &-]{0,59}?)\s+(?:owns|is responsible for)\s+(.+?)\s+for this project[.!]?\s*$/i.exec(prompt);
  if (!match) return null;
  const source = normalizeAuthorityKey(match[1]), scope = normalizeAuthorityKey(match[2]);
  const turns = state.turns.filter(turn => turn.chatId === chatId && turn.answer && turn.status === 'completed');
  const groups = turns.flatMap(turn => turn.conflicts?.length ? turn.conflicts.map(group => findConflictTurn(state, group.id)) : [turn]);
  const matches = groups.filter(turn => turn.conflict && turn.candidates?.some(fact =>
    normalizeAuthorityKey(fact.source) === source && canRememberAuthority(turn, fact)
    && [normalizeAuthorityKey(fact.scope), normalizeAuthorityKey(fact.subject), normalizeAuthorityKey(`${fact.subject} ${authorityAttribute(fact)}`)] .includes(scope)));
  // A domain shared by several different subjects is ambiguous. Do not guess.
  if (new Set(matches.map(turn => `${turn.subject}|${authorityScope(turn.candidates[0])}`)).size !== 1) return null;
  const turn = matches.at(-1);
  return turn ? { conflictTurnId: turn.id, reason: prompt.trim(), candidates: turn.candidates, subject: turn.subject } : null;
}
