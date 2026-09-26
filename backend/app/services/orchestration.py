from typing import Any

from app.integrations.interfaces import PrecedentRetriever, ResolutionEngine


class OrchestrationService:
    def __init__(self, repository, retriever: PrecedentRetriever, engine: ResolutionEngine) -> None:
        self.repository = repository
        self.retriever = retriever
        self.engine = engine

    def resolve_state(
        self,
        *,
        conflict_text: str,
        project_id: str,
        context: dict[str, Any],
    ) -> dict:
        facts = self.repository.list_facts()
        precedents = self.retriever.retrieve(
            conflict_text=conflict_text,
            project_id=project_id,
        )
        resolution_context = {
            **context,
            "conflict_text": conflict_text,
            "project_id": project_id,
        }
        value = self.engine.resolve(
            facts=facts,
            precedents=precedents,
            context=resolution_context,
        )
        return self.repository.save_state(value)
