"""
Chronicle — Precedent Retrieval (Danny)

Public API for Sahil (hosting) and Elmir (resolution engine):

    from retrieval import embed_text, find_matching_precedent

    candidates = find_matching_precedent(conflict_text, project_id)

Retrieval supplies scored candidate precedents + scope metadata.
The resolution engine owns the final applicability / resolution decision.
Similarity alone must not establish whether a precedent applies.
"""

from retrieval.embeddings import embed_text
from retrieval.models import PrecedentCandidate, PrecedentScope
from retrieval.retrieval import find_matching_precedent

__all__ = [
    "embed_text",
    "find_matching_precedent",
    "PrecedentCandidate",
    "PrecedentScope",
]

__version__ = "0.1.0"
