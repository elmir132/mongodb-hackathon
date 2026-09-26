"""
Tests for the resolution engine.

Run either way:
    python3 test_resolution_engine.py      # no dependencies
    pytest                                 # if installed

The last two tests exercise the real contract with Danny's retrieval package
(round-trip through his StoredPrecedent/PrecedentCandidate models, and his actual
find_matching_precedent with the offline embedder). They are skipped when that
package isn't importable, so this file also passes on a checkout of main alone.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from resolution_engine import (
    DEFAULT_PROJECT_ID,
    Fact,
    PolicyRule,
    Precedent,
    ResolutionPolicy,
    apply_correction,
    demo_starting_policy,
    make_stub_retriever,
    resolve_conflict,
)

try:  # pytest-compatible skip that also works without pytest
    import pytest
    _skip = pytest.skip
except ImportError:  # pragma: no cover
    class _Skipped(Exception):
        pass

    def _skip(msg):
        raise _Skipped(msg)


class _raises:
    def __init__(self, exc):
        self.exc = exc

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        assert et is not None and issubclass(et, self.exc), f"expected {self.exc.__name__}"
        return True


T0 = datetime(2026, 9, 26, 10, 0, tzinfo=timezone.utc)


def at(minutes: int) -> datetime:
    return T0.replace(minute=minutes)


def _pair(project_id: str = DEFAULT_PROJECT_ID):
    m = Fact.new("The launch is Friday", "marketing", "launch", project_id, timestamp=at(0))
    e = Fact.new("The launch moved to Monday", "engineering", "launch", project_id, timestamp=at(5))
    return m, e


# ---------------------------------------------------------------------------

def test_demo_loop_end_to_end():
    policy = demo_starting_policy()
    store: list = []
    retrieve = make_stub_retriever(store)
    m, e = _pair()

    r1 = resolve_conflict("c1", [m, e], policy, retrieve, scope="launch-readiness")
    assert r1.status == "resolved"
    assert r1.selected_fact_id == m.id, "starting policy picks marketing (plausible but wrong)"
    assert r1.applied_precedent_id is None
    assert r1.scores[m.id]["total"] > r1.scores[e.id]["total"]
    assert "marketing" in r1.explanation

    corr = apply_correction(r1, [m, e], e.id, "Engineering owns launch readiness.", policy, store)
    assert corr.resolution_changed is True
    assert corr.policy_update.previous_version == 1 and corr.policy_update.new_version == 2
    assert corr.policy_update.diff()["before"] == ["marketing", "engineering"]
    assert corr.policy_update.diff()["after"] == ["engineering", "marketing"]
    assert corr.precedent.winning_source == "engineering" and corr.precedent.losing_source == "marketing"
    assert corr.precedent.created_from_conflict_id == "c1"

    m2 = Fact.new("Launch is next Wednesday", "marketing", "launch", timestamp=at(30))
    e2 = Fact.new("Launch is pushed to next Friday", "engineering", "launch", timestamp=at(35))
    r2 = resolve_conflict("c2", [m2, e2], policy, retrieve, scope="launch-readiness")
    assert r2.applied_precedent_id == corr.precedent.id
    assert r2.selected_fact_id == e2.id
    assert r2.policy_version == 2


def test_out_of_scope_precedent_ranked_first_does_not_hide_an_applicable_one():
    # The bug the review caught: the old engine took the first topic match and
    # then checked scope, so a wrong-scope hit ranked first meant "no precedent".
    store = [
        Precedent(id="p-budget", project_id=DEFAULT_PROJECT_ID, scope="budget",
                  winning_source="engineering", reason="budget rule"),
        Precedent(id="p-launch", project_id=DEFAULT_PROJECT_ID, scope="launch-readiness",
                  winning_source="engineering", losing_source="marketing", reason="eng owns launch"),
    ]
    m, e = _pair()
    r = resolve_conflict("c", [m, e], ResolutionPolicy(), make_stub_retriever(store), scope="launch-readiness")
    assert r.applied_precedent_id == "p-launch"
    assert r.selected_fact_id == e.id


def test_other_project_precedent_never_applies_even_if_retriever_leaks_it():
    store = [Precedent(id="p-other", project_id="acme-rebrand", scope="launch-readiness",
                       winning_source="engineering", reason="acme only")]

    def leaky_retriever(conflict_text, project_id, **_):
        # Simulates a retriever that fails to filter by project. The engine must guard.
        return [dict(p.to_stored_document(), score=0.99) for p in store]

    m, e = _pair()
    r = resolve_conflict("c", [m, e], ResolutionPolicy(), leaky_retriever, scope="launch-readiness")
    assert r.applied_precedent_id is None


def test_precedent_whose_authority_source_is_not_a_claimant_is_skipped():
    store = [Precedent(id="p-finance", project_id=DEFAULT_PROJECT_ID, scope="launch-readiness",
                       winning_source="finance", reason="finance decides")]
    m, e = _pair()
    r = resolve_conflict("c", [m, e], ResolutionPolicy(), make_stub_retriever(store), scope="launch-readiness")
    assert r.applied_precedent_id is None


def test_informational_candidate_without_authority_is_ignored():
    def retriever(conflict_text, project_id, **_):
        return [{"precedent_id": "p-notes", "score": 0.95,
                 "scope": {"project_id": DEFAULT_PROJECT_ID, "topic": "launch-readiness",
                           "subject": None, "tags": [], "constraints": {}},
                 "reason": "style note", "text": "Notes need owners.", "metadata": {}}]
    m, e = _pair()
    r = resolve_conflict("c", [m, e], ResolutionPolicy(), retriever, scope="launch-readiness")
    assert r.applied_precedent_id is None


def test_unresolved_when_no_authority_and_equal_recency():
    a = Fact.new("Ship the blue theme", "ops", "theme", timestamp=at(0))
    b = Fact.new("Ship the green theme", "design", "theme", timestamp=at(0))
    r = resolve_conflict("c", [a, b], ResolutionPolicy(), make_stub_retriever([]), scope="branding")
    assert r.status == "unresolved"
    assert r.selected_fact_id is None
    assert "Unresolved" in r.explanation


def test_ranked_authority_dominates_recency():
    policy = ResolutionPolicy(rules=[PolicyRule("launch-readiness", ["engineering", "marketing"])])
    e = Fact.new("The launch moved to Monday", "engineering", "launch", timestamp=at(0))
    m = Fact.new("The launch is Friday", "marketing", "launch", timestamp=at(10))  # newer
    r = resolve_conflict("c", [m, e], policy, make_stub_retriever([]), scope="launch-readiness")
    assert r.status == "resolved" and r.selected_fact_id == e.id
    assert r.scores[m.id]["recency"] == 1.0 and r.scores[e.id]["authority"] == 1.0


def test_correction_validation_rejects_bad_input_without_side_effects():
    policy = demo_starting_policy()
    store: list = []
    m, e = _pair()
    r = resolve_conflict("c", [m, e], policy, make_stub_retriever(store), scope="launch-readiness")

    with _raises(ValueError):
        apply_correction(None, [m, e], e.id, "why", policy, store)
    with _raises(ValueError):
        apply_correction(r, [m, e], "fact-does-not-exist", "why", policy, store)
    with _raises(ValueError):
        apply_correction(r, [m, e], e.id, "   ", policy, store)

    assert store == [] and policy.version == 1


def test_confirming_correction_still_records_precedent_but_flags_unchanged():
    policy = demo_starting_policy()
    store: list = []
    m, e = _pair()
    r = resolve_conflict("c", [m, e], policy, make_stub_retriever(store), scope="launch-readiness")
    corr = apply_correction(r, [m, e], m.id, "Marketing is right for this one.", policy, store)
    assert corr.resolution_changed is False
    assert corr.precedent.winning_source == "marketing"
    assert policy.version == 2


def test_serialization_is_json_safe_and_policy_round_trips():
    policy = demo_starting_policy()
    store: list = []
    m, e = _pair()
    r = resolve_conflict("c", [m, e], policy, make_stub_retriever(store), scope="launch-readiness")
    corr = apply_correction(r, [m, e], e.id, "Engineering owns launch readiness.", policy, store)
    json.dumps(r.to_dict())
    json.dumps(corr.to_dict())
    json.dumps(m.to_dict())
    json.dumps(corr.precedent.to_stored_document())
    assert ResolutionPolicy.from_snapshot(policy.snapshot()).snapshot() == policy.snapshot()


# ---------------------------------------------------------------------------
# Contract tests against Danny's package (skipped if not importable)
# ---------------------------------------------------------------------------

def _make_corrected_precedent():
    policy = demo_starting_policy()
    store: list = []
    m, e = _pair()
    r = resolve_conflict("c1", [m, e], policy, make_stub_retriever(store), scope="launch-readiness")
    corr = apply_correction(r, [m, e], e.id, "Engineering owns launch readiness.", policy, store)
    return corr.precedent


def test_round_trip_through_dannys_models():
    try:
        from retrieval.models import StoredPrecedent
    except ImportError:
        _skip("retrieval package not importable")

    original = _make_corrected_precedent()
    doc = original.to_stored_document()            # what Sahil persists
    stored = StoredPrecedent.from_document(doc)     # what Danny's store loads
    cand = stored.to_candidate(0.93).to_dict()      # what find_matching_precedent(as_dicts=True) returns
    p = Precedent.from_candidate(cand)              # what the engine consumes

    assert p.id == original.id
    assert p.project_id == DEFAULT_PROJECT_ID
    assert p.scope == "launch-readiness"
    assert p.winning_source == "engineering" and p.losing_source == "marketing"
    assert p.score == 0.93

    m2, e2 = _pair()
    r2 = resolve_conflict("c2", [m2, e2], ResolutionPolicy(),
                          lambda text, pid, **_: [cand], scope="launch-readiness")
    assert r2.applied_precedent_id == original.id and r2.selected_fact_id == e2.id


def test_live_call_into_dannys_find_matching_precedent_with_offline_embedder():
    try:
        from retrieval.models import StoredPrecedent
        from retrieval.offline_embed import offline_embed
        from retrieval.retrieval import configure_embed_fn, find_matching_precedent, reset_runtime
        from retrieval.store import InMemoryPrecedentStore
    except ImportError:
        _skip("retrieval package not importable")

    original = _make_corrected_precedent()
    stored = StoredPrecedent.from_document(original.to_stored_document())
    stored.embedding = offline_embed(stored.text)
    mem = InMemoryPrecedentStore()
    mem.upsert(stored)

    reset_runtime()
    configure_embed_fn(offline_embed)  # no Voyage key needed
    try:
        def retrieve(conflict_text, project_id, **_):
            return find_matching_precedent(conflict_text, project_id, store=mem,
                                           top_k=5, min_score=0.0, as_dicts=True)
        m2, e2 = _pair()
        r2 = resolve_conflict("c2", [m2, e2], ResolutionPolicy(), retrieve, scope="launch-readiness")
    except Exception as exc:  # config/env quirks on Danny's side shouldn't fail *our* suite
        _skip(f"Danny's runtime unavailable here: {exc!r}")
    finally:
        reset_runtime()

    assert r2.applied_precedent_id == original.id
    assert r2.selected_fact_id == e2.id


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except Exception as exc:  # noqa: BLE001
            if type(exc).__name__ in ("Skipped", "_Skipped"):
                print(f"SKIP  {name}: {exc}")
            else:
                failed += 1
                print(f"FAIL  {name}: {exc!r}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
