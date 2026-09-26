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

    def correct_state(
        self,
        *,
        correct_fact_id: str,
        reason: str,
        context: dict[str, Any],
    ) -> dict:
        """Human correction -> new precedent + versioned policy update, via
        the resolution engine (not the generic /override key-value store,
        which intentionally has no learning semantics — see mocks.py and
        test_state_run_uses_integrations_and_keeps_override_separate).
        Requires the engine to implement .correct(); PassthroughResolutionEngine
        does not, and this raises clearly rather than silently no-op'ing."""
        correct = getattr(self.engine, "correct", None)
        if correct is None:
            raise NotImplementedError(
                f"{self.engine.__class__.__name__} does not implement correct(); "
                "wire a real ResolutionEngine (e.g. ElmirResolutionEngine) to use corrections."
            )
        value = correct(correct_fact_id=correct_fact_id, reason=reason, context=context)
        return self.repository.save_state(value)
