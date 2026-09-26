# Chronicle — MongoDB Hackathon (Team 419)

Self-healing project memory: facts → conflicts → policy-based resolution → human correction → **precedents** → improved later resolutions, visualized in the Living Ledger.

## Current branch focus

`danny/precedent-retrieval` — Danny's **precedent retrieval** module (Phase 1, standalone).

| Teammate | Area | Status on this branch |
|----------|------|------------------------|
| Danny | Voyage embeddings + precedent retrieval | **Implemented (standalone)** |
| Sahil | Atlas, API, hosting retrieval | Not built here |
| Elmir | Conflict resolution engine | Not built here |
| Maxime | Living Ledger frontend | Not built here |

## Danny module docs

- [retrieval/README.md](retrieval/README.md) — how to run locally
- [INTEGRATION.md](INTEGRATION.md) — **contract for Sahil & Elmir**
- [ATLAS_SETUP.md](ATLAS_SETUP.md) — Vector Search schema & index for Sahil

## Environment

Copy `.env.example` → `.env` (gitignored). Never commit secrets.

| Variable | Purpose |
|----------|---------|
| `VOYAGE_API_KEY` | Voyage AI embeddings |
| `VOYAGE_EMBEDDING_MODEL` | Default `voyage-4` |
| `PRECEDENT_STORE` | `memory` (default) or `atlas` |
| `MONGODB_URI` | Atlas connection (backend only) |

## Quick commands

```bash
pip install -r requirements.txt
pytest -q
python scripts/demo_retrieval.py
```
