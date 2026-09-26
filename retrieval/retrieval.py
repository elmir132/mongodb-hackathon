"""Core precedent retrieval entry points.

INTEGRATION CONTRACT (Sahil + Elmir)
------------------------------------
INPUT:
  conflict_text: str  — description of the conflicting claims / subject
  project_id: str     — scopes search; unrelated projects must not leak in

OUTPUT:
  list[PrecedentCandidate] (or list[dict] via as_dicts=True), each with:
    - precedent_id
    - score            (semantic similarity; evidence only)
    - scope            (project_id, topic, subject, tags, constraints)
    - reason           (stored correction / reasoning text)
    - text             (canonical precedent statement)

IMPORTANT:
  Retrieval supplies evidence.
  The resolution engine owns the final applicability / resolution decision.
  Similarity alone must NOT establish whether a precedent applies.

Sahil should host `find_matching_precedent` server-side (e.g. call from an
API handler). Elmir's engine consumes the returned candidates and decides.
"""

from __future__ import annotations

from typing import Any, Callable

from retrieval.config import RetrievalConfig
from retrieval.embeddings import embed_text
from retrieval.models import PrecedentCandidate, StoredPrecedent, candidates_to_dicts
from retrieval.seed_data import get_seed_precedents
from retrieval.store import InMemoryPrecedentStore, PrecedentStore, build_store

# Module-level default store so Sahil can call find_matching_precedent()
# without wiring DI on day one. Replace via configure_store() / load_seed_store().
_store: PrecedentStore | None = None
_embed_fn: Callable[..., list[float]] | None = None


def configure_store(store: PrecedentStore) -> None:
    """Inject a store (memory, Atlas, or test double)."""
    global _store
    _store = store


def configure_embed_fn(fn: Callable[..., list[float]] | None) -> None:
    """Inject an embedding function (used by unit tests to avoid paid API calls)."""
    global _embed_fn
    _embed_fn = fn


def get_store(config: RetrievalConfig | None = None) -> PrecedentStore:
    global _store
    if _store is None:
        _store = build_store(config)
    return _store


def reset_runtime() -> None:
    """Clear module-level wiring (tests)."""
    global _store, _embed_fn
    _store = None
    _embed_fn = None


def load_seed_store(
    *,
    use_voyage: bool = False,
    config: RetrievalConfig | None = None,
    client=None,
) -> InMemoryPrecedentStore:
    """Build an in-memory store from Chronicle demo seeds.

    use_voyage=True embeds with Voyage (needs VOYAGE_API_KEY).
    Otherwise uses deterministic offline embeddings so demos/tests run without
    paid API calls. Offline vectors are not a production substitute for Voyage.
    """
    cfg = config or RetrievalConfig.from_env()
    store = InMemoryPrecedentStore()
    seeds = get_seed_precedents()

    if use_voyage:
        from retrieval.embeddings import embed_documents

        vectors = embed_documents(
            [s.text for s in seeds],
            config=cfg,
            client=client,
        )
        for seed, vec in zip(seeds, vectors):
            seed.embedding = vec
            store.upsert(seed)
    else:
        from retrieval.offline_embed import offline_embed

        for seed in seeds:
            seed.embedding = offline_embed(seed.text)
            store.upsert(seed)

    configure_store(store)
    return store


def find_matching_precedent(
    conflict_text: str,
    project_id: str,
    *,
    top_k: int | None = None,
    min_score: float | None = None,
    config: RetrievalConfig | None = None,
    store: PrecedentStore | None = None,
    as_dicts: bool = False,
) -> list[PrecedentCandidate] | list[dict[str, Any]]:
    """Retrieve candidate precedents for a conflict within a project.

    This function does NOT decide which fact is correct and does NOT decide
    whether a precedent ultimately applies. It returns ranked candidates with
    similarity scores and scope metadata for Elmir's resolution engine.

    Args:
        conflict_text: Natural-language description of the conflict.
        project_id: Project scope filter (required).
        top_k: Max candidates to return (default from config).
        min_score: Minimum similarity threshold (default from config).
        config: Optional config override.
        store: Optional store override (else module default / env backend).
        as_dicts: If True, return plain dicts for easy JSON serialization.

    Returns:
        Ranked list of candidates (highest similarity first). Empty list when
        nothing useful is found in-scope.
    """
    if conflict_text is None or not str(conflict_text).strip():
        raise ValueError("conflict_text must be a non-empty string")
    if project_id is None or not str(project_id).strip():
        raise ValueError("project_id must be a non-empty string")

    # Normalize so padded IDs/text do not silently miss stored precedents.
    conflict_text = str(conflict_text).strip()
    project_id = str(project_id).strip()

    cfg = config or RetrievalConfig.from_env()
    active_store = store if store is not None else get_store(cfg)
    k = top_k if top_k is not None else cfg.top_k
    try:
        k = int(k)
    except (TypeError, ValueError) as exc:
        raise ValueError("top_k must be an integer >= 1") from exc
    if k < 1:
        raise ValueError("top_k must be an integer >= 1")

    threshold = min_score if min_score is not None else cfg.min_score
    try:
        threshold = float(threshold)
    except (TypeError, ValueError) as exc:
        raise ValueError("min_score must be a number") from exc

    if _embed_fn is not None:
        query_vec = _embed_fn(conflict_text)
    else:
        query_vec = embed_text(conflict_text, input_type="query", config=cfg)

    candidates = active_store.search(
        query_vec,
        project_id,
        top_k=k,
        min_score=threshold,
    )

    if as_dicts:
        return candidates_to_dicts(candidates)
    return candidates


# Re-export for callers that want the seed helper alongside retrieval.
__all__ = [
    "find_matching_precedent",
    "configure_store",
    "configure_embed_fn",
    "get_store",
    "reset_runtime",
    "load_seed_store",
    "StoredPrecedent",
]
