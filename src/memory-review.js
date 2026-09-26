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
  // These are persisted, previously validated semantic relationships. A lookup
  // may reuse them, but an old revision is never treated as a fresh revision.
  const recordedRelations = (state.turns || []).flatMap(turn =>
    (turn.evidenceGroups || []).flatMap(group => group.relations || []));
  const groups = [], seen = new Set();
  for (const groupKey of relevantKeys) {
    const matching = state.facts.filter(f => key(f) === groupKey);
    const current = matching.filter(f => incomingIds.has(f.id));
    const anchors = current.length ? current : matching.filter(f => relevant.has(f.id));
    for (const anchor of anchors) {
      const compatible = matching.filter(f => f.id === anchor.id || comparableMemoryFacts(anchor, f));
      const partitions = [[anchor]];
      // Overlap is not transitive: a year-long claim may overlap September and
      // October while those months cannot conflict with each other. Keep each
      // partition pairwise comparable, allowing the broad claim in both.
      for (const fact of compatible) {
        if (fact.id === anchor.id) continue;
        const fitting = partitions.filter(partition => partition.every(member =>
          member.id === fact.id || comparableMemoryFacts(member, fact)));
        if (fitting.length) for (const partition of fitting) partition.push(fact);
        else partitions.push([anchor, fact]);
      }
      for (const partition of partitions) {
        const ids = new Set(partition.map(f => f.id));
        const signature = [...ids].sort().join('|');
        if (seen.has(signature)) continue;
        seen.add(signature);
        // Restore persisted order so equivalent updates and source ordering do
        // not change merely because the current claim anchored the partition.
        const candidates = matching.filter(f => ids.has(f.id));
        const currentRelations = relations.filter(r => ids.has(r.newFactId) && ids.has(r.factId));
        const groupRelations = [...currentRelations];
        for (const relation of recordedRelations) {
          if (ids.has(relation.newFactId) && ids.has(relation.factId)
            && !groupRelations.some(r => r.newFactId === relation.newFactId && r.factId === relation.factId && r.type === relation.type)) groupRelations.push(relation);
        }
        const contradicted = groupRelations.some(r => ['contradiction', 'revision'].includes(r.type));
        const normalized = candidates.map(canonicalFact);
        const deterministic = normalized.every(f => ['date', 'budget', 'owner'].includes(f.attribute));
        const conflict = contradicted || (deterministic && new Set(candidates.map(value)).size > 1);
        groups.push({ subject: candidates[0].subject, candidates, conflict,
          revision: currentRelations.some(r => r.type === 'revision'), relations: groupRelations });
      }
    }
  }
  // An anchor can produce a smaller equivalent subset before another anchor
  // fills the entire compatible group. Keep only the complete evidence set.
  return groups.filter(group => !groups.some(other => other !== group
    && other.candidates.length > group.candidates.length
    && group.candidates.every(f => other.candidates.some(candidate => candidate.id === f.id))))
    .sort((a, b) => Number(b.conflict) - Number(a.conflict));
}

export function decisionSummary({ subject, candidates, selected, applied, policy, requiresConfirmation, savedReview, engineResolution }) {
  const evidence = candidates.map(fact => `**${fact.value}** from ${fact.author ? `${fact.author} [${fact.source}]` : fact.source}${fact.document ? ` (${fact.document}${fact.sourceDate ? `, ${fact.sourceDate}` : ''})` : ''}`).join('; ');
  if (requiresConfirmation) return `**Memory decision:** This revises an earlier saved answer about ${subject}. Confirm the new source of truth below; the earlier decision is retained.`;
  if (savedReview) return selected ? `**Saved answer:** ${subject} — **${selected.value}** (${selected.author ? `${selected.author} · ` : ''}${selected.source}).` : `**Saved answer:** ${subject} remains unresolved.`;
  if (applied) return `**Memory decision:** ${subject} — **${selected?.value}** (${selected?.source}), using the saved scoped lesson under policy v${policy}.`;
  if (candidates.length > 1) return `The ${subject} claims disagree: ${evidence}.\n\n**Memory decision:** ${selected ? `Policy v${policy} provisionally favors **${selected.value}** (${selected.source}). ` : ''}Confirm a claim below or leave it unresolved.`;
  return engineResolution?.explanation || '';
}
