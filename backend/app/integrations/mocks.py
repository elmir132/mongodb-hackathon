from typing import Any


class EmptyPrecedentRetriever:
    """Development placeholder; it intentionally performs no retrieval."""

    def retrieve(self, *, conflict_text: str, project_id: str) -> list[dict[str, Any]]:
        return []


class PassthroughResolutionEngine:
    """Development placeholder; it intentionally applies no learning logic."""

    def resolve(
        self,
        *,
        facts: list[dict[str, Any]],
        precedents: list[dict[str, Any]],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        return {}
