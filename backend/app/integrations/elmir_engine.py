"""Adapter: Sahil's ResolutionEngine Protocol -> Elmir's real resolution_engine.py.

Replaces PassthroughResolutionEngine (mocks.py), which intentionally does
nothing. This is the piece that makes /state and /state/correct actually
decide anything and actually learn from a correction, instead of returning {}.

Sahil's `facts` are generic subject/predicate/value triples; the engine's
Fact is a domain object (text/source/subject). The mapping:

    his FactCreate.subject  -> engine Fact.subject   (what the claim is about)
    his FactCreate.source   -> engine Fact.source     (who claimed it)
    his predicate + value   -> engine Fact.text       (the claim itself)

`context` is his existing free-form dict (already used for e.g. case_id in
his own tests) — this adapter reads two more keys from it:
    context["scope"]    required  — policy domain, e.g. "launch-readiness"
    context["subject"]  required  — which stored facts belong to this
                                     conflict (same filter the engine itself
                                     enforces: same subject == same conflict)

The adapter is stateful (holds the ResolutionPolicy + precedent store, same
pattern as backend/app.py's DemoState) so it works with zero changes to
Sahil's repository/Mongo schema — .resolve()'s return value is already
persisted as free-form JSON via his existing save_state(), and .correct()
piggybacks on the same repository.save_state() call to record the outcome.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT / "resolution-engine") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "resolution-engine"))

import resolution_engine as engine  # noqa: E402


def _fact_text(predicate: str, value: Any) -> str:
    return f"{predicate.replace('_', ' ')} is {value}"


class MissingContextError(ValueError):
    pass


class ElmirResolutionEngine:
    """Real resolution logic + real learning, matching Sahil's ResolutionEngine
    Protocol (facts, precedents, context) -> dict, plus an additional
    .correct(fact_id, reason, context) -> dict used by POST /state/correct."""

    def __init__(self) -> None:
        self.policy = engine.demo_starting_policy()
        self.precedent_store: list[engine.Precedent] = []
        self._last_facts_by_stable_id: dict[str, engine.Fact] = {}
        self._last_resolution: engine.Resolution | None = None

    def _require(self, context: dict[str, Any], key: str) -> str:
        value = context.get(key)
        if not value:
            raise MissingContextError(
                f"context[{key!r}] is required for resolution "
                f"(e.g. context={{'scope': 'launch-readiness', 'subject': 'launch'}})"
            )
        return str(value)

    def _to_engine_facts(self, raw_facts: list[dict[str, Any]], subject: str,
                         project_id: str) -> list[engine.Fact]:
        matching = [f for f in raw_facts if f.get("subject") == subject]
        out: list[engine.Fact] = []
        for f in matching:
            stable_id = f.get("id") or f"{f.get('subject')}:{f.get('predicate')}:{f.get('source')}"
            fact = engine.Fact.new(
                text=_fact_text(f.get("predicate", "value"), f.get("value")),
                source=str(f.get("source") or "unknown"),
                subject=subject,
                project_id=project_id,
            )
            self._last_facts_by_stable_id[stable_id] = fact
            self._last_facts_by_stable_id[fact.id] = fact  # also indexable by engine id
            out.append(fact)
        return out

    def resolve(self, *, facts: list[dict[str, Any]], precedents: list[dict[str, Any]],
               context: dict[str, Any]) -> dict[str, Any]:
        scope = self._require(context, "scope")
        subject = self._require(context, "subject")
        project_id = str(context.get("project_id") or engine.DEFAULT_PROJECT_ID)
        conflict_id = str(context.get("conflict_id") or context.get("case_id") or f"conflict-{subject}")

        engine_facts = self._to_engine_facts(facts, subject, project_id)
        if len(engine_facts) < 2:
            return {
                "status": "insufficient-facts",
                "detail": f"Need at least two stored facts with subject={subject!r} to detect a conflict; found {len(engine_facts)}.",
            }

        def retrieve_fn(conflict_text: str, project_id: str, **_ignored) -> list[dict]:
            # Merge two sources: whatever Sahil's orchestration already fetched
            # via the real retriever upstream (Danny's Atlas/Voyage search),
            # PLUS this adapter's own in-process precedent_store. The retriever
            # has no way to know about precedents created moments ago via
            # .correct() in this same demo session — EmptyPrecedentRetriever
            # always returns [], and even a real Atlas-backed retriever won't
            # see a precedent until it's actually embedded and upserted there.
            # Session-local precedents go first: they're the freshest, most
            # relevant result for this exact demo run.
            session_local = [p.to_stored_document() for p in self.precedent_store]
            session_as_candidates = [
                {"precedent_id": d["precedent_id"], "score": 1.0, "scope": d["scope"],
                 "reason": d["reason"], "text": d["text"], "metadata": d["metadata"]}
                for d in session_local
            ]
            return session_as_candidates + list(precedents or [])

        resolution = engine.resolve_conflict(conflict_id, engine_facts, self.policy,
                                             retrieve_fn, scope, project_id)
        self._last_resolution = resolution
        return {"resolution": resolution.to_dict(), "policy_version": self.policy.version}

    def correct(self, *, correct_fact_id: str, reason: str, context: dict[str, Any]) -> dict[str, Any]:
        if self._last_resolution is None:
            raise MissingContextError(
                "No prior resolution to correct — call resolve (POST /state) for this "
                "conflict before POST /state/correct."
            )
        fact = self._last_facts_by_stable_id.get(correct_fact_id)
        if fact is None:
            raise MissingContextError(
                f"correct_fact_id={correct_fact_id!r} does not match any fact from the last resolution."
            )
        candidate_facts = [
            f for f in self._last_facts_by_stable_id.values()
            if f.id in self._last_resolution.supporting_fact_ids
        ]
        # dedupe (both the stable-id and engine-id keys point at the same Fact objects)
        seen, deduped = set(), []
        for f in candidate_facts:
            if f.id not in seen:
                seen.add(f.id)
                deduped.append(f)

        result = engine.apply_correction(self._last_resolution, deduped, fact.id, reason,
                                         self.policy, self.precedent_store)
        return {
            "precedent": result.precedent.to_dict(),
            "policy_update": result.policy_update.to_dict(),
            "resolution_changed": result.resolution_changed,
            "policy_version": self.policy.version,
        }
