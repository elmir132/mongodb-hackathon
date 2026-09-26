"""Shared pytest fixtures for precedent retrieval tests."""

from __future__ import annotations

import pytest

from retrieval.offline_embed import offline_embed
from retrieval.retrieval import configure_embed_fn, load_seed_store, reset_runtime


@pytest.fixture(autouse=True)
def _clean_runtime():
    reset_runtime()
    yield
    reset_runtime()


@pytest.fixture
def seeded_store():
    """In-memory store with Chronicle demo seeds + offline embeddings."""
    store = load_seed_store(use_voyage=False)
    configure_embed_fn(offline_embed)
    return store
