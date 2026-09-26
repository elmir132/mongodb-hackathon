"""Seed precedents reflecting the Chronicle MVP demo.

Used for standalone development so Danny's module does not depend on
Sahil finishing Atlas collections first.
"""

from __future__ import annotations

from retrieval.models import StoredPrecedent

# Canonical demo project used in the Chronicle walkthrough.
CHRONICLE_DEMO_PROJECT = "chronicle-demo"

# Unrelated project — used to verify project_id filtering.
OTHER_PROJECT = "acme-rebrand"


def get_seed_precedents() -> list[StoredPrecedent]:
    """Return a tiny demo dataset (embeddings filled later by the loader)."""
    return [
        StoredPrecedent(
            precedent_id="prec-launch-readiness-eng",
            project_id=CHRONICLE_DEMO_PROJECT,
            text="Engineering owns launch-readiness decisions.",
            reason=(
                "Human override: when marketing and engineering disagree on "
                "whether the product is ready to launch, engineering's "
                "assessment of technical readiness takes precedence."
            ),
            topic="launch-readiness",
            subject="launch",
            tags=["launch-readiness", "engineering-authority", "deploy"],
            # Matches Elmir's Precedents.to_stored_document / from_candidate mapping:
            # authority_source == winning_source, overruled_source == losing_source
            constraints={
                "authority_source": "engineering",
                "overruled_source": "marketing",
            },
            metadata={"demo": True, "scenario": "mvp-correction"},
        ),
        StoredPrecedent(
            precedent_id="prec-budget-finance",
            project_id=CHRONICLE_DEMO_PROJECT,
            text="Finance owns final budget approval for vendor spend over $10k.",
            reason=(
                "Correction after product approved a vendor without finance sign-off."
            ),
            topic="budget",
            subject="vendor-spend",
            tags=["budget", "finance-authority"],
            constraints={
                "authority_source": "finance",
                "overruled_source": "product",
            },
            metadata={"demo": True},
        ),
        StoredPrecedent(
            precedent_id="prec-meeting-notes-style",
            project_id=CHRONICLE_DEMO_PROJECT,
            text="Meeting notes should list action items with owners and due dates.",
            reason="Process preference captured after a messy standup write-up.",
            topic="process",
            subject="meeting-notes",
            tags=["process", "documentation"],
            constraints={},
            metadata={"demo": True},
        ),
        # Same topic wording but different project — must NOT appear when
        # searching chronicle-demo.
        StoredPrecedent(
            precedent_id="prec-other-project-launch",
            project_id=OTHER_PROJECT,
            text="Engineering owns launch-readiness decisions for the rebrand site.",
            reason="Project-specific exception for the Acme rebrand only.",
            topic="launch-readiness",
            subject="launch",
            tags=["launch-readiness", "engineering-authority"],
            constraints={
                "authority_source": "engineering",
                "overruled_source": "marketing",
            },
            metadata={"demo": True, "project_isolation": True},
        ),
    ]


# Conflict text used in demos / ranking tests (semantically similar wording).
DEMO_CONFLICT_TEXT = (
    "Product says we can deploy Tuesday, but engineering says "
    "the product will not be technically ready until Thursday."
)
