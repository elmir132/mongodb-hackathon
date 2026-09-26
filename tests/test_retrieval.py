"""Tests for find_matching_precedent and store behavior."""

from __future__ import annotations

import pytest

from retrieval.models import PrecedentCandidate
from retrieval.offline_embed import offline_embed
from retrieval.retrieval import (
    configure_embed_fn,
    find_matching_precedent,
    load_seed_store,
)
from retrieval.seed_data import (
    CHRONICLE_DEMO_PROJECT,
    DEMO_CONFLICT_TEXT,
    OTHER_PROJECT,
)
from retrieval.store import InMemoryPrecedentStore, cosine_similarity
from retrieval.models import StoredPrecedent


def test_retrieval_returns_expected_schema(seeded_store):
    results = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
        as_dicts=True,
    )

    assert isinstance(results, list)
    assert results, "expected at least one candidate"
    hit = results[0]
    assert set(hit.keys()) >= {
        "precedent_id",
        "score",
        "scope",
        "reason",
        "text",
        "metadata",
    }
    assert hit["scope"]["project_id"] == CHRONICLE_DEMO_PROJECT
    assert isinstance(hit["score"], float)
    assert hit["text"]
    assert hit["reason"]


def test_launch_readiness_precedent_ranks_highly(seeded_store):
    results = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
    )

    assert results
    assert isinstance(results[0], PrecedentCandidate)
    assert results[0].precedent_id == "prec-launch-readiness-eng"
    # Relevant hit should outrank clearly unrelated budget/process precedents.
    unrelated = [
        c
        for c in results
        if c.precedent_id in {"prec-budget-finance", "prec-meeting-notes-style"}
    ]
    if unrelated:
        assert results[0].score > max(c.score for c in unrelated)


def test_project_id_filtering(seeded_store):
    demo_hits = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
    )
    other_hits = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        OTHER_PROJECT,
        store=seeded_store,
    )

    assert all(c.scope.project_id == CHRONICLE_DEMO_PROJECT for c in demo_hits)
    assert all(c.scope.project_id == OTHER_PROJECT for c in other_hits)
    assert "prec-other-project-launch" not in {c.precedent_id for c in demo_hits}
    assert "prec-launch-readiness-eng" not in {c.precedent_id for c in other_hits}


def test_no_useful_precedents_returns_empty():
    store = InMemoryPrecedentStore()
    configure_embed_fn(offline_embed)

    results = find_matching_precedent(
        "Totally unrelated alphabet soup xyzzy",
        "empty-project",
        store=store,
    )
    assert results == []


def test_min_score_filters_weak_matches(seeded_store):
    all_hits = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
        min_score=0.0,
    )
    assert all_hits
    # Threshold above the best score should filter everything out.
    results = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
        min_score=all_hits[0].score + 0.01,
    )
    assert results == []


def test_rejects_missing_inputs(seeded_store):
    with pytest.raises(ValueError):
        find_matching_precedent("", CHRONICLE_DEMO_PROJECT, store=seeded_store)
    with pytest.raises(ValueError):
        find_matching_precedent(DEMO_CONFLICT_TEXT, "", store=seeded_store)


def test_cosine_similarity_basics():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert cosine_similarity([], [1.0]) == 0.0
    with pytest.raises(ValueError, match="dimension mismatch"):
        cosine_similarity([1.0, 0.0], [1.0])


def test_scope_metadata_present_on_candidates(seeded_store):
    results = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
    )
    top = next(c for c in results if c.precedent_id == "prec-launch-readiness-eng")
    assert top.scope.topic == "launch-readiness"
    assert "engineering-authority" in top.scope.tags
    assert top.scope.constraints.get("authority_source") == "engineering"
    assert top.scope.constraints.get("overruled_source") == "marketing"


def test_store_upsert_requires_embedding():
    store = InMemoryPrecedentStore()
    with pytest.raises(ValueError, match="embedding"):
        store.upsert(
            StoredPrecedent(
                precedent_id="x",
                project_id="p",
                text="t",
                reason="r",
                embedding=None,
            )
        )


def test_load_seed_store_sets_module_default():
    store = load_seed_store(use_voyage=False)
    configure_embed_fn(offline_embed)
    # No store= passed — uses module-level store from load_seed_store.
    results = find_matching_precedent(DEMO_CONFLICT_TEXT, CHRONICLE_DEMO_PROJECT)
    assert results
    assert results[0].precedent_id == "prec-launch-readiness-eng"
    assert store is not None
