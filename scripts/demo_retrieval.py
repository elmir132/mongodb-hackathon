"""
Standalone demo: retrieve candidates for the Chronicle launch-readiness conflict.

Offline (default, no API key needed):
    python scripts/demo_retrieval.py

With real Voyage embeddings:
    set VOYAGE_API_KEY=...
    python scripts/demo_retrieval.py --voyage
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow running without install: repo root on sys.path
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from retrieval.offline_embed import offline_embed
from retrieval.retrieval import configure_embed_fn, find_matching_precedent, load_seed_store
from retrieval.seed_data import CHRONICLE_DEMO_PROJECT, DEMO_CONFLICT_TEXT, OTHER_PROJECT


def main() -> int:
    parser = argparse.ArgumentParser(description="Chronicle precedent retrieval demo")
    parser.add_argument(
        "--voyage",
        action="store_true",
        help="Embed seeds + query with Voyage AI (requires VOYAGE_API_KEY)",
    )
    parser.add_argument(
        "--project-id",
        default=CHRONICLE_DEMO_PROJECT,
        help="Project scope for search",
    )
    args = parser.parse_args()

    print("Loading seed precedents...")
    if args.voyage:
        load_seed_store(use_voyage=True)
        # Use real Voyage for the query as well (default embed_text path)
    else:
        load_seed_store(use_voyage=False)
        configure_embed_fn(offline_embed)

    print(f"\nConflict:\n  {DEMO_CONFLICT_TEXT}")
    print(f"\nProject filter: {args.project_id}")
    print("\nCandidates (similarity evidence only - not an applicability verdict):\n")

    candidates = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        args.project_id,
        as_dicts=True,
    )
    print(json.dumps(candidates, indent=2))

    print("\n--- Project isolation check ---")
    other = find_matching_precedent(
        DEMO_CONFLICT_TEXT,
        OTHER_PROJECT,
        as_dicts=True,
    )
    print(f"Hits for unrelated project '{OTHER_PROJECT}': {len(other)}")
    for c in other:
        print(f"  - {c['precedent_id']} ({c['score']:.3f})")

    print(
        "\nReminder: Retrieval supplies evidence. "
        "Elmir's resolution engine owns the final decision."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
