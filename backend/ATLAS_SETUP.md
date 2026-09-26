# Atlas Precedent Retrieval Contract

This document is the coordination contract between Danny (Voyage embeddings and precedent retrieval) and Sahil (backend hosting/orchestration and persistence). The retrieval store is separate from Chronicle's facts/state/event collections, even when both use the same Atlas database.

## Ownership and Call Boundary

Danny owns `embed_text(text)` and `find_matching_precedent(conflict_text, project_id)`, including Voyage client setup, Atlas vector search, and the standalone fake-precedent test. Sahil's backend calls the agreed JSON form:

```python
from retrieval import find_matching_precedent

candidates = find_matching_precedent(
    conflict_text,
    project_id,
    as_dicts=True,
)
```

`POST /state` accepts `conflict_text`, `project_id`, and optional `context`; the adapter invokes the function above and hands its candidates to the supplied resolution engine. Candidates must be JSON-friendly dictionaries. Include a stable precedent ID, similarity score, and scope metadata so downstream resolution can inspect why a precedent matched.

## Environment

Keep all credentials in the backend `.env` file, which is git-ignored. Never commit or send the real API key or MongoDB URI.

```dotenv
PRECEDENT_STORE=atlas
VOYAGE_API_KEY=<Voyage API key>
VOYAGE_EMBEDDING_MODEL=voyage-4
MONGODB_URI=<Atlas connection string>
MONGODB_DB=chronicle
MONGODB_PRECEDENTS_COLLECTION=precedents
MONGODB_VECTOR_INDEX=precedents_vector_index
```

`PRECEDENT_STORE=memory` is the default development mode and uses the empty retrieval mock. Set `PRECEDENT_STORE=atlas` only after Danny's module and Atlas vector index are available. `VOYAGE_EMBEDDING_MODEL` defaults to `voyage-4`.

## Collection Document Contract

Collection name comes from `MONGODB_PRECEDENTS_COLLECTION` (default `precedents`). The coordinated document shape is:

```json
{
  "_id": "stable-precedent-id",
  "embedding": [0.12, -0.03],
  "project_id": "project identifier",
  "text": "precedent text",
  "reason": "why this precedent applies",
  "scope": {"type": "project or agreed scope", "metadata": {}}
}
```

The `embedding` field must be the full numeric vector returned by Voyage; the two values above are only a shortened example. Agree on the exact embedding model, vector dimensions, similarity metric, and scope-field shape before inserting real vectors. The index dimensions must exactly match the vector length returned by Danny's configured Voyage model.

## Atlas Vector Search Index

Create an Atlas Vector Search index on `MONGODB_PRECEDENTS_COLLECTION`, named by `MONGODB_VECTOR_INDEX` (default `precedents_vector_index`). `embedding` is the vector path; `project_id` must be a filterable field. Example definition; replace `<AGREED_VECTOR_DIMENSIONS>` with the confirmed embedding length and keep the index name in sync with both `.env` and Danny's retrieval code:

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

`1024` is an illustrative numeric value, not a dimension decision. Danny and Sahil must agree on the model's actual configured output dimensions and replace this value before creating the index. Retrieval must filter on `project_id` so a project's conflict does not match another project's precedent.

## Handoff Checklist

- Danny verifies embedding generation and nearest-precedent retrieval standalone against fake precedents.
- Danny and Sahil agree on model, dimensions, index name, database, collection, and scope metadata.
- Danny provides the importable `retrieval` module exposing the documented function signature.
- Sahil sets backend-only environment variables, enables `PRECEDENT_STORE=atlas`, and verifies `POST /state` reaches the adapter and resolution engine.
- Keep deterministic demo/fallback behavior available through `PRECEDENT_STORE=memory` until Atlas credentials and index are ready.