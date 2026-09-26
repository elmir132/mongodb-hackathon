from collections.abc import Callable
from typing import Any


class PrecedentRetrievalUnavailable(RuntimeError):
    pass


class DannyPrecedentRetriever:
    """Adapter for Danny's standalone retrieval.find_matching_precedent function."""

    def __init__(self, find_matching_precedent: Callable[..., Any] | None = None) -> None:
        self._find_matching_precedent = find_matching_precedent

    def retrieve(self, *, conflict_text: str, project_id: str) -> list[dict[str, Any]]:
        find_matching_precedent = self._find_matching_precedent
        if find_matching_precedent is None:
            try:
                from retrieval import find_matching_precedent
            except ImportError as error:
                raise PrecedentRetrievalUnavailable(
                    "Danny's retrieval module is not importable; install or add retrieval.py"
                ) from error

        candidates = find_matching_precedent(
            conflict_text,
            project_id,
            as_dicts=True,
        )
        if not isinstance(candidates, list):
            raise TypeError("find_matching_precedent(as_dicts=True) must return a list")
        return candidates
