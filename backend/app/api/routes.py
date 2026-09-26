import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pymongo.errors import PyMongoError

from app.models.schemas import (
    EventResponse,
    FactCreate,
    FactResponse,
    HealthResponse,
    OverrideCreate,
    OverrideResponse,
    StateCorrectRequest,
    StateResponse,
    StateRunRequest,
)
from app.integrations.danny_retrieval import PrecedentRetrievalUnavailable

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    services = request.app.state.services
    try:
        storage_available = services.repository.health_check()
    except PyMongoError as error:
        raise HTTPException(status_code=503, detail="Storage unavailable") from error
    if not storage_available:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    settings = request.app.state.settings
    return HealthResponse(
        status="ok", storage_mode=settings.storage_mode, environment=settings.app_env
    )


@router.post("/facts", response_model=FactResponse, status_code=201)
def create_fact(payload: FactCreate, request: Request) -> dict:
    return request.app.state.services.repository.add_fact(payload.model_dump())


@router.get("/facts", response_model=list[FactResponse])
def list_facts(request: Request) -> list[dict]:
    return request.app.state.services.repository.list_facts()


@router.get("/state", response_model=StateResponse)
def get_state(request: Request) -> dict:
    return request.app.state.services.repository.get_state()


@router.post("/state", response_model=StateResponse)
def resolve_state(payload: StateRunRequest, request: Request) -> dict:
    try:
        return request.app.state.services.orchestration.resolve_state(
            conflict_text=payload.conflict_text,
            project_id=payload.project_id,
            context=payload.context,
        )
    except PrecedentRetrievalUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/state/correct", response_model=StateResponse)
def correct_state(payload: StateCorrectRequest, request: Request) -> dict:
    """Human correction -> real precedent + versioned policy update via the
    resolution engine. Distinct from POST /override, which is a plain
    key-value note with no learning semantics — see
    test_state_run_uses_integrations_and_keeps_override_separate."""
    try:
        return request.app.state.services.orchestration.correct_state(
            correct_fact_id=payload.correct_fact_id,
            reason=payload.reason,
            context=payload.context,
        )
    except NotImplementedError as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/override", response_model=OverrideResponse, status_code=201)
def set_override(payload: OverrideCreate, request: Request) -> dict:
    return request.app.state.services.repository.set_override(
        payload.key, payload.value, payload.reason
    )


@router.get("/events")
async def stream_events(request: Request, after_id: str | None = None) -> StreamingResponse:
    services = request.app.state.services
    poll_interval = request.app.state.settings.events_poll_interval
    cursor = after_id or request.headers.get("last-event-id")

    async def event_stream():
        nonlocal cursor
        while not await request.is_disconnected():
            events = await asyncio.to_thread(
                services.repository.list_events, after_id=cursor, limit=100
            )
            if events:
                for event in events:
                    cursor = event["id"]
                    response = EventResponse(**event)
                    yield f"id: {response.id}\nevent: {response.kind}\ndata: {response.model_dump_json()}\n\n"
            else:
                yield ": keep-alive\n\n"
                await asyncio.sleep(poll_interval)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
