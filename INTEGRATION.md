# Integration contract — Precedent retrieval (Danny → Sahil + Elmir)

**Retrieval supplies evidence. The resolution engine owns the final decision.**  
Similarity alone must **not** establish whether a precedent applies.

---

## Function Sahil should host / Elmir should call

```python
from retrieval import find_matching_precedent

candidates = find_matching_precedent(conflict_text, project_id)
# or JSON-friendly:
candidates = find_matching_precedent(conflict_text, project_id, as_dicts=True)
```

Optional helpers:

```python
from retrieval import embed_text

vector = embed_text("some text")  # Voyage AI embedding
```

### INPUT

| Arg | Type | Meaning |
|-----|------|---------|
| `conflict_text` | `str` | Natural-language description of the conflicting claims |
| `project_id` | `str` | Project scope — **required filter**; other projects must not leak in |

Optional kwargs: `top_k`, `min_score`, `as_dicts=True`.

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
    "constraints": { "authority_source": "engineering" }
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
| `metadata` | Optional extras (policy version at creation, etc.) |

Empty list `[]` when nothing useful is in-scope.

---

## Ownership boundaries

| Owner | Responsibility |
|-------|----------------|
| **Danny (this module)** | Embed conflict text, query vector search (scoped by `project_id`), return scored candidates + scope metadata |
| **Elmir** | Decide whether a candidate **applies**, resolve the conflict, produce explanations citing precedent IDs |
| **Sahil** | Host this module server-side, persist precedents (with embeddings), provision Atlas + vector index, expose API |

---

## Hosting notes for Sahil

1. Install deps: `pip install -r requirements.txt`
2. Set env vars from `.env.example` (`VOYAGE_API_KEY`, later `MONGODB_URI`, etc.)
3. Call `find_matching_precedent` from your API handler (keep credentials off the frontend)
4. Switch `PRECEDENT_STORE=atlas` once the vector index exists (see `ATLAS_SETUP.md`)
5. Until Atlas is ready, `load_seed_store()` provides a standalone demo dataset

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
