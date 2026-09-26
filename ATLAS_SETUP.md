# Atlas Vector Search setup (Danny ↔ Sahil)

Standalone mode (`PRECEDENT_STORE=memory`) works without Atlas.  
Production path for the hackathon demo uses **MongoDB Atlas Vector Search**.

## What Sahil needs to configure

1. **Atlas Hackathon Sandbox** cluster (from organizer email)
2. Database name: `chronicle` (or set `MONGODB_DB`)
3. Collection: `precedents` (or set `MONGODB_PRECEDENTS_COLLECTION`)
4. Connection string in backend env only: `MONGODB_URI` (never commit, never send to frontend)
5. Vector Search index named `precedent_vector_index` (or `MONGODB_VECTOR_INDEX`)

Also keep Danny's Voyage key server-side: `VOYAGE_API_KEY`.

## Expected precedent document schema

```json
{
  "_id": "prec-launch-readiness-eng",
  "precedent_id": "prec-launch-readiness-eng",
  "project_id": "chronicle-demo",
  "text": "Engineering owns launch-readiness decisions.",
  "reason": "Human override: engineering owns technical readiness...",
  "embedding": [0.01, 0.02, "... dims match Voyage model ..."],
  "scope": {
    "project_id": "chronicle-demo",
    "topic": "launch-readiness",
    "subject": "launch",
    "tags": ["launch-readiness", "engineering-authority"],
    "constraints": { "authority_source": "engineering" }
  },
  "metadata": {}
}
```

**Critical fields for retrieval**

| Field | Role |
|-------|------|
| `embedding` | Voyage vector; path used by the vector index |
| `project_id` | **Filterable** — search must scope by project |
| `text` / `reason` / `scope` | Returned to the resolution engine |

Embedding model default: `voyage-4` (override with `VOYAGE_EMBEDDING_MODEL`).  
Whatever dimension the chosen model emits must match the index `numDimensions`.

## Required Vector Search index

Create an Atlas Search / Vector Search index on `precedents` approximately like:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1024,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "project_id"
    }
  ]
}
```

> Confirm `numDimensions` against the Voyage model you pick (`voyage-4` default output is typically 1024 — verify in Voyage docs when flipping models).

Index name must match `MONGODB_VECTOR_INDEX` (default `precedent_vector_index`).

## Query shape this module issues

`AtlasPrecedentStore.search` runs `$vectorSearch` with:

- `path: "embedding"`
- `queryVector: <conflict embedding>`
- `filter: { project_id: { $eq: "<project_id>" } }`
- returns `vectorSearchScore` as `score`

## Score scale caveat (memory vs Atlas)

| Backend | Score meaning (approx.) |
|---------|-------------------------|
| `memory` | Raw cosine similarity, typically about `[-1, 1]` (often `~0–1` for related text) |
| `atlas` | Atlas `vectorSearchScore` for cosine indexes is typically about `[0, 1]` (often `(1 + cosine) / 2`) |

Do **not** assume the same `PRECEDENT_MIN_SCORE` threshold ports cleanly across backends.
Retune `min_score` after switching to Atlas. Ranking order within a single backend is what matters for the demo.

## Switchover steps

1. Sahil creates collection + index
2. When precedents are saved (correction flow), embed `text` with `embed_text(..., input_type="document")` or `embed_documents` and store the vector
3. Set backend env:
   ```
   PRECEDENT_STORE=atlas
   MONGODB_URI=...
   VOYAGE_API_KEY=...
   ```
4. Call the same `find_matching_precedent(conflict_text, project_id)` — no caller rewrite

## Coordination checklist

- [ ] Agree on `project_id` string format
- [ ] Agree on Voyage model + embedding dimensions
- [ ] Agree on index name and filter field (`project_id`)
- [ ] Embeddings written on precedent insert/update (Danny can help wire once correction flow exists)
- [ ] Newly saved precedents available before the next demo step (MVP criterion)
