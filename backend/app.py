"""
Chronicle backend (Sahil's module, wired by Elmir).

Owns: persistence, API endpoints, event streaming, hosting Danny's retrieval,
and calling Elmir's resolution engine. This is the piece that turns three
separately-working modules into one real system.

Storage: MongoDB Atlas when MONGODB_URI is set, otherwise an in-memory store —
same pattern Danny's retrieval package already uses for its own precedent
store, so the whole stack degrades gracefully to "runs anywhere, no setup"
and upgrades to "real Atlas" by setting one env var, no code change.

Run:
    cd backend
    ../backend-venv/bin/uvicorn app:app --reload --port 8000

Try it:
    curl -X POST localhost:8000/api/demo/reset
    curl -X POST localhost:8000/api/conflicts/resolve -H 'content-type: application/json' \
      -d '{"conflict_id":"c1","facts":[
            {"text":"The launch is Friday","source":"Marketing","subject":"launch"},
            {"text":"The launch moved to Monday","source":"Engineering","subject":"launch"}],
           "scope":"launch-readiness"}'
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# --- Import the real modules from their real locations, no copies. ---------
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))                      # for `retrieval` (Danny)
sys.path.insert(0, str(REPO_ROOT / "resolution-engine"))  # for `resolution_engine` (Elmir)

import resolution_engine as engine  # noqa: E402
from retrieval.retrieval import find_matching_precedent  # noqa: E402
from retrieval.store import build_store  # noqa: E402  (Atlas if MONGODB_URI set, else in-memory)


# ---------------------------------------------------------------------------
# App state — one demo project's worth of policy + precedents + facts + trace.
# In-memory even in "Atlas mode": Atlas backs precedents (Danny's store), while
# facts/resolutions/policy live here for now. Splitting persistence further is
# straightforward once this shape is proven; not worth the risk this late.
# ---------------------------------------------------------------------------

class DemoState:
    def __init__(self) -> None:
        self.policy = engine.demo_starting_policy()
        self.precedent_store: list[engine.Precedent] = []
        self.facts: dict[str, engine.Fact] = {}
        self.resolutions: dict[str, engine.Resolution] = {}
        self.trace: list[dict] = []
        self._vector_store = None

    def vector_store(self):
        if self._vector_store is None:
            self._vector_store = build_store()
        return self._vector_store

    def emit(self, stage: str, title: str, detail: str, **extra: Any) -> None:
        self.trace.append({"stage": stage, "title": title, "detail": detail, **extra})


STATE = DemoState()


def retrieve_fn(conflict_text: str, project_id: str, **kwargs):
    """Adapter handed to resolve_conflict(): calls Danny's real function against
    whichever store is active (Atlas if MONGODB_URI is set, else in-memory
    seed data), then merges in any precedents created live during this demo
    session (corrections made through this API, not yet embedded/upserted)."""
    kwargs.setdefault("as_dicts", True)
    kwargs.setdefault("store", STATE.vector_store())
    live = [p.to_stored_document() for p in STATE.precedent_store]
    live_as_candidates = [
        {"precedent_id": d["precedent_id"], "score": 1.0, "scope": d["scope"],
         "reason": d["reason"], "text": d["text"], "metadata": d["metadata"]}
        for d in live
    ]
    try:
        remote = find_matching_precedent(conflict_text, project_id, **kwargs)
    except Exception as exc:  # noqa: BLE001 — missing VOYAGE_API_KEY, etc: degrade, don't 500
        STATE.emit("retrieval-fallback", "Retrieval unavailable, using session precedents only", str(exc))
        remote = []
    return live_as_candidates + list(remote)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class FactIn(BaseModel):
    text: str
    source: str
    subject: str
    id: Optional[str] = None


class ResolveRequest(BaseModel):
    conflict_id: str
    facts: list[FactIn]
    scope: str
    project_id: str = engine.DEFAULT_PROJECT_ID


class CorrectionRequest(BaseModel):
    conflict_id: str
    correct_fact_id: str
    reason: str


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Chronicle backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    mode = "atlas" if os.environ.get("MONGODB_URI") else "in-memory"
    return {"status": "ok", "precedent_store": mode, "policy_version": STATE.policy.version}


@app.post("/api/demo/reset")
def reset_demo() -> dict:
    global STATE
    STATE = DemoState()
    return {"status": "reset", "policy_version": STATE.policy.version}


@app.post("/api/conflicts/resolve")
def resolve(req: ResolveRequest) -> dict:
    if len(req.facts) < 2:
        raise HTTPException(400, "A conflict needs at least two facts.")

    facts = [
        engine.Fact.new(text=f.text, source=f.source, subject=f.subject, project_id=req.project_id)
        for f in req.facts
    ]
    for f in facts:
        STATE.facts[f.id] = f

    STATE.emit("receive", "Facts received", f"{len(facts)} claims for scope '{req.scope}'.")
    try:
        resolution = engine.resolve_conflict(
            req.conflict_id, facts, STATE.policy, retrieve_fn, req.scope, req.project_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    STATE.resolutions[req.conflict_id] = resolution
    STATE.emit(
        "resolved" if resolution.status == "resolved" else "unresolved",
        "Resolution engine decided" if resolution.status == "resolved" else "Left unresolved",
        resolution.explanation,
    )

    return {
        "resolution": resolution.to_dict(),
        "facts": [f.to_dict() for f in facts],
        "trace": STATE.trace[-2:],
    }


@app.post("/api/conflicts/correct")
def correct(req: CorrectionRequest) -> dict:
    previous = STATE.resolutions.get(req.conflict_id)
    if previous is None:
        raise HTTPException(404, f"No resolution found for conflict_id={req.conflict_id!r}.")

    facts = [STATE.facts[fid] for fid in previous.supporting_fact_ids if fid in STATE.facts]
    try:
        result = engine.apply_correction(
            previous, facts, req.correct_fact_id, req.reason, STATE.policy, STATE.precedent_store,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    STATE.emit(
        "correction",
        "Human correction applied",
        f"{result.precedent.winning_source} now outranks {result.precedent.losing_source} "
        f"for '{previous.scope}'. Policy v{result.policy_update.previous_version} -> "
        f"v{result.policy_update.new_version}.",
    )

    return {
        **result.to_dict(),
        "policy_version": STATE.policy.version,
        "trace": STATE.trace[-1:],
    }


@app.get("/api/policy")
def get_policy() -> dict:
    return STATE.policy.snapshot()


@app.get("/api/trace")
def get_trace() -> dict:
    return {"trace": STATE.trace}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
