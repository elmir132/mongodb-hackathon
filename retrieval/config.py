"""Configuration for Danny's precedent retrieval module.

All secrets come from environment variables. Never hardcode credentials.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


@dataclass(frozen=True)
class RetrievalConfig:
    """Tunable settings isolated so model / store can change later."""

    voyage_api_key: str | None
    embedding_model: str
    embedding_dimension: int | None
    store_backend: str  # "memory" | "atlas"
    mongodb_uri: str | None
    mongodb_db: str
    precedents_collection: str
    vector_index_name: str
    top_k: int
    min_score: float

    @classmethod
    def from_env(cls) -> "RetrievalConfig":
        dim_raw = _env("VOYAGE_EMBEDDING_DIMENSION")
        top_k_raw = _env("PRECEDENT_TOP_K", "5")
        min_score_raw = _env("PRECEDENT_MIN_SCORE", "0.0")
        return cls(
            voyage_api_key=_env("VOYAGE_API_KEY"),
            embedding_model=_env("VOYAGE_EMBEDDING_MODEL", "voyage-4") or "voyage-4",
            embedding_dimension=int(dim_raw) if dim_raw else None,
            store_backend=(_env("PRECEDENT_STORE", "memory") or "memory").lower(),
            mongodb_uri=_env("MONGODB_URI"),
            mongodb_db=_env("MONGODB_DB", "chronicle") or "chronicle",
            precedents_collection=(
                _env("MONGODB_PRECEDENTS_COLLECTION", "precedents") or "precedents"
            ),
            vector_index_name=(
                _env("MONGODB_VECTOR_INDEX", "precedent_vector_index")
                or "precedent_vector_index"
            ),
            top_k=max(1, int(top_k_raw or "5")),
            min_score=float(min_score_raw or "0.0"),
        )


class MissingCredentialsError(RuntimeError):
    """Raised when required API credentials are not configured."""
