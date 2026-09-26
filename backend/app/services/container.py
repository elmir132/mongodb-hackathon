from dataclasses import dataclass

from app.services.orchestration import OrchestrationService


@dataclass(frozen=True)
class Services:
    repository: object
    orchestration: OrchestrationService
