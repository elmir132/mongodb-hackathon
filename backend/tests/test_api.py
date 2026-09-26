from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.integrations.danny_retrieval import DannyPrecedentRetriever
from app.main import create_app


def make_client() -> TestClient:
    app = create_app(Settings(storage_mode="memory"))
    return TestClient(app)


def test_health_reports_explicit_memory_mode() -> None:
    with make_client() as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "storage_mode": "memory",
        "environment": "development",
    }


def test_fact_write_and_event_are_available_in_memory_mode() -> None:
    with make_client() as client:
        fact_response = client.post(
            "/facts",
            json={"subject": "Ada", "predicate": "role", "value": "engineer"},
        )
        facts = client.get("/facts")
        events = client.app.state.services.repository.list_events()

    assert fact_response.status_code == 201
    assert facts.json()[0]["subject"] == "Ada"
    assert events[0]["kind"] == "fact.created"


def test_fact_validation_rejects_confidence_outside_range() -> None:
    with make_client() as client:
        response = client.post(
            "/facts",
            json={
                "subject": "Ada",
                "predicate": "role",
                "value": "engineer",
                "confidence": 1.5,
            },
        )

    assert response.status_code == 422


def test_state_run_uses_integrations_and_keeps_override_separate() -> None:
    calls = {}

    class Retriever:
        def retrieve(self, *, conflict_text, project_id):
            calls["retrieval_args"] = (conflict_text, project_id)
            return [{"precedent_id": "p-1"}]

    class Engine:
        def resolve(self, *, facts, precedents, context):
            calls["engine_input"] = (facts, precedents, context)
            return {"decision": "review"}

    app = create_app(
        Settings(storage_mode="memory"), retriever=Retriever(), resolution_engine=Engine()
    )
    with TestClient(app) as client:
        client.post("/facts", json={"subject": "Ada", "predicate": "role", "value": "engineer"})
        resolved = client.post(
            "/state",
            json={
                "conflict_text": "Should this change be approved?",
                "project_id": "project-1",
                "context": {"case_id": "c-1"},
            },
        )
        override = client.post(
            "/override", json={"key": "decision", "value": "approve", "reason": "manual review"}
        )
        current = client.get("/state")

    facts, precedents, context = calls["engine_input"]
    assert calls["retrieval_args"] == ("Should this change be approved?", "project-1")
    assert facts[0]["subject"] == "Ada"
    assert precedents == [{"precedent_id": "p-1"}]
    assert context == {
        "case_id": "c-1",
        "conflict_text": "Should this change be approved?",
        "project_id": "project-1",
    }
    assert resolved.json()["revision"] == 1
    assert resolved.json()["value"] == {"decision": "review"}
    assert override.status_code == 201
    assert current.json()["overrides"] == {"decision": "approve"}


def test_danny_adapter_calls_exact_function_with_json_dicts() -> None:
    received = {}

    def fake_find_matching_precedent(conflict_text, project_id, *, as_dicts=False):
        received.update(
            conflict_text=conflict_text,
            project_id=project_id,
            as_dicts=as_dicts,
        )
        return [{"id": "precedent-1", "score": 0.92, "scope": {"type": "project"}}]

    adapter = DannyPrecedentRetriever(fake_find_matching_precedent)
    candidates = adapter.retrieve(conflict_text="conflict", project_id="project-2")

    assert received == {
        "conflict_text": "conflict",
        "project_id": "project-2",
        "as_dicts": True,
    }
    assert candidates[0]["score"] == 0.92


def test_atlas_mode_requires_voyage_key_for_real_retrieval() -> None:
    try:
        create_app(Settings(precedent_store="atlas"))
    except ValueError as error:
        assert "VOYAGE_API_KEY" in str(error)
    else:
        raise AssertionError("Atlas precedent retrieval should require a Voyage API key")


def test_legacy_chronicle_mongodb_setting_alias_is_accepted(monkeypatch) -> None:
    monkeypatch.setenv("CHRONICLE_MONGODB_URI", "mongodb+srv://user:pass@example.invalid")
    settings = Settings()

    assert settings.mongodb_uri == SecretStr("mongodb+srv://user:pass@example.invalid")


def test_danny_environment_names_are_accepted(monkeypatch) -> None:
    monkeypatch.setenv("PRECEDENT_STORE", "atlas")
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://user:pass@example.invalid")
    monkeypatch.setenv("MONGODB_DB", "chronicle_test")
    monkeypatch.setenv("MONGODB_PRECEDENTS_COLLECTION", "test_precedents")
    monkeypatch.setenv("MONGODB_VECTOR_INDEX", "test_vector_index")
    monkeypatch.setenv("VOYAGE_EMBEDDING_MODEL", "voyage-4")

    settings = Settings()

    assert settings.precedent_store == "atlas"
    assert settings.mongodb_uri == SecretStr("mongodb+srv://user:pass@example.invalid")
    assert settings.mongodb_database == "chronicle_test"
    assert settings.mongodb_precedents_collection == "test_precedents"
    assert settings.mongodb_vector_index == "test_vector_index"
    assert settings.voyage_embedding_model == "voyage-4"
