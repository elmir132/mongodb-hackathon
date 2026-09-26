"""Shared types for precedent retrieval candidates.

These shapes are the integration contract for Sahil (API hosting) and
Elmir (resolution engine). Adapt only by team agreement.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class PrecedentScope:
    """Scope metadata used by the resolution engine for applicability checks.

    Similarity retrieval returns this metadata; it does NOT decide applicability.
    Elmir's engine must verify the precedent actually applies given the conflict.
    """

    project_id: str
    topic: str | None = None
    subject: str | None = None
    # Free-form tags / constraints (e.g. "launch-readiness", "engineering-authority")
    tags: tuple[str, ...] = ()
    # Optional structured constraints the resolution engine may interpret
    constraints: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "topic": self.topic,
            "subject": self.subject,
            "tags": list(self.tags),
            "constraints": dict(self.constraints),
        }


@dataclass(frozen=True)
class PrecedentCandidate:
    """One retrieval hit handed to the resolution engine.

    Fields:
      precedent_id — stable ID for citations in resolution payloads
      score — semantic similarity (evidence only; not an applicability verdict)
      scope — project / topic / constraint metadata for applicability checks
      reason — stored human/system reasoning from when the precedent was created
      text — canonical precedent statement / correction text
    """

    precedent_id: str
    score: float
    scope: PrecedentScope
    reason: str
    text: str
    # Optional extras (source IDs, policy version at creation, etc.)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "precedent_id": self.precedent_id,
            "score": self.score,
            "scope": self.scope.to_dict(),
            "reason": self.reason,
            "text": self.text,
            "metadata": dict(self.metadata),
        }


@dataclass
class StoredPrecedent:
    """Internal representation of a precedent document (memory or Atlas)."""

    precedent_id: str
    project_id: str
    text: str
    reason: str
    embedding: list[float] | None = None
    topic: str | None = None
    subject: str | None = None
    tags: list[str] = field(default_factory=list)
    constraints: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_document(self) -> dict[str, Any]:
        """MongoDB-shaped document for Sahil's precedents collection."""
        doc = {
            "_id": self.precedent_id,
            "precedent_id": self.precedent_id,
            "project_id": self.project_id,
            "text": self.text,
            "reason": self.reason,
            "embedding": self.embedding,
            "scope": {
                "project_id": self.project_id,
                "topic": self.topic,
                "subject": self.subject,
                "tags": list(self.tags),
                "constraints": dict(self.constraints),
            },
            "metadata": dict(self.metadata),
        }
        return doc

    @classmethod
    def from_document(cls, doc: dict[str, Any]) -> "StoredPrecedent":
        scope = doc.get("scope") or {}
        return cls(
            precedent_id=str(doc.get("precedent_id") or doc.get("_id")),
            project_id=str(doc.get("project_id") or scope.get("project_id") or ""),
            text=str(doc.get("text") or ""),
            reason=str(doc.get("reason") or ""),
            embedding=doc.get("embedding"),
            topic=scope.get("topic", doc.get("topic")),
            subject=scope.get("subject", doc.get("subject")),
            tags=list(scope.get("tags") or doc.get("tags") or []),
            constraints=dict(scope.get("constraints") or doc.get("constraints") or {}),
            metadata=dict(doc.get("metadata") or {}),
        )

    def to_candidate(self, score: float) -> PrecedentCandidate:
        return PrecedentCandidate(
            precedent_id=self.precedent_id,
            score=score,
            scope=PrecedentScope(
                project_id=self.project_id,
                topic=self.topic,
                subject=self.subject,
                tags=tuple(self.tags),
                constraints=dict(self.constraints),
            ),
            reason=self.reason,
            text=self.text,
            metadata=dict(self.metadata),
        )


def candidates_to_dicts(candidates: list[PrecedentCandidate]) -> list[dict[str, Any]]:
    return [c.to_dict() for c in candidates]


# Silence unused import lint for asdict if re-exported later
_ = asdict
