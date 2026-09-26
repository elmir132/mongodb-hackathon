"""Additional edge-case coverage for retrieval handoff robustness."""

from __future__ import annotations

import pytest

from retrieval.models import StoredPrecedent
from retrieval.offline_embed import offline_embed
from retrieval.retrieval import (
    configure_embed_fn,
    find_matching_precedent,
    load_seed_store,
)
from retrieval.seed_data import CHRONICLE_DEMO_PROJECT, DEMO_CONFLICT_TEXT
from retrieval.store import InMemoryPrecedentStore


def test_strips_padded_project_id_and_conflict_text(seeded_store):
    results = find_matching_precedent(
        f"  {DEMO_CONFLICT_TEXT}  ",
        f"  {CHRONICLE_DEMO_PROJECT}\t",
        store=seeded_store,
    )
    assert results
    assert results[0].precedent_id == "prec-launch-readiness-eng"


def test_top_k_rejects_non_positive(seeded_store):
    with pytest.raises(ValueError, match="top_k"):
        find_matching_precedent(
            DEMO_CONFLICT_TEXT,
            CHRONICLE_DEMO_PROJECT,
            store=seeded_store,
            top_k=0,
        )
    with pytest.raises(ValueError, match="top_k"):
        find_matching_precedent(
            DEMO_CONFLICT_TEXT,
            CHRONICLE_DEMO_PROJECT,
            store=seeded_store,
            top_k=-1,
        )


def test_duplicate_upsert_keeps_last_writer():
    store = InMemoryPrecedentStore()
    configure_embed_fn(offline_embed)
    first = StoredPrecedent(
        precedent_id="prec-dup",
        project_id=CHRONICLE_DEMO_PROJECT,
        text="First version about launch readiness engineering deploy",
        reason="v1",
        embedding=offline_embed("First version about launch readiness engineering deploy"),
        topic="launch-readiness",
        subject="launch",
        tags=["launch-readiness"],
        constraints={"authority_source": "engineering"},
    )
    second = StoredPrecedent(
        precedent_id="prec-dup",
        project_id=CHRONICLE_DEMO_PROJECT,
        text="Second version about launch readiness engineering deploy",
        reason="v2",
        embedding=offline_embed("Second version about launch readiness engineering deploy"),
        topic="launch-readiness",
        subject="launch",
        tags=["launch-readiness"],
        constraints={"authority_source": "engineering"},
    )
    store.upsert(first)
    store.upsert(second)
    hits = find_matching_precedent(
        "engineering launch readiness deploy",
        CHRONICLE_DEMO_PROJECT,
        store=store,
    )
    assert len([h for h in hits if h.precedent_id == "prec-dup"]) == 1
    assert hits[0].reason == "v2"


def test_as_dicts_schema_types_for_elmir(seeded_store):
    results = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=seeded_store,
        as_dicts=True,
    )
    assert results
    hit = results[0]
    assert isinstance(hit["precedent_id"], str)
    assert isinstance(hit["score"], float)
    assert isinstance(hit["scope"], dict)
    assert isinstance(hit["scope"]["tags"], list)
    assert isinstance(hit["scope"]["constraints"], dict)
    assert hit["scope"]["constraints"].get("authority_source") == "engineering"
    assert hit["scope"]["constraints"].get("overruled_source") == "marketing"
    assert isinstance(hit["reason"], str)
    assert isinstance(hit["text"], str)
    assert isinstance(hit["metadata"], dict)


def test_offline_embed_is_process_stable():
    a = offline_embed("Engineering owns launch-readiness decisions.")
    b = offline_embed("Engineering owns launch-readiness decisions.")
    assert a == b


def test_whitespace_only_project_id_rejected(seeded_store):
    with pytest.raises(ValueError):
        find_matching_precedent(DEMO_CONFLICT_TEXT, "   ", store=seeded_store)


def test_seed_constraints_match_elmir_vocabulary():
    store = load_seed_store(use_voyage=False)
    configure_embed_fn(offline_embed)
    hits = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        CHRONICLE_DEMO_PROJECT,
        store=store,
        as_dicts=True,
    )
    launch = next(h for h in hits if h["precedent_id"] == "prec-launch-readiness-eng")
    # Elmir: scope.topic == engine scope, constraints.authority_source == winning_source
    assert launch["scope"]["topic"] == "launch-readiness"
    assert launch["scope"]["subject"] == "launch"
    assert launch["scope"]["constraints"]["authority_source"] == "engineering"
