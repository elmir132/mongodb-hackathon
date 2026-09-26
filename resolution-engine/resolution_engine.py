"""
Chronicle — Self-Healing Memory Engine (Elmir's piece)

Core loop: new fact -> conflict? -> resolve (precedent, else policy)
           -> human correction -> new precedent + scoped policy update
           -> next similar conflict resolves using the precedent

Everything here runs against sample data. No database, no frontend needed.
`get_matching_precedent` is a stub for now — Danny's real vector-search
version gets wired in later, same function signature.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import uuid


# ---------------------------------------------------------------------------
# Core objects
# ---------------------------------------------------------------------------

@dataclass
class Fact:
    id: str
    text: str
    source: str
    timestamp: datetime
    topic: str

    @staticmethod
    def new(text: str, source: str, topic: str) -> "Fact":
        return Fact(id=str(uuid.uuid4()), text=text, source=source,
                    timestamp=datetime.utcnow(), topic=topic)


@dataclass
class PolicyRule:
    scope: str                 # e.g. "launch-readiness"
    authority_ranking: list    # ordered highest-authority-first, e.g. ["engineering", "marketing"]


@dataclass
class ResolutionPolicy:
    version: int
    rules: list = field(default_factory=list)

    def authority_rank(self, source: str, scope: str) -> int:
        """Lower number = higher authority. Unranked sources default to lowest authority."""
        for rule in self.rules:
            if rule.scope == scope and source in rule.authority_ranking:
                return rule.authority_ranking.index(source)
        return 999  # unranked source, no explicit authority

    def add_or_update_rule(self, scope: str, authority_ranking: list) -> None:
        for rule in self.rules:
            if rule.scope == scope:
                rule.authority_ranking = authority_ranking
                return
        self.rules.append(PolicyRule(scope=scope, authority_ranking=authority_ranking))


@dataclass
class Precedent:
    id: str
    conflict_topic: str
    scope: str
    losing_source: str
    winning_source: str
    reason: str
    created_from_conflict_id: str

    @staticmethod
    def new(conflict_topic, scope, losing_source, winning_source, reason, conflict_id) -> "Precedent":
        return Precedent(id=str(uuid.uuid4()), conflict_topic=conflict_topic, scope=scope,
                          losing_source=losing_source, winning_source=winning_source,
                          reason=reason, created_from_conflict_id=conflict_id)


@dataclass
class Resolution:
    conflict_id: str
    supporting_fact_ids: list
    selected_fact_id: Optional[str]   # None means unresolved
    applied_precedent_id: Optional[str]
    policy_version: int
    explanation: str


# ---------------------------------------------------------------------------
# Precedent retrieval — STUB. Danny replaces this with real Voyage AI +
# Atlas Vector Search. Keep this exact signature so swapping it in is a
# one-line change, not a rewrite.
# ---------------------------------------------------------------------------

def get_matching_precedent(fact_text: str, topic: str, precedent_store: list) -> Optional[Precedent]:
    """
    TODO(Danny): replace this body with a real call to Atlas Vector Search.
    For now: exact-topic match against an in-memory list, so the rest of the
    engine can be built and tested without the real retrieval module.
    """
    for p in precedent_store:
        if p.conflict_topic == topic:
            return p
    return None


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

def facts_conflict(fact_a: Fact, fact_b: Fact) -> bool:
    """Same topic, different text = conflict, for the demo's purposes."""
    return fact_a.topic == fact_b.topic and fact_a.text.strip().lower() != fact_b.text.strip().lower()


