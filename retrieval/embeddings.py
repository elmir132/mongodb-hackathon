"""Voyage AI embedding helpers for precedent retrieval."""

from __future__ import annotations

from typing import Sequence

from retrieval.config import MissingCredentialsError, RetrievalConfig


def _get_client(api_key: str | None):
    """Lazy-import voyageai so unit tests can mock without installing side effects."""
    try:
        import voyageai
    except ImportError as exc:  # pragma: no cover - env issue
        raise RuntimeError(
            "voyageai is not installed. Run: pip install -r requirements.txt"
        ) from exc

    if not api_key:
        raise MissingCredentialsError(
            "VOYAGE_API_KEY is not set. Add it to your environment or .env file. "
            "See .env.example."
        )
    return voyageai.Client(api_key=api_key)


def embed_text(
    text: str,
    *,
    input_type: str = "query",
    config: RetrievalConfig | None = None,
    client=None,
) -> list[float]:
    """Embed a single text string with Voyage AI.

    Args:
        text: Input text to embed.
        input_type: Voyage input type. Use "query" for conflict search text
            and "document" when indexing stored precedents.
        config: Optional config override (defaults to env).
        client: Optional pre-built voyageai.Client (useful for tests).

    Returns:
        Embedding vector as a list of floats.

    Raises:
        MissingCredentialsError: when VOYAGE_API_KEY is missing.
        ValueError: when text is empty.
    """
    if text is None or not str(text).strip():
        raise ValueError("text must be a non-empty string")

    cfg = config or RetrievalConfig.from_env()
    vo = client if client is not None else _get_client(cfg.voyage_api_key)

    kwargs: dict = {
        "texts": [str(text)],
        "model": cfg.embedding_model,
        "input_type": input_type,
    }
    if cfg.embedding_dimension is not None:
        kwargs["output_dimension"] = cfg.embedding_dimension

    result = vo.embed(**kwargs)
    embeddings = getattr(result, "embeddings", None)
    if not embeddings:
        raise RuntimeError("Voyage embed returned no embeddings")
    return list(embeddings[0])


def embed_documents(
    texts: Sequence[str],
    *,
    config: RetrievalConfig | None = None,
    client=None,
) -> list[list[float]]:
    """Embed multiple documents (input_type=document) for indexing."""
    if not texts:
        return []

    cfg = config or RetrievalConfig.from_env()
    vo = client if client is not None else _get_client(cfg.voyage_api_key)

    kwargs: dict = {
        "texts": [str(t) for t in texts],
        "model": cfg.embedding_model,
        "input_type": "document",
    }
    if cfg.embedding_dimension is not None:
        kwargs["output_dimension"] = cfg.embedding_dimension

    result = vo.embed(**kwargs)
    return [list(vec) for vec in result.embeddings]
