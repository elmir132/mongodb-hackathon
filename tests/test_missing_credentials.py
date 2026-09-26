"""Ensure missing Voyage credentials fail clearly when no mock embed is wired."""

from __future__ import annotations

import pytest

from retrieval.config import MissingCredentialsError, RetrievalConfig
from retrieval.retrieval import find_matching_precedent, reset_runtime
from retrieval.store import InMemoryPrecedentStore


def test_find_matching_precedent_missing_voyage_key(monkeypatch):
    reset_runtime()
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)

    cfg = RetrievalConfig(
        voyage_api_key=None,
        embedding_model="voyage-4",
        embedding_dimension=None,
        store_backend="memory",
        mongodb_uri=None,
        mongodb_db="chronicle",
        precedents_collection="precedents",
        vector_index_name="precedent_vector_index",
        top_k=5,
        min_score=0.0,
    )

    with pytest.raises(MissingCredentialsError, match="VOYAGE_API_KEY"):
        find_matching_precedent(
            "Product vs engineering on deploy readiness",
            "chronicle-demo",
            config=cfg,
            store=InMemoryPrecedentStore(),
        )
