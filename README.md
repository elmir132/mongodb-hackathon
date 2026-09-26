# Chronicle — Self-Healing Project Memory

A memory harness for MongoDB's Harness Engineering & Model Wrangling Hackathon.

Chronicle tracks facts contributed by different people on a shared project, resolves
conflicting information using a resolution policy, and learns from human corrections
by storing them as precedents that apply to future conflicts. Visualized live through
the **Living Ledger**, a graph that shows what the harness knows and why it made
each decision.

Targets: **Long Horizon Engineering** (primary), **Recursive Harnessing** (secondary).

## Team & folders

| Folder | Owner | What it is |
|---|---|---|
| `resolution-engine/` | Elmir | Conflict detection, resolution logic, correction handling. Runs standalone against sample data. |
| `backend/` | Sahil | MongoDB Atlas setup, API endpoints, persistence, event streaming, hosts the retrieval module. |
| `frontend/` | Maxime | The Living Ledger graph, override UI, "Why this decision?" panel. |
| `retrieval/` | Danny | Voyage AI embeddings + Atlas Vector Search precedent lookup, then orchestration once the pieces connect. |

## Core loop

```
new fact -> conflict detected -> resolve (precedent, else policy)
         -> human correction -> new precedent + scoped policy update
         -> next similar conflict resolves automatically using the precedent
```

## Running the resolution engine standalone

```
cd resolution-engine
python3 resolution_engine.py
```

Runs the actual demo scenario end to end (marketing vs. engineering launch date
conflict) with no dependencies beyond the Python standard library.