def find_conflicts(new_fact: Fact, existing_facts: list) -> list:
    return [f for f in existing_facts if facts_conflict(new_fact, f)]


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def resolve_conflict(conflict_id: str, candidate_facts: list, policy: ResolutionPolicy,
                      precedent_store: list, scope: str) -> Resolution:
    """
    candidate_facts: the conflicting Facts (e.g. [marketing_fact, engineering_fact])
    scope: which policy domain this conflict falls under (e.g. "launch-readiness")
    """
    topic = candidate_facts[0].topic
    fact_ids = [f.id for f in candidate_facts]

    # 1. Check for an applicable precedent first.
    precedent = get_matching_precedent(candidate_facts[0].text, topic, precedent_store)
    if precedent and precedent.scope == scope:
        winner = next((f for f in candidate_facts if f.source == precedent.winning_source), None)
        if winner:
            return Resolution(
                conflict_id=conflict_id,
                supporting_fact_ids=fact_ids,
                selected_fact_id=winner.id,
                applied_precedent_id=precedent.id,
                policy_version=policy.version,
                explanation=f"Applied precedent: {precedent.reason} "
                            f"({precedent.winning_source} outranks {precedent.losing_source} for {scope}).",
            )

    # 2. No applicable precedent — fall back to the policy.
    ranked_scope = sorted(candidate_facts, key=lambda f: policy.authority_rank(f.source, scope))
    best = ranked_scope[0]

    if policy.authority_rank(best.source, scope) != 999:
        # a real, explicit authority ranking exists for this scope (set by a past correction)
        return Resolution(
            conflict_id=conflict_id,
            supporting_fact_ids=fact_ids,
            selected_fact_id=best.id,
            applied_precedent_id=None,
            policy_version=policy.version,
            explanation=f"No applicable precedent. Used learned policy: {best.source} "
                        f"has higher authority than other sources for {scope}.",
        )

    # No authority ranking yet for this scope — starting-policy default: the first
    # claim reported stands until corrected. This is what makes Chronicle's initial
    # answer plausible-but-wrong instead of a blank "unresolved", which is what
    # makes the demo's correction moment mean something.
    default_pick = min(candidate_facts, key=lambda f: f.timestamp)
    return Resolution(
        conflict_id=conflict_id,
        supporting_fact_ids=fact_ids,
        selected_fact_id=default_pick.id,
        applied_precedent_id=None,
        policy_version=policy.version,
        explanation=f"No precedent and no learned authority for '{scope}' yet. "
                    f"Starting policy default: first-reported claim stands "
                    f"({default_pick.source}) until corrected.",
    )


# ---------------------------------------------------------------------------
# Correction path — human overrides a resolution
# ---------------------------------------------------------------------------

def apply_correction(conflict_id: str, candidate_facts: list, correct_fact_id: str,
                      reason: str, scope: str, policy: ResolutionPolicy,
                      precedent_store: list) -> tuple[Precedent, ResolutionPolicy]:
    """
    Human says: this fact should have won, here's why.
    Creates a precedent AND updates the policy for this scope (scoped, not global).
    """
    winner = next(f for f in candidate_facts if f.id == correct_fact_id)
    losers = [f for f in candidate_facts if f.id != correct_fact_id]
    loser = losers[0] if losers else None

    precedent = Precedent.new(
        conflict_topic=winner.topic,
        scope=scope,
        losing_source=loser.source if loser else "unknown",
        winning_source=winner.source,
        reason=reason,
        conflict_id=conflict_id,
    )
    precedent_store.append(precedent)

    # Scoped policy update: this source now outranks the loser, for this scope only.
    existing_ranking = None
    for rule in policy.rules:
        if rule.scope == scope:
            existing_ranking = rule.authority_ranking
            break
    new_ranking = [winner.source] + [s for s in (existing_ranking or []) if s != winner.source]
    policy.version += 1
    policy.add_or_update_rule(scope, new_ranking)

    return precedent, policy


# ---------------------------------------------------------------------------
# Demo run — mirrors the actual pitch script end to end
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    policy = ResolutionPolicy(version=1)
    precedents: list = []

    print("=== Conflict 1: launch date ===")
    marketing_fact = Fact.new("The launch is Friday", source="marketing", topic="launch-date")
    engineering_fact = Fact.new("The launch moved to Monday", source="engineering", topic="launch-date")

    conflict_id_1 = str(uuid.uuid4())
    resolution_1 = resolve_conflict(conflict_id_1, [marketing_fact, engineering_fact],
                                     policy, precedents, scope="launch-readiness")
    print(resolution_1)

    print("\n=== Human correction: engineering owns launch readiness ===")
    precedent, policy = apply_correction(
        conflict_id_1, [marketing_fact, engineering_fact],
        correct_fact_id=engineering_fact.id,
        reason="Engineering owns launch readiness decisions.",
        scope="launch-readiness",
        policy=policy,
        precedent_store=precedents,
    )
    print("New precedent:", precedent)
    print("Policy version now:", policy.version)

    print("\n=== Conflict 2: a fresh, similar launch-readiness conflict ===")
    marketing_fact_2 = Fact.new("Launch is next Wednesday", source="marketing", topic="launch-date")
    engineering_fact_2 = Fact.new("Launch is pushed to next Friday", source="engineering", topic="launch-date")

    conflict_id_2 = str(uuid.uuid4())
    resolution_2 = resolve_conflict(conflict_id_2, [marketing_fact_2, engineering_fact_2],
                                     policy, precedents, scope="launch-readiness")
    print(resolution_2)
    assert resolution_2.applied_precedent_id is not None, "Expected the precedent to be applied automatically!"
    print("\n✅ Precedent applied automatically on the new conflict — the core loop works.")
