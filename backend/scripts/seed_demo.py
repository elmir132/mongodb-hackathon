"""Seed a repeatable Chronicle demo dataset in Atlas.

Run from backend/ with the repository virtual environment active:
    python scripts/seed_demo.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import Settings
from app.main import create_app


PROJECT_ID = "chronicle-demo"
SEED_VERSION = "2026-09-26-v1"
SOURCE_PREFIX = f"{PROJECT_ID}:seed:{SEED_VERSION}"
SEED_MARKER_KEY = f"{PROJECT_ID}.seed_version"


def post_json(client: TestClient, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    response = client.post(path, json=payload)
    response.raise_for_status()
    return response.json()


def seed_facts(client: TestClient) -> tuple[int, int]:
    existing = client.get("/facts")
    existing.raise_for_status()
    existing_sources = {
        fact.get("source")
        for fact in existing.json()
        if fact.get("source", "").startswith(SOURCE_PREFIX)
    }

    recorded_at = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc).isoformat()
    facts = [
        {
            "subject": "Alice",
            "predicate": "role",
            "value": "Product Manager",
            "source": f"{SOURCE_PREFIX}:alice-role",
            "confidence": 0.95,
        },
        {
            "subject": "Bob",
            "predicate": "role",
            "value": "Engineering Lead",
            "source": f"{SOURCE_PREFIX}:bob-role",
            "confidence": 0.95,
        },
        {
            "subject": "launch",
            "predicate": "launch_date",
            "value": {
                "date": "2026-10-02",
                "weekday": "Friday",
                "reported_by": "Alice",
                "recorded_at": recorded_at,
            },
            "source": f"{SOURCE_PREFIX}:alice-launch-date",
            "confidence": 0.8,
        },
        {
            "subject": "launch",
            "predicate": "launch_date",
            "value": {
                "date": "2026-10-05",
                "weekday": "Monday",
                "reported_by": "Bob",
                "recorded_at": recorded_at,
            },
            "source": f"{SOURCE_PREFIX}:bob-launch-date",
            "confidence": 0.8,
        },
    ]

    inserted = 0
    for fact in facts:
        if fact["source"] not in existing_sources:
            post_json(client, "/facts", fact)
            inserted += 1
    return inserted, len(facts) - inserted


def run_resolution_workflow(client: TestClient) -> dict[str, Any]:
    state = client.get("/state")
    state.raise_for_status()
    if state.json().get("overrides", {}).get(SEED_MARKER_KEY) == SEED_VERSION:
        return {"status": "skipped", "reason": "seed marker already exists"}

    conflicts = [
        "The chronicle-demo launch date is reported as Friday, October 2, 2026 by Alice and Monday, October 5, 2026 by Bob.",
        "A similar chronicle-demo release date conflict needs review: Alice reports Friday, October 2, 2026 while Bob reports Monday, October 5, 2026.",
    ]
    responses = []
    for conflict_text in conflicts:
        response = client.post(
            "/state",
            json={
                "conflict_text": conflict_text,
                "project_id": PROJECT_ID,
                "context": {"seed_version": SEED_VERSION},
            },
        )
        if response.status_code >= 400:
            return {
                "status": "unavailable",
                "status_code": response.status_code,
                "detail": response.json().get("detail", "resolution workflow failed"),
                "completed_runs": len(responses),
            }
        responses.append(response.json())

    marker = post_json(
        client,
        "/override",
        {
            "key": SEED_MARKER_KEY,
            "value": SEED_VERSION,
            "reason": "Technical idempotency marker for the Chronicle demo seed; not a resolution or policy.",
        },
    )
    return {"status": "completed", "runs": len(responses), "marker": marker["key"]}


def atlas_counts(settings: Settings) -> dict[str, int]:
    client = MongoClient(settings.mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=10_000)
    try:
        database = client[settings.mongodb_database]
        facts = database.facts.count_documents({"source": {"$regex": f"^{SOURCE_PREFIX}"}})
        marker_overrides = database.overrides.count_documents({"key": SEED_MARKER_KEY})
        demo_events = database.events.count_documents(
            {
                "$or": [
                    {"data.fact.source": {"$regex": f"^{SOURCE_PREFIX}"}},
                    {"data.key": SEED_MARKER_KEY},
                ]
            }
        )
        return {
            "facts_for_demo_seed": facts,
            "states_in_collection": database.states.count_documents({}),
            "demo_seed_override_markers": marker_overrides,
            "events_for_demo_seed": demo_events,
            "precedents_for_demo_project": database[settings.mongodb_precedents_collection].count_documents(
                {"project_id": PROJECT_ID}
            ),
        }
    finally:
        client.close()


def main() -> None:
    settings = Settings()
    if settings.storage_mode != "mongodb":
        raise SystemExit("Refusing to seed: CHRONICLE_STORAGE_MODE is not mongodb (Atlas).")
    if settings.mongodb_uri is None:
        raise SystemExit("Refusing to seed: MONGODB_URI is missing.")

    app = create_app(settings)
    with TestClient(app) as client:
        health = client.get("/health")
        health.raise_for_status()
        health_body = health.json()
        if health_body["storage_mode"] != "mongodb":
            raise SystemExit("Refusing to seed: health check did not confirm mongodb storage.")

        inserted, skipped = seed_facts(client)
        workflow = run_resolution_workflow(client)
        counts = atlas_counts(settings)

    print(json.dumps({
        "storage": health_body["storage_mode"],
        "project_id": PROJECT_ID,
        "facts_inserted": inserted,
        "facts_already_present": skipped,
        "resolution_workflow": workflow,
        "policy": {
            "status": "missing",
            "reason": "No policy schema or initializer exists in the current backend; nothing was fabricated.",
        },
        "atlas_counts": counts,
        "audit": {
            "retrieval": "depends on Danny's importable retrieval module and Atlas vector index",
            "resolution": "depends on a real ResolutionEngine; current default is passthrough",
            "correction_to_precedent": "not implemented in this backend",
        },
    }, indent=2))


if __name__ == "__main__":
    main()