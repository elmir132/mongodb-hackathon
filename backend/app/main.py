import logging
import sys
import traceback
from pathlib import Path

# Shared team modules live at the repository root.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.api.ledger import router as ledger_router
from app.config import Settings
from app.db.memory import MemoryRepository
from app.db.mongo import MongoRepository
from app.integrations.danny_retrieval import DannyPrecedentRetriever
from app.integrations.elmir_engine import ElmirResolutionEngine
from app.integrations.mocks import EmptyPrecedentRetriever, PassthroughResolutionEngine
from app.services.container import Services
from app.services.orchestration import OrchestrationService

logger = logging.getLogger("chronicle")


def create_app(
    settings: Settings | None = None,
    repository=None,
    retriever=None,
    resolution_engine=None,
) -> FastAPI:
    settings = settings or Settings()
    if repository is None:
        if settings.storage_mode == "mongodb":
            if settings.mongodb_uri is None:
                raise ValueError("MONGODB_URI is required in mongodb storage mode")
            repository = MongoRepository(
                settings.mongodb_uri.get_secret_value(), settings.mongodb_database
            )
        else:
            repository = MemoryRepository()

    using_mock_retriever = retriever is None and settings.precedent_store == "memory"
    if retriever is None:
        if settings.precedent_store == "atlas":
            if settings.voyage_api_key is None:
                raise ValueError("VOYAGE_API_KEY is required when PRECEDENT_STORE=atlas")
            retriever = DannyPrecedentRetriever()
        else:
            retriever = EmptyPrecedentRetriever()
    resolution_engine = resolution_engine or ElmirResolutionEngine()
    services = Services(
        repository=repository,
        orchestration=OrchestrationService(repository, retriever, resolution_engine),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        repository.initialize()
        if settings.storage_mode == "memory":
            logger.warning(
                "CHRONICLE DEVELOPMENT MODE: using process-local memory; data will be lost on restart"
            )
        if using_mock_retriever:
            logger.warning("Using the empty precedent retrieval mock (PRECEDENT_STORE=memory)")
        if resolution_engine.__class__ is PassthroughResolutionEngine:
            logger.warning("Using the passthrough resolution mock")
        yield
        repository.close()

    app = FastAPI(title="Chronicle API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.services = services
    app.include_router(router)
    app.include_router(ledger_router)

    @app.middleware("http")
    async def ledger_boundary(request, call_next):
        if not (request.url.path.startswith("/api/ledger/") or request.url.path in ("/state", "/state/correct")):
            return await call_next(request)
        from starlette.responses import JSONResponse
        origin = request.headers.get("origin")
        if origin and origin not in ("http://127.0.0.1:5173", "http://localhost:5173"):
            return JSONResponse({"detail": "Local same-origin access only."}, status_code=403)
        try:
            return await call_next(request)
        except Exception as failure:
            # Driver/provider errors can contain credentials; never echo them.
            frames = traceback.extract_tb(failure.__traceback__)
            logger.error('Service failure: %s at %s', type(failure).__name__,
                         ' > '.join(f'{Path(frame.filename).name}:{frame.lineno}' for frame in frames[-5:]))
            if getattr(failure, 'http_status', None) == 429:
                return JSONResponse({"detail": "An upstream service is rate-limiting requests. Wait and retry. No completion was confirmed."}, status_code=429)
            return JSONResponse({"detail": "Service request failed. Check server credentials, Atlas access, and the vector index. No completion was confirmed."}, status_code=503)
    return app


app = create_app()
