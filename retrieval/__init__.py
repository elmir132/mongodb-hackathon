"""
Chronicle — Precedent Retrieval (Danny)

Public API for Sahil (hosting) and Elmir (resolution engine):

    from retrieval import embed_text, find_matching_precedent, load_seed_store

    load_seed_store(use_voyage=True)  # until Atlas is ready
    candidates = find_matching_precedent(conflict_text, project_id)

Retrieval supplies scored candidate precedents + scope metadata.
The resolution engine owns the final applicability / resolution decision.
Similarity alone must not establish whether a precedent applies.
"""

from retrieval.config import MissingCredentialsError
from retrieval.embeddings import embed_text
from retrieval.models import PrecedentCandidate, PrecedentScope
from retrieval.retrieval import (
    configure_store,
    find_matching_precedent,
    load_seed_store,
)

__all__ = [
    "embed_text",
    "find_matching_precedent",
    "load_seed_store",
    "configure_store",
    "PrecedentCandidate",
    "PrecedentScope",
    "MissingCredentialsError",
]

__version__ = "0.1.0"
