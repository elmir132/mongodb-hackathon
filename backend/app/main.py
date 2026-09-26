import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
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
    return app


app = create_app()
