# Integration contract — Precedent retrieval (Danny → Sahil + Elmir)

**Retrieval supplies evidence. The resolution engine owns the final decision.**  
Similarity alone must **not** establish whether a precedent applies.

---

## Live HTTP contract (Maxime + Danny + Sahil)

**Human learning corrections go to `POST /state/correct`. `POST /override` is
only a key-value note and does not create a precedent or change policy.**
Both resolution and correction require `context.scope` and `context.subject`.
Missing or empty keys return HTTP 422; a correction with mismatched saved
scope/subject is rejected. Do not infer a default domain.

```json
POST /state
{
  "conflict_text": "Marketing targets Friday; Engineering readiness is Monday.",
  "project_id": "chronicle-demo",
  "context": {"scope": "launch-readiness", "subject": "launch", "conflict_id": "c1"}
}
```

```json
POST /state/correct
{
  "correct_fact_id": "<supporting fact ID from the saved resolution>",
  "reason": "Engineering owns launch readiness.",
  "context": {"scope": "launch-readiness", "subject": "launch", "conflict_id": "c1"}
}
```

The terminal uses these same endpoints through the localhost Vite `/api` proxy.
For durable, isolated chats it additionally supplies `context.workspace_id`
(equal to `project_id`), `context.conflict_id`, and on resolve `context.fact_ids`.
Correction supplies `context.request_id` and `context.remember_authority`.
Only the explicit Engineering readiness choice sets `remember_authority: true`;
other choices preserve policy. `correct_fact_id: null` is the workspace UI’s
explicit leave-unresolved decision. Responses retain the `StateResponse`
envelope (`revision`, `value`, `overrides`, `updated_at`); workspace `value`
contains `resolution`, `policy`, `lesson`, ordered `trace`, and correction
`retrievalReady`. Workspace save/load are `/api/ledger/save` and
`/api/ledger/load`; there is no separate ledger correction endpoint.

## Actual retrieval call path

`POST /state` → backend orchestration → `DannyPrecedentRetriever.retrieve()` →
`find_matching_precedent()` → Voyage query embedding → Atlas Vector Search →
candidate dictionaries → `ElmirResolutionEngine.resolve(precedents=...)`.

**The engine adapter consumes the supplied candidates. It does not launch a
second retrieval call.** Its core engine callback returns that existing list.
The workspace path restores the durable policy and disables the generic
adapter’s session-local candidate shortcut. Only committed, actually searched
precedents may be used there; no fixed similarity scores are invented.

The same `OrchestrationService.resolve_candidates()` handles upstream retrieval
for generic state and workspace persistence. The workspace path wraps Danny’s
function and store boundaries solely to record measured receipts. Corrections
embed a new precedent as a document, persist it and the versioned policy, then
check actual index availability before reporting retrieval readiness.

## Function hosted behind DannyPrecedentRetriever

```python
# Called once by the upstream adapter, not again inside the resolution engine.
from retrieval import find_matching_precedent
candidates = find_matching_precedent(conflict_text, project_id, as_dicts=True)
```

Prefer `as_dicts=True` for HTTP/JSON and `Precedent.from_candidate`.
Offline/seed helpers are for labeled tests only; they are not the live pipeline.

### INPUT

| Arg | Type | Meaning |
|-----|------|---------|
| `conflict_text` | `str` | Natural-language description of the conflicting claims |
| `project_id` | `str` | Project scope — **required**, case-sensitive exact match after strip |

Optional kwargs: `top_k` (≥ 1), `min_score`, `as_dicts=True`.

Whitespace around `conflict_text` / `project_id` is stripped automatically.

### OUTPUT

A list of candidates (highest similarity first). Each item:

