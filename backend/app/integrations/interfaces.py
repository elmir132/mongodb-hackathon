from typing import Any, Protocol


class PrecedentRetriever(Protocol):
    def retrieve(self, *, conflict_text: str, project_id: str) -> list[dict[str, Any]]:
        """Return project-scoped precedent candidates for a conflict."""


class ResolutionEngine(Protocol):
    def resolve(
        self,
        *,
        facts: list[dict[str, Any]],
        precedents: list[dict[str, Any]],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        """Delegate state resolution to the teammate-owned engine."""
