"""
Chronicle — Self-Healing Memory Engine (Elmir's piece)

Core loop:
    new fact -> conflict? -> resolve (applicable precedent, else weighted policy)
             -> human correction -> new precedent + scoped, versioned policy update
             -> next similar conflict resolves using the precedent

Contract with Danny's retrieval module (see INTEGRATION.md on his branch):
    candidates = find_matching_precedent(conflict_text, project_id, as_dicts=True)
    -> [{"precedent_id", "score", "scope": {"project_id", "topic", "subject",
         "tags", "constraints"}, "reason", "text", "metadata"}, ...]

Vocabulary mapping (the two modules grew up separately):
    Danny `scope.topic`                  == engine `scope`        (policy domain, e.g. "launch-readiness")
    Danny `scope.subject`                == engine `Fact.subject` (what the claim is about, e.g. "launch")
    Danny `constraints.authority_source` == engine `Precedent.winning_source`
    Danny `score`                        == evidence only. Applicability is decided HERE, never by similarity.

No third-party dependencies. Retrieval is injected as a callable, so the engine
runs against an in-memory stub today and Danny's real Voyage AI + Atlas Vector
Search at integration without any change to the resolution logic.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

DEFAULT_PROJECT_ID = "chronicle-demo"  # == retrieval/seed_data.CHRONICLE_DEMO_PROJECT


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Core objects
# ---------------------------------------------------------------------------

@dataclass
class Fact:
    id: str
    text: str
    source: str
    timestamp: datetime
    subject: str                      # what the claim is about, e.g. "launch"
    project_id: str = DEFAULT_PROJECT_ID

    @staticmethod
    def new(text: str, source: str, subject: str,
            project_id: str = DEFAULT_PROJECT_ID,
            timestamp: Optional[datetime] = None) -> "Fact":
        return Fact(id=_new_id("fact"), text=text, source=source,
                    timestamp=timestamp or _now(), subject=subject, project_id=project_id)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["timestamp"] = self.timestamp.isoformat()
        return d


@dataclass
class PolicyRule:
    scope: str
    authority_ranking: list            # highest authority first


@dataclass
class ResolutionPolicy:
    version: int = 1
    rules: list = field(default_factory=list)
    authority_weight: float = 0.7
    recency_weight: float = 0.3
    # Below this score gap between the top two candidates the engine refuses to
    # guess and returns "unresolved". Math note: with a 2-source ranking the
    # authority gap is 0.7 * 0.5 = 0.35 and the max recency swing is 0.30, so a
    # ranked source always wins by >= 0.05. Ties only happen when no source in
    # the scope is ranked and recency is (near) equal.
    min_margin: float = 0.03

    def rule_for(self, scope: str) -> Optional[PolicyRule]:
        return next((r for r in self.rules if r.scope == scope), None)

    def authority_score(self, source: str, scope: str) -> float:
        rule = self.rule_for(scope)
        if rule is None or source not in rule.authority_ranking:
            return 0.0
        n = len(rule.authority_ranking)
        return (n - rule.authority_ranking.index(source)) / n

    def set_rule(self, scope: str, authority_ranking: list) -> None:
        rule = self.rule_for(scope)
        if rule is None:
            self.rules.append(PolicyRule(scope=scope, authority_ranking=list(authority_ranking)))
        else:
            rule.authority_ranking = list(authority_ranking)

    def snapshot(self) -> dict:
        """Immutable, JSON-friendly copy. This is what gets persisted/versioned."""
        return {
            "version": self.version,
            "rules": [{"scope": r.scope, "authority_ranking": list(r.authority_ranking)} for r in self.rules],
            "weights": {"authority": self.authority_weight, "recency": self.recency_weight},
            "min_margin": self.min_margin,
        }

    @classmethod
    def from_snapshot(cls, snap: dict) -> "ResolutionPolicy":
        w = snap.get("weights") or {}
        return cls(
            version=int(snap.get("version", 1)),
            rules=[PolicyRule(scope=r["scope"], authority_ranking=list(r["authority_ranking"]))
                   for r in snap.get("rules", [])],
            authority_weight=float(w.get("authority", 0.7)),
            recency_weight=float(w.get("recency", 0.3)),
            min_margin=float(snap.get("min_margin", 0.03)),
        )


@dataclass
class Precedent:
    id: str
    project_id: str
    scope: str                          # policy domain  (Danny: scope.topic)
    winning_source: str                 # Danny: constraints.authority_source
    losing_source: str = ""             # Danny: constraints.overruled_source (we write it)
    subject: Optional[str] = None       # Danny: scope.subject
    reason: str = ""
    text: str = ""
    created_from_conflict_id: str = ""
    policy_version: Optional[int] = None
    score: Optional[float] = None       # retrieval similarity, evidence only

    def to_dict(self) -> dict:
        return asdict(self)

    def to_stored_document(self) -> dict:
        """Exactly the document shape Danny's StoredPrecedent.from_document()
        reads and Sahil persists in the `precedents` collection. `embedding`
        is None here; Danny's loader / Sahil's write path fills it in."""
        return {
            "_id": self.id,
            "precedent_id": self.id,
            "project_id": self.project_id,
            "text": self.text,
            "reason": self.reason,
            "embedding": None,
            "scope": {
                "project_id": self.project_id,
                "topic": self.scope,
                "subject": self.subject,
                "tags": [self.scope, f"{self.winning_source}-authority"],
                "constraints": {
                    "authority_source": self.winning_source,
                    "overruled_source": self.losing_source,
                },
            },
            "metadata": {
                "created_from_conflict_id": self.created_from_conflict_id,
                "policy_version": self.policy_version,
            },
        }

    @classmethod
    def from_candidate(cls, c: Any) -> Optional["Precedent"]:
        """Adapter: a retrieval candidate (PrecedentCandidate object, or the
        as_dicts=True dict) -> Precedent. Returns None when the candidate carries
        no authority rule, i.e. it is informational and cannot resolve anything."""
        if isinstance(c, Precedent):
            return c
        if not isinstance(c, dict):
            if hasattr(c, "to_dict"):
                c = c.to_dict()
            else:
                return None
        scope = c.get("scope") or {}
        constraints = scope.get("constraints") or {}
        winner = constraints.get("authority_source")
        if not winner:
            return None
        domain = scope.get("topic") or next(iter(scope.get("tags") or []), None)
        if not domain:
            return None
        meta = c.get("metadata") or {}
        return cls(
            id=str(c.get("precedent_id") or c.get("id") or ""),
            project_id=str(scope.get("project_id") or c.get("project_id") or ""),
            scope=str(domain),
            winning_source=str(winner),
            losing_source=str(constraints.get("overruled_source") or ""),
            subject=scope.get("subject"),
            reason=str(c.get("reason") or ""),
            text=str(c.get("text") or ""),
            created_from_conflict_id=str(meta.get("created_from_conflict_id") or ""),
            policy_version=meta.get("policy_version"),
            score=c.get("score"),
        )


@dataclass
class Resolution:
    """The resolution payload the team agreed on. Sahil persists it, Maxime renders it."""
    conflict_id: str
    project_id: str
    scope: str
    supporting_fact_ids: list
    selected_fact_id: Optional[str]     # None == unresolved
    applied_precedent_id: Optional[str]
    policy_version: int
    explanation: str
    status: str = "resolved"            # "resolved" | "unresolved"
    scores: dict = field(default_factory=dict)   # fact_id -> {source, authority, recency, total}

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PolicyUpdate:
    previous_version: int
    new_version: int
    changed_scope: str
    before: dict                        # full policy snapshot before
    after: dict                         # full policy snapshot after

    def diff(self) -> dict:
        """Just the changed scope's ranking, before vs after. Maxime's
        'what changed?' panel can render this directly."""
        def ranking(snap: dict) -> list:
            for r in snap.get("rules", []):
                if r["scope"] == self.changed_scope:
                    return list(r["authority_ranking"])
            return []
        return {"scope": self.changed_scope, "before": ranking(self.before), "after": ranking(self.after),
                "previous_version": self.previous_version, "new_version": self.new_version}

    def to_dict(self) -> dict:
        d = asdict(self)
        d["diff"] = self.diff()
        return d


@dataclass
class CorrectionResult:
    precedent: Precedent
    policy_update: PolicyUpdate
    resolution_changed: bool            # False when the human confirmed the engine's pick

    def to_dict(self) -> dict:
        return {"precedent": self.precedent.to_dict(),
                "policy_update": self.policy_update.to_dict(),
                "resolution_changed": self.resolution_changed}


# ---------------------------------------------------------------------------
# Retrieval boundary
# ---------------------------------------------------------------------------

# Danny's signature:
#   find_matching_precedent(conflict_text, project_id, *, top_k=None, min_score=None,
#                           config=None, store=None, as_dicts=False)
RetrieveFn = Callable[..., list]


def make_stub_retriever(precedent_store: list) -> RetrieveFn:
    """In-memory stand-in with Danny's signature and output shape. Returns every
    stored precedent for the project (insertion order) so the engine's own
    applicability check does the filtering, exactly as it will with real
    vector-search hits. At integration, pass `retrieval.find_matching_precedent`
    to `resolve_conflict` instead of this."""
    def find_matching_precedent(conflict_text: str, project_id: str, *,
                                top_k: Optional[int] = None, min_score: Optional[float] = None,
                                as_dicts: bool = True, **_ignored) -> list:
        cands = [p for p in precedent_store if p.project_id == project_id]
        if top_k:
            cands = cands[:top_k]
        out = []
        for p in cands:
            d = p.to_stored_document()
            out.append({"precedent_id": d["precedent_id"], "score": 1.0, "scope": d["scope"],
                        "reason": d["reason"], "text": d["text"], "metadata": d["metadata"]})
        return out if as_dicts else [Precedent.from_candidate(x) for x in out]
    return find_matching_precedent


def describe_conflict(facts: list) -> str:
    """Natural-language query text for retrieval (what Voyage AI embeds)."""
    return " ".join(f"{f.source} says: {f.text.rstrip('.')}." for f in facts)


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

def facts_conflict(a: Fact, b: Fact) -> bool:
    """Same project, same subject, different claim."""
    return (a.project_id == b.project_id and a.subject == b.subject
            and a.text.strip().lower() != b.text.strip().lower())


def find_conflicts(new_fact: Fact, existing_facts: list) -> list:
    return [f for f in existing_facts if facts_conflict(new_fact, f)]


# ---------------------------------------------------------------------------
# Applicability + scoring
# ---------------------------------------------------------------------------

def precedent_applies(p: Precedent, scope: str, project_id: str, claimant_sources: set,
                      subject: Optional[str] = None) -> bool:
    """Similarity never decides this. A precedent applies only if it is from the
    same project, governs this scope (policy domain), names an authority source
    that is actually one of this conflict's claimants, AND — if the precedent
    was recorded against a specific subject — that subject matches this
    conflict's. A precedent with no subject recorded is treated as scope-wide
    (e.g. an old precedent created before subjects were tracked); a precedent
    WITH a subject must match exactly, so a 'database-migration' precedent can
    never resolve a 'launch' conflict just because scope and source line up."""
    return (p.project_id == project_id
            and p.scope == scope
            and p.winning_source in claimant_sources
            and (p.subject is None or subject is None or p.subject == subject))


def score_facts(facts: list, policy: ResolutionPolicy, scope: str) -> dict:
    """Weighted policy: authority (dominant) + recency (refines). Returns the
    full breakdown so explanations can show their work."""
    ts = [f.timestamp.timestamp() for f in facts]
    lo, hi = min(ts), max(ts)
    out = {}
    for f in facts:
        a = policy.authority_score(f.source, scope)
        r = 0.5 if hi == lo else (f.timestamp.timestamp() - lo) / (hi - lo)
        total = policy.authority_weight * a + policy.recency_weight * r
        out[f.id] = {"source": f.source, "authority": round(a, 3), "recency": round(r, 3), "total": round(total, 3)}
    return out


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def resolve_conflict(conflict_id: str, candidate_facts: list, policy: ResolutionPolicy,
                     retrieve: RetrieveFn, scope: str,
                     project_id: Optional[str] = None) -> Resolution:
    """
    candidate_facts: the conflicting Facts (e.g. [marketing_fact, engineering_fact])
    retrieve:        Danny's find_matching_precedent (or make_stub_retriever(...))
    scope:           policy domain this conflict falls under (e.g. "launch-readiness")
    """
    if len(candidate_facts) < 2:
        raise ValueError("A conflict needs at least two facts.")
    project_id = project_id or candidate_facts[0].project_id
    subject = candidate_facts[0].subject
    if any(f.project_id != project_id for f in candidate_facts):
        raise ValueError("All candidate facts in a conflict must share the same project_id.")
    if any(f.subject != subject for f in candidate_facts):
        raise ValueError("All candidate facts in a conflict must share the same subject "
                          "(they're claims about the same thing, that's what makes them conflict).")
    fact_ids = [f.id for f in candidate_facts]
    by_source = {f.source: f for f in candidate_facts}
    scores = score_facts(candidate_facts, policy, scope)

    # 1. Precedents. Candidates arrive ranked by similarity; apply the FIRST one
    #    that actually applies. Out-of-scope / other-project / other-subject /
    #    non-claimant candidates are skipped, not treated as "no precedent found".
    raw = retrieve(describe_conflict(candidate_facts), project_id, as_dicts=True) or []
    for cand in raw:
        p = Precedent.from_candidate(cand)
        if p is None or not precedent_applies(p, scope, project_id, set(by_source), subject):
            continue
        winner = by_source[p.winning_source]
        evidence = f", similarity {p.score:.2f}" if isinstance(p.score, (int, float)) else ""
        return Resolution(
            conflict_id=conflict_id, project_id=project_id, scope=scope,
            supporting_fact_ids=fact_ids, selected_fact_id=winner.id,
            applied_precedent_id=p.id, policy_version=policy.version, status="resolved",
            scores=scores,
            explanation=(f"Applied precedent {p.id} for scope '{scope}': {p.reason or p.text} "
                         f"-> {p.winning_source} wins{evidence}."),
        )

    # 2. Weighted policy.
    ranked = sorted(candidate_facts, key=lambda f: scores[f.id]["total"], reverse=True)
    best, second = ranked[0], ranked[1]
    margin = scores[best.id]["total"] - scores[second.id]["total"]
    rule = policy.rule_for(scope)
    basis = (f"policy v{policy.version} ranking {rule.authority_ranking}" if rule
             else f"policy v{policy.version} has no authority ranking for '{scope}', recency only")

    if margin < policy.min_margin:
        return Resolution(
            conflict_id=conflict_id, project_id=project_id, scope=scope,
            supporting_fact_ids=fact_ids, selected_fact_id=None,
            applied_precedent_id=None, policy_version=policy.version, status="unresolved",
            scores=scores,
            explanation=(f"Unresolved: no applicable precedent and the evidence does not justify a choice "
                         f"({best.source} {scores[best.id]['total']:.2f} vs {second.source} "
                         f"{scores[second.id]['total']:.2f}, margin {margin:.3f} < {policy.min_margin}; {basis}). "
                         f"Needs human input."),
        )

    return Resolution(
        conflict_id=conflict_id, project_id=project_id, scope=scope,
        supporting_fact_ids=fact_ids, selected_fact_id=best.id,
        applied_precedent_id=None, policy_version=policy.version, status="resolved",
        scores=scores,
        explanation=(f"No applicable precedent. Weighted policy ({policy.authority_weight} authority + "
                     f"{policy.recency_weight} recency), {basis}: {best.source} "
                     f"{scores[best.id]['total']:.2f} vs {second.source} {scores[second.id]['total']:.2f} "
                     f"(margin {margin:.3f})."),
    )


# ---------------------------------------------------------------------------
# Correction path — human overrides (or confirms) a resolution
# ---------------------------------------------------------------------------

def apply_correction(previous: Resolution, candidate_facts: list, correct_fact_id: str,
                     reason: str, policy: ResolutionPolicy, precedent_store: list) -> CorrectionResult:
    """
    Consumes the previous Resolution + human feedback. Creates a precedent AND a
    scoped, versioned policy update. Returns before/after snapshots so the
    Living Ledger can show exactly what changed.
    """
    if previous is None:
        raise ValueError("A correction must reference the previous resolution.")
    if correct_fact_id not in previous.supporting_fact_ids:
        raise ValueError("Corrected fact is not part of this conflict.")
    if not reason or not reason.strip():
        raise ValueError("A correction needs a non-empty reason.")
    by_id = {f.id: f for f in candidate_facts}
    if correct_fact_id not in by_id:
        raise ValueError("Corrected fact not found among the candidate facts.")

    scope = previous.scope
    winner = by_id[correct_fact_id]
    others = [f for f in candidate_facts if f.id != correct_fact_id]
    # The overruled source is whoever the engine had picked, else the first other claimant.
    prev_pick = by_id.get(previous.selected_fact_id) if previous.selected_fact_id else None
    loser = prev_pick if (prev_pick and prev_pick.id != winner.id) else (others[0] if others else None)
    resolution_changed = previous.selected_fact_id != correct_fact_id

    before = policy.snapshot()

    existing = list(policy.rule_for(scope).authority_ranking) if policy.rule_for(scope) else []
    new_ranking = [winner.source] + [s for s in existing if s != winner.source]
    for f in others:
        if f.source not in new_ranking:
            new_ranking.append(f.source)
    policy.version += 1
    policy.set_rule(scope, new_ranking)
    after = policy.snapshot()

    precedent = Precedent(
        id=_new_id("prec"),
        project_id=winner.project_id,
        scope=scope,
        winning_source=winner.source,
        losing_source=loser.source if loser else "",
        subject=winner.subject,
        reason=reason.strip(),
        text=f"{winner.source} owns {scope} decisions.",
        created_from_conflict_id=previous.conflict_id,
        policy_version=policy.version,
    )
    precedent_store.append(precedent)

    return CorrectionResult(
        precedent=precedent,
        policy_update=PolicyUpdate(previous_version=before["version"], new_version=after["version"],
                                   changed_scope=scope, before=before, after=after),
        resolution_changed=resolution_changed,
    )


# ---------------------------------------------------------------------------
# Demo starting policy
# ---------------------------------------------------------------------------

def demo_starting_policy() -> ResolutionPolicy:
    """The team's naive starting policy: marketing announces dates, so marketing
    is the default owner of launch-date claims. Plausible, and wrong, which is the
    point of the demo's correction step. Making this an explicit rule (rather than
    a timestamp accident) means the 'Why this decision?' panel has a real answer."""
    return ResolutionPolicy(version=1, rules=[
        PolicyRule(scope="launch-readiness", authority_ranking=["marketing", "engineering"]),
    ])


# ---------------------------------------------------------------------------
# Demo run — mirrors the pitch script end to end
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    policy = demo_starting_policy()
    precedents: list = []
    retrieve = make_stub_retriever(precedents)
    t0 = datetime(2026, 9, 26, 10, 0, tzinfo=timezone.utc)

    print("=== Conflict 1: launch date ===")
    marketing = Fact.new("The launch is Friday", "marketing", "launch", timestamp=t0)
    engineering = Fact.new("The launch moved to Monday", "engineering", "launch",
                           timestamp=t0.replace(minute=5))
    r1 = resolve_conflict("conflict-1", [marketing, engineering], policy, retrieve, scope="launch-readiness")
    print(json.dumps(r1.to_dict(), indent=2))
    assert r1.selected_fact_id == marketing.id, "Starting policy should pick marketing (plausible but wrong)"

    print("\n=== Human correction: engineering owns launch readiness ===")
    corr = apply_correction(r1, [marketing, engineering], correct_fact_id=engineering.id,
                            reason="Engineering owns launch readiness decisions.",
                            policy=policy, precedent_store=precedents)
    print("resolution_changed:", corr.resolution_changed)
    print("policy diff:", json.dumps(corr.policy_update.diff(), indent=2))
    print("precedent document for Sahil/Danny:", json.dumps(corr.precedent.to_stored_document(), indent=2))

    print("\n=== Conflict 2: a fresh, different launch-readiness conflict ===")
    marketing2 = Fact.new("Launch is next Wednesday", "marketing", "launch", timestamp=t0.replace(hour=14))
    engineering2 = Fact.new("Launch is pushed to next Friday", "engineering", "launch",
                            timestamp=t0.replace(hour=14, minute=5))
    r2 = resolve_conflict("conflict-2", [marketing2, engineering2], policy, retrieve, scope="launch-readiness")
    print(json.dumps(r2.to_dict(), indent=2))
    assert r2.applied_precedent_id == corr.precedent.id, "Expected the stored precedent to be applied"
    assert r2.selected_fact_id == engineering2.id
    print("\n✅ Precedent applied automatically on the new conflict, the core loop works.")