```json
{
  "precedent_id": "prec-launch-readiness-eng",
  "score": 0.91,
  "scope": {
    "project_id": "chronicle-demo",
    "topic": "launch-readiness",
    "subject": "launch",
    "tags": ["launch-readiness", "engineering-authority", "deploy"],
    "constraints": {
      "authority_source": "engineering",
      "overruled_source": "marketing"
    }
  },
  "reason": "Human override: when marketing and engineering disagree...",
  "text": "Engineering owns launch-readiness decisions.",
  "metadata": { "demo": true }
}
```

| Field | Meaning |
|-------|---------|
| `precedent_id` | Stable ID for citations in resolution payloads |
| `score` | Semantic similarity — **evidence only**, not an applicability verdict |
| `scope` | Project / topic / tags / constraints for Elmir's applicability check |
| `reason` | Stored human/system reasoning from the correction |
| `text` | Canonical precedent statement |
| `metadata` | Optional extras (`policy_version`, `created_from_conflict_id`, etc.) |

Empty list `[]` when nothing useful is in-scope.

---

## Ownership boundaries

| Owner | Responsibility |
|-------|----------------|
| **Danny (this module)** | Embed conflict text, query vector search (scoped by `project_id`), return scored candidates + scope metadata |
| **Elmir** | Decide whether a candidate **applies**, resolve the conflict, produce explanations citing precedent IDs |
| **Sahil** | Host this module server-side, persist precedents (with embeddings), provision Atlas + vector index, expose API |

---

## Status with Elmir on `main` (updated)

Elmir's resolution engine on `main` **already matches this contract**:

- The core engine accepts a retriever callback; in the live backend adapter it
  returns candidates already fetched by upstream orchestration
- Adapts candidates via `Precedent.from_candidate`
- Treats `score` as evidence only; applicability is decided in the engine

### Vocabulary mapping (keep these field names stable)

| Danny retrieval field | Elmir engine meaning |
|-----------------------|----------------------|
| `scope.topic` | policy domain / `scope` (e.g. `launch-readiness`) |
| `scope.subject` | `Fact.subject` (e.g. `launch`) |
| `constraints.authority_source` | `winning_source` |
| `constraints.overruled_source` | `losing_source` |
| `score` | similarity evidence only |

The generic seeded demo uses **`chronicle-demo`**. The terminal uses a stable
`workspace-*` ID as its project scope so resets and separate demo runs cannot
leak precedents into each other.

Do not pass a second live retrieval function into the engine from this backend.
`DannyPrecedentRetriever` has already fetched its `precedents` argument.

---

## Hosting notes for Sahil

1. Install deps: `pip install -r requirements.txt`
2. Set env vars from `.env.example` (`VOYAGE_API_KEY`, later `MONGODB_URI`, etc.)
   - This library reads `os.environ` only. Load `.env` in your host process
     (e.g. `python-dotenv`) or set variables in the process environment.
3. Call `find_matching_precedent(..., as_dicts=True)` from your API handler
   (keep credentials off the frontend)
4. **Memory backend is empty until seeded.** With default `PRECEDENT_STORE=memory`,
   you must call `load_seed_store(use_voyage=True)` (or `configure_store(...)`)
   or every search returns `[]`.
5. Switch `PRECEDENT_STORE=atlas` once the vector index exists (see `ATLAS_SETUP.md`)
   and precedents are stored **with embeddings**.
6. When persisting corrections, use Elmir's `Precedent.to_stored_document()` shape
   and fill `embedding` via `embed_text(..., input_type="document")` (or `embed_documents`).

Optional standalone retrieval API example (not a currently implemented route):

```http
POST /precedents/search
{ "conflict_text": "...", "project_id": "chronicle-demo", "top_k": 5 }
→ { "candidates": [ ... ] }
```

---

## Pipeline position

```
conflict text
    ↓
Voyage AI embedding          ← this module
    ↓
MongoDB Atlas Vector Search  ← this module (via store backend)
    ↓
candidate precedents         ← handed to Elmir
    ↓
resolution engine            ← Elmir (applicability + final decision)
```
