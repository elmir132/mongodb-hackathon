# Integration contract — Precedent retrieval (Danny → Sahil + Elmir)

**Retrieval supplies evidence. The resolution engine owns the final decision.**  
Similarity alone must **not** establish whether a precedent applies.

---

## Function Sahil should host / Elmir should call

```python
from retrieval import find_matching_precedent, load_seed_store, embed_text

# Until Atlas has real precedents with embeddings:
load_seed_store(use_voyage=True)  # needs VOYAGE_API_KEY

candidates = find_matching_precedent(conflict_text, project_id, as_dicts=True)
```

Prefer **`as_dicts=True`** for HTTP/JSON and for Elmir's `Precedent.from_candidate`.

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

- Injects a retriever with Danny's signature:  
  `retrieve(conflict_text, project_id, as_dicts=True)`
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

Shared demo project id: **`chronicle-demo`**.

At integration, Sahil/Elmir pass `retrieval.find_matching_precedent` into  
`resolve_conflict(..., retrieve=...)` instead of `make_stub_retriever`.

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

Suggested API shape (Sahil owns the HTTP layer):

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
