# Precedent retrieval (Danny)

Core Chronicle module: **Voyage AI embeddings → candidate precedents** for Elmir's resolution engine.

> Retrieval supplies evidence.  
> The resolution engine owns the final applicability / resolution decision.

## Quick start

```bash
cd mongodb-hackathon
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
copy .env.example .env   # then add VOYAGE_API_KEY when ready

# Offline demo (no API key)
python scripts/demo_retrieval.py

# Unit tests (mocked / offline — no paid calls)
pytest -q

# Real Voyage integration (optional)
# set VOYAGE_API_KEY=...
python scripts/integration_voyage.py
python scripts/demo_retrieval.py --voyage
```

## Public API

```python
from retrieval import embed_text, find_matching_precedent

embed_text(text: str) -> list[float]

find_matching_precedent(conflict_text: str, project_id: str) -> list[PrecedentCandidate]
```

See **[INTEGRATION.md](../INTEGRATION.md)** for the Sahil/Elmir contract and  
**[ATLAS_SETUP.md](../ATLAS_SETUP.md)** for MongoDB Vector Search setup.

## Architecture

```
conflict_text + project_id
        │
        ▼
   embed_text (Voyage)     # or offline_embed in tests
        │
        ▼
   PrecedentStore.search   # memory (now) or Atlas (later)
        │  filtered by project_id
        ▼
   candidates + scores + scope metadata
        │
        ▼
   Elmir resolution engine (not this module)
```

Swap backends with `PRECEDENT_STORE=memory|atlas` — callers keep using the same function.
