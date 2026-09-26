import { canonicalFact, memoryValueKey, comparableMemoryFacts } from '../server/memory-analysis.mjs';
import { authorityScope, matchingConflictReview } from './conflict-review.js';

const key = fact => {
  const normalized = canonicalFact(fact);
  return `${normalized.subject}|${normalized.attribute}|${authorityScope(normalized)}`;
};
const overlaps = (a, b) => (!a.validTo || !b.validFrom || a.validTo >= b.validFrom)
  && (!b.validTo || !a.validFrom || b.validTo >= a.validFrom);
const value = fact => memoryValueKey(canonicalFact(fact));

// A narrow, saved-answer lookup is deterministic. Everything else still reaches
// the real model; this never generates prose from a cache of earlier responses.
export function savedAnswerLookup(state, prompt, attachments = []) {
  if (attachments.length || !/^(?:when (?:is|will)|what (?:is|was)|who (?:is|owns)|remind me (?:of|when|who))\b/i.test(prompt.trim())
    || /\b(?:actually|instead|change|revise|why|explain|review|and|also)\b/i.test(prompt)) return null;
  const subjects = [...new Set(state.facts.map(f => f.subject))].filter(subject => new RegExp(`\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt));
  const subject = subjects.sort((a, b) => b.length - a.length)[0];
  if (!subject) return null;
  const escaped = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^(?:when is|when will|what is|what was|who owns|who is|remind me of) (?:the |our )?${escaped}(?: be| date| owner| status)?[?.!]*$`, 'i').test(prompt.trim())) return null;
  const groups = new Map();
  for (const fact of state.facts.filter(f => f.subject === subject)) {
    const group = key(fact);
    groups.set(group, [...(groups.get(group) || []), fact]);
  }
  if (groups.size !== 1) return null;
  const candidates = [...groups.values()][0];
  const review = matchingConflictReview(state, candidates);
  if (!review) return null;
  return { subject, candidates, review, selected: candidates.find(f => f.id === review.selectedFactId) || null };
}

export function materializeClaims(analysis, { turnId, source, author, documents = [], now = new Date().toISOString() }) {
  return (analysis.claims || []).map((claim, index) => {
    const document = claim.sourceRef.startsWith('attachment:') ? documents[Number(claim.sourceRef.split(':')[1])] : null;
    return { id: `${turnId}-fact-${index + 1}`, source, ...(author ? { author } : {}),
      subject: claim.subject, attribute: claim.attribute, scope: claim.scope, value: claim.value,
      text: claim.quote, createdAt: now, sourceDate: now.slice(0, 10), ...(claim.dateYear ? { dateYear: claim.dateYear } : {}),
      ...(claim.validFrom ? { validFrom: claim.validFrom } : {}), ...(claim.validTo ? { validTo: claim.validTo } : {}),
      ...(document ? { document: document.name, documentId: document.id } : {}),
      provenance: { method: 'model-extracted', sourceRef: claim.sourceRef, quote: claim.quote, turnId, claimRef: claim.ref },
    };
  });
}

export function memoryEvidence(state, incoming, analysis) {
  const incomingIds = new Set(incoming.map(f => f.id));
  const byRef = new Map(incoming.map(f => [f.provenance.claimRef, f]));
  const relations = (analysis.relations || []).flatMap(relation => {
    const fact = byRef.get(relation.claimRef);
    return fact ? [{ ...relation, newFactId: fact.id }] : [];
  });
  const relevant = new Set(analysis.relevantFactIds || []);
  for (const relation of relations) relevant.add(relation.factId);
  const relevantKeys = new Set([...incoming, ...state.facts.filter(f => relevant.has(f.id))].map(key));
  const groups = [];
  for (const groupKey of relevantKeys) {
    let candidates = state.facts.filter(f => key(f) === groupKey);
    const current = candidates.filter(f => incomingIds.has(f.id));
    // A claim for another time period is retained but is not a contradiction.
    if (current.length) candidates = candidates.filter(f => current.some(n => n.id === f.id || comparableMemoryFacts(n, f)));
    const groupRelations = relations.filter(r => candidates.some(f => f.id === r.newFactId) && candidates.some(f => f.id === r.factId));
    const contradicted = groupRelations.some(r => ['contradiction', 'revision'].includes(r.type));
    const normalized = candidates.map(canonicalFact);
    const comparable = normalized.every(f => ['date', 'budget', 'owner'].includes(f.attribute));
    const conflict = contradicted || (comparable && new Set(candidates.map(value)).size > 1
      && candidates.some(a => candidates.some(b => a.id !== b.id && comparableMemoryFacts(a, b) && value(a) !== value(b))));
    if (candidates.length) groups.push({ subject: candidates[0].subject, candidates, conflict,
      revision: groupRelations.some(r => r.type === 'revision'), relations: groupRelations });
  }
  return groups.sort((a, b) => Number(b.conflict) - Number(a.conflict));
}

export function decisionSummary({ subject, candidates, selected, applied, policy, requiresConfirmation, savedReview, engineResolution }) {
  if (requiresConfirmation) return `**Memory decision:** This revises an earlier saved answer about ${subject}. Confirm the new source of truth below; the earlier decision is retained.`;
  if (savedReview) return selected ? `**Saved answer:** ${subject} — **${selected.value}** (${selected.author ? `${selected.author} · ` : ''}${selected.source}).` : `**Saved answer:** ${subject} remains unresolved.`;
  if (applied) return `**Memory decision:** ${subject} — **${selected?.value}** (${selected?.source}), using the saved scoped lesson under policy v${policy}.`;
  if (candidates.length > 1) return `**Memory decision:** The ${subject} claims disagree. ${selected ? `Policy v${policy} provisionally favors **${selected.value}** (${selected.source}). ` : ''}Confirm a claim below or leave it unresolved.`;
  return engineResolution?.explanation || '';
}
