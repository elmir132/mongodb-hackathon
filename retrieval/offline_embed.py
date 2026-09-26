"""Offline / test embedding helpers.

Unit tests must not require paid Voyage calls. These helpers produce
deterministic vectors that still separate the Chronicle demo cases enough
to exercise ranking and project filtering.
"""

from __future__ import annotations

import hashlib

# Lightweight concept features so demo wording variants cluster together.
_CONCEPT_TERMS: dict[str, tuple[str, ...]] = {
    "launch_ready": (
        "launch",
        "readiness",
        "ready",
        "deploy",
        "deployment",
        "ship",
        "release",
        "technically",
        "technical",
        "engineering",
        "product",
        "tuesday",
        "thursday",
        "friday",
        "monday",
    ),
    "budget": (
        "budget",
        "finance",
        "vendor",
        "spend",
        "approval",
        "cost",
        "money",
    ),
    "process": (
        "meeting",
        "notes",
        "action",
        "owners",
        "due",
        "documentation",
        "standup",
    ),
}


def _stable_token_hash(token: str) -> int:
    """Process-stable hash (unlike Python's salted hash())."""
    digest = hashlib.md5(token.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


def offline_embed(text: str, dims: int = 96) -> list[float]:
    """Deterministic feature embedding for tests and offline demos."""
    if dims < 32:
        raise ValueError("dims must be >= 32")

    lowered = text.lower()
    tokens = [
        t
        for t in "".join(ch if ch.isalnum() else " " for ch in lowered).split()
        if t
    ]
    vec = [0.0] * dims

    # Concept channels occupy the first slots for stable ranking in demos.
    concept_keys = list(_CONCEPT_TERMS.keys())
    for i, key in enumerate(concept_keys):
        terms = _CONCEPT_TERMS[key]
        hit = sum(1 for term in terms if term in lowered)
        if hit:
            vec[i] += float(hit)

    # Token hashing fills the remaining dimensions.
    for token in tokens:
        h = _stable_token_hash(token)
        idx = 16 + (h % (dims - 16))
        sign = 1.0 if (h & 1) == 0 else -1.0
        vec[idx] += sign

    norm = sum(v * v for v in vec) ** 0.5
    if norm == 0.0:
        return vec
    return [v / norm for v in vec]
