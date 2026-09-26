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
                "context": {"case_id": "c-1", "scope": "review", "subject": "Ada"},
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
        "case_id": "c-1", "scope": "review", "subject": "Ada",
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
        create_app(Settings(_env_file=None, precedent_store="atlas", voyage_api_key=None))
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


def test_full_chronicle_loop_through_real_engine() -> None:
    """End to end through the real ElmirResolutionEngine (not a test double):
    initial resolution -> human correction -> precedent applied automatically
    on a fresh, different conflict. This is the actual MVP loop the demo
    depends on, running through Sahil's real routes/repository."""
    from app.integrations.elmir_engine import ElmirResolutionEngine
    from app.integrations.mocks import EmptyPrecedentRetriever

    app = create_app(
        Settings(storage_mode="memory"),
        retriever=EmptyPrecedentRetriever(),
        resolution_engine=ElmirResolutionEngine(),
    )
    with TestClient(app) as client:
        client.post("/facts", json={
            "subject": "launch", "predicate": "date", "value": "Friday", "source": "Marketing",
        })
        client.post("/facts", json={
            "subject": "launch", "predicate": "date", "value": "Monday", "source": "Engineering",
        })

        r1 = client.post("/state", json={
            "conflict_text": "Marketing says Friday, Engineering says Monday",
            "project_id": "chronicle-demo",
            "context": {"scope": "launch-readiness", "subject": "launch", "conflict_id": "c1"},
        })
        assert r1.status_code == 200
        resolution_1 = r1.json()["value"]["resolution"]
        assert resolution_1["status"] == "resolved"
        # Starting policy: Marketing is the plausible-but-wrong default pick.
        # supporting_fact_ids[0] is Marketing's, [1] is Engineering's (creation order).
        engineering_fact_id = resolution_1["supporting_fact_ids"][1]
        correction = client.post("/state/correct", json={
            "correct_fact_id": engineering_fact_id,
            "reason": "Engineering owns launch readiness decisions.",
            "context": {"scope": "launch-readiness", "subject": "launch"},
        })
        assert correction.status_code == 200
        corr_value = correction.json()["value"]
        assert corr_value["resolution_changed"] is True
        assert corr_value["policy_version"] == 2
        precedent_id = corr_value["precedent"]["id"]

        client.post("/facts", json={
            "subject": "launch", "predicate": "date", "value": "Wednesday", "source": "Marketing",
        })
        client.post("/facts", json={
            "subject": "launch", "predicate": "date", "value": "Thursday", "source": "Engineering",
        })
        r2 = client.post("/state", json={
            "conflict_text": "Marketing says Wednesday, Engineering says Thursday",
            "project_id": "chronicle-demo",
            "context": {"scope": "launch-readiness", "subject": "launch", "conflict_id": "c2"},
        })
        resolution_2 = r2.json()["value"]["resolution"]
        assert resolution_2["applied_precedent_id"] == precedent_id, (
            "the correction should be applied automatically to a new, similar conflict"
        )


def test_correct_state_returns_501_without_a_real_engine() -> None:
    from app.integrations.mocks import EmptyPrecedentRetriever, PassthroughResolutionEngine

    app = create_app(
        Settings(storage_mode="memory"),
        retriever=EmptyPrecedentRetriever(),
        resolution_engine=PassthroughResolutionEngine(),
    )
    with TestClient(app) as client:
        response = client.post("/state/correct", json={
            "correct_fact_id": "whatever", "reason": "why", "context": {"scope": "launch-readiness", "subject": "launch"},
        })
    assert response.status_code == 501


def test_resolution_and_correction_require_context_keys():
    with make_client() as client:
        for context in ({}, {'scope': 'launch-readiness'}, {'subject': 'launch'}):
            resolution = client.post('/state', json={'conflict_text': 'Friday vs Monday', 'project_id': 'test', 'context': context})
            correction = client.post('/state/correct', json={'correct_fact_id': 'fact', 'reason': 'Readiness', 'context': context})
            assert resolution.status_code == 422
            assert correction.status_code == 422


def test_workspace_canonical_correction_learns_and_override_does_not(monkeypatch):
    from app.api import ledger
    from retrieval.offline_embed import offline_embed
    monkeypatch.delenv('MONGODB_URI', raising=False)
    monkeypatch.setattr(ledger, 'MEMORY', {})
    monkeypatch.setattr(ledger, 'STORES', {})
    embedding_calls = []
    def embedding(text, **kwargs):
        embedding_calls.append(kwargs['input_type'])
        return offline_embed(text)
    monkeypatch.setattr(ledger, 'embed_text', embedding)
    workspace = 'workspace-contract-test'
    facts = [
        {'id': 'm', 'subject': 'launch', 'scope': 'launch readiness', 'source': 'Marketing', 'text': 'Launch is Friday', 'value': 'Friday'},
        {'id': 'e', 'subject': 'launch', 'scope': 'launch readiness', 'source': 'Engineering', 'text': 'Launch is Monday', 'value': 'Monday'},
    ]
    context = {'workspace_id': workspace, 'conflict_id': 'c1', 'scope': 'launch-readiness', 'subject': 'launch', 'fact_ids': ['m', 'e']}
    with make_client() as client:
        assert client.post('/api/ledger/save', json={'workspaceId': workspace, 'state': {'facts': facts, 'notes': [], 'turns': []}}).status_code == 200
        first = client.post('/state', json={'project_id': workspace, 'conflict_text': 'Friday vs Monday', 'context': context})
        assert first.status_code == 200, first.text
        assert first.json()['value']['resolution']['selected_fact_id'] == 'm'
        assert embedding_calls == ['query'], 'Exactly one upstream retrieval; the engine must not embed again'
        client.post('/override', json={'key': 'readiness', 'value': 'Engineering', 'reason': 'Note only'})
        assert ledger.read(workspace)['policy']['version'] == 1
        corrected = client.post('/state/correct', json={'correct_fact_id': 'e', 'reason': 'Engineering owns readiness.', 'context': {**context, 'remember_authority': True}})
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()['value']['policy'] == 2
        assert corrected.json()['value']['retrievalReady'] is True
        assert embedding_calls == ['query', 'document']
        # All correction routes have moved to /state/correct.
        assert client.post('/api/ledger/correct', json={}).status_code == 404
        bad_context = client.post('/state/correct', json={'correct_fact_id': 'e', 'reason': 'wrong domain', 'context': {**context, 'scope': 'budget'}})
        assert bad_context.status_code == 400
        again = client.post('/state', json={'project_id': workspace, 'conflict_text': 'Friday vs Monday', 'context': {**context, 'conflict_id': 'c2'}})
        assert again.status_code == 200
        assert again.json()['value']['resolution']['applied_precedent_id'] == corrected.json()['value']['lesson']['id']
        assert embedding_calls == ['query', 'document', 'query']


def test_undated_claims_do_not_get_artificial_recency_from_iteration_order():
    from app.integrations.elmir_engine import ElmirResolutionEngine
    adapter = ElmirResolutionEngine(include_session_precedents=False)
    result = adapter.resolve(facts=[
        {'id': 'budget-m', 'subject': 'budget', 'predicate': 'amount', 'value': 100, 'source': 'Marketing'},
        {'id': 'budget-e', 'subject': 'budget', 'predicate': 'amount', 'value': 200, 'source': 'Engineering'},
    ], precedents=[], context={'scope': 'budget', 'subject': 'budget', 'project_id': 'test'})
    assert result['resolution']['status'] == 'unresolved'
    assert result['resolution']['selected_fact_id'] is None
