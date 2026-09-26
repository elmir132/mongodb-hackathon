"""Precedent storage backends.

Standalone mode uses an in-memory store with cosine similarity so Danny's
module runs without waiting on Atlas. AtlasVectorStore is the drop-in target
once Sahil provisions the cluster and vector index.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from typing import Iterable

from retrieval.config import RetrievalConfig
from retrieval.models import PrecedentCandidate, StoredPrecedent


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


class PrecedentStore(ABC):
    """Abstract store: swap memory ↔ Atlas without changing callers."""

    @abstractmethod
    def upsert(self, precedent: StoredPrecedent) -> None:
        raise NotImplementedError

    @abstractmethod
    def upsert_many(self, precedents: Iterable[StoredPrecedent]) -> None:
        raise NotImplementedError

    @abstractmethod
    def search(
        self,
        query_embedding: list[float],
        project_id: str,
        *,
        top_k: int = 5,
        min_score: float = 0.0,
    ) -> list[PrecedentCandidate]:
        """Return scored candidates scoped to project_id.

        MUST filter by project_id so unrelated projects cannot leak in.
        Scores are similarity evidence only — not applicability verdicts.
        """
        raise NotImplementedError


class InMemoryPrecedentStore(PrecedentStore):
    """Temporary store for standalone development and unit tests."""

    def __init__(self) -> None:
        self._by_id: dict[str, StoredPrecedent] = {}

    def clear(self) -> None:
        self._by_id.clear()

    def upsert(self, precedent: StoredPrecedent) -> None:
        if precedent.embedding is None:
            raise ValueError(
                f"Precedent {precedent.precedent_id} is missing an embedding"
            )
        self._by_id[precedent.precedent_id] = precedent

    def upsert_many(self, precedents: Iterable[StoredPrecedent]) -> None:
        for p in precedents:
            self.upsert(p)

    def search(
        self,
        query_embedding: list[float],
        project_id: str,
        *,
        top_k: int = 5,
        min_score: float = 0.0,
    ) -> list[PrecedentCandidate]:
        scored: list[PrecedentCandidate] = []
        for precedent in self._by_id.values():
            if precedent.project_id != project_id:
                continue
            if precedent.embedding is None:
                continue
            score = cosine_similarity(query_embedding, precedent.embedding)
            if score < min_score:
                continue
            scored.append(precedent.to_candidate(score=score))

        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:top_k]


class AtlasPrecedentStore(PrecedentStore):
    """MongoDB Atlas Vector Search backend.

    Requires:
      - MONGODB_URI
      - vector search index (see INTEGRATION.md / ATLAS_SETUP.md)
      - documents with project_id + embedding fields
    """

    def __init__(self, config: RetrievalConfig | None = None) -> None:
        self.config = config or RetrievalConfig.from_env()
        if not self.config.mongodb_uri:
            raise RuntimeError(
                "MONGODB_URI is required when PRECEDENT_STORE=atlas. "
                "See ATLAS_SETUP.md for Sahil's setup checklist."
            )
        try:
            from pymongo import MongoClient
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "pymongo is required for Atlas store. "
                "Run: pip install -r requirements.txt"
            ) from exc

        self._client = MongoClient(self.config.mongodb_uri)
        self._collection = self._client[self.config.mongodb_db][
            self.config.precedents_collection
        ]

    def upsert(self, precedent: StoredPrecedent) -> None:
        doc = precedent.to_document()
        self._collection.update_one(
            {"_id": precedent.precedent_id},
            {"$set": doc},
            upsert=True,
        )

    def upsert_many(self, precedents: Iterable[StoredPrecedent]) -> None:
        for p in precedents:
            self.upsert(p)

    def search(
        self,
        query_embedding: list[float],
        project_id: str,
        *,
        top_k: int = 5,
        min_score: float = 0.0,
    ) -> list[PrecedentCandidate]:
        # Atlas Vector Search with pre-filter on project_id.
        # Index definition must include project_id as a filterable field.
        pipeline = [
            {
                "$vectorSearch": {
                    "index": self.config.vector_index_name,
                    "path": "embedding",
                    "queryVector": query_embedding,
                    "numCandidates": max(top_k * 20, 50),
                    "limit": top_k,
                    "filter": {"project_id": {"$eq": project_id}},
                }
            },
            {
                "$project": {
                    "_id": 1,
                    "precedent_id": 1,
                    "project_id": 1,
                    "text": 1,
                    "reason": 1,
                    "scope": 1,
                    "metadata": 1,
                    "topic": 1,
                    "subject": 1,
                    "tags": 1,
                    "constraints": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]

        results: list[PrecedentCandidate] = []
        for doc in self._collection.aggregate(pipeline):
            score = float(doc.get("score") or 0.0)
            if score < min_score:
                continue
            stored = StoredPrecedent.from_document(doc)
            # Ensure project filter held even if index misconfigured
            if stored.project_id != project_id:
                continue
            results.append(stored.to_candidate(score=score))
        return results


def build_store(config: RetrievalConfig | None = None) -> PrecedentStore:
    cfg = config or RetrievalConfig.from_env()
    if cfg.store_backend == "atlas":
        return AtlasPrecedentStore(cfg)
    return InMemoryPrecedentStore()
