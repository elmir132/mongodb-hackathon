# Chronicle — MongoDB Hackathon (Team 419)

Self-healing project memory: facts → conflicts → policy-based resolution → human correction → **precedents** → improved later resolutions, visualized in the Living Ledger.

## Branch: `danny/precedent-retrieval`

Danny's **precedent retrieval** module (Voyage AI + Atlas-ready store).

| Folder / area | Owner | Notes |
|---------------|-------|-------|
| `retrieval/` | Danny | **This branch** — embeddings + candidate retrieval |
| `resolution-engine/` | Elmir | On `main` — already adapted to Danny's candidate contract |
| `backend/` | Sahil | Atlas, API, hosts retrieval |
| `frontend/` | Maxime | Living Ledger |

See **[INTEGRATION.md](INTEGRATION.md)** for the Sahil/Elmir handoff (including Elmir's vocabulary mapping).

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
