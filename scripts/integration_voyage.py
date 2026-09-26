"""
Integration script: real Voyage AI embeddings (paid/network).

Usage:
    set VOYAGE_API_KEY=...
    python scripts/integration_voyage.py

Skipped automatically when VOYAGE_API_KEY is missing (exit code 0 with message)
so CI/unit workflows stay free of paid calls.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def main() -> int:
    if not os.getenv("VOYAGE_API_KEY"):
        print("VOYAGE_API_KEY not set — skipping Voyage integration script.")
        return 0

    from retrieval.embeddings import embed_text
    from retrieval.retrieval import find_matching_precedent, load_seed_store
    from retrieval.seed_data import CHRONICLE_DEMO_PROJECT, DEMO_CONFLICT_TEXT

    print("Embedding sample text with Voyage...")
    vec = embed_text("Engineering owns launch-readiness decisions.")
    print(f"  dims={len(vec)} first3={vec[:3]}")

    print("Building seed store with Voyage document embeddings...")
    load_seed_store(use_voyage=True)

    print("Querying with conflict text...")
    hits = find_matching_precedent(DEMO_CONFLICT_TEXT, CHRONICLE_DEMO_PROJECT)
    for h in hits:
        print(f"  {h.score:.4f}  {h.precedent_id}  :: {h.text}")

    if not hits:
        print("ERROR: expected at least one hit", file=sys.stderr)
        return 1

    if hits[0].precedent_id != "prec-launch-readiness-eng":
        print(
            "WARNING: launch-readiness precedent was not rank #1 "
            f"(got {hits[0].precedent_id}). Inspect scores above.",
            file=sys.stderr,
        )
        return 2

    print("OK — launch-readiness precedent ranked first.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
