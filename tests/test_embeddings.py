"""Tests for embed_text and credential handling."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from retrieval.config import MissingCredentialsError, RetrievalConfig
from retrieval.embeddings import embed_documents, embed_text


def _cfg(**overrides) -> RetrievalConfig:
    base = dict(
        voyage_api_key="test-key",
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
    base.update(overrides)
    return RetrievalConfig(**base)


def test_embed_text_calls_voyage_client():
    client = MagicMock()
    client.embed.return_value = SimpleNamespace(embeddings=[[0.1, 0.2, 0.3]])

    vec = embed_text(
        "Engineering owns launch-readiness decisions.",
        config=_cfg(),
        client=client,
    )

    assert vec == [0.1, 0.2, 0.3]
    client.embed.assert_called_once()
    kwargs = client.embed.call_args.kwargs
    assert kwargs["model"] == "voyage-4"
    assert kwargs["input_type"] == "query"
    assert kwargs["texts"] == ["Engineering owns launch-readiness decisions."]


def test_embed_documents_uses_document_input_type():
    client = MagicMock()
    client.embed.return_value = SimpleNamespace(
        embeddings=[[1.0, 0.0], [0.0, 1.0]]
    )

    vectors = embed_documents(
        ["a", "b"],
        config=_cfg(),
        client=client,
    )

    assert len(vectors) == 2
    assert client.embed.call_args.kwargs["input_type"] == "document"


def test_embed_text_rejects_empty():
    with pytest.raises(ValueError, match="non-empty"):
        embed_text("  ", config=_cfg(), client=MagicMock())


def test_embed_text_missing_credentials():
    with pytest.raises(MissingCredentialsError, match="VOYAGE_API_KEY"):
        embed_text("hello", config=_cfg(voyage_api_key=None), client=None)


def test_embed_text_passes_output_dimension_when_configured():
    client = MagicMock()
    client.embed.return_value = SimpleNamespace(embeddings=[[0.5]])

    embed_text("hi", config=_cfg(embedding_dimension=1024), client=client)

    assert client.embed.call_args.kwargs["output_dimension"] == 1024
