"""Create the required vector index if absent; never replaces existing indexes."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
from pymongo import MongoClient
from pymongo.operations import SearchIndexModel
from retrieval.config import RetrievalConfig

cfg = RetrievalConfig.from_env()
if not cfg.mongodb_uri:
    raise SystemExit('Set MONGODB_URI in the server-only .env first.')
client = MongoClient(cfg.mongodb_uri, serverSelectionTimeoutMS=5000)
collection = client[cfg.mongodb_db][cfg.precedents_collection]
indexes = list(collection.list_search_indexes())
existing = next((item for item in indexes if item['name'] == cfg.vector_index_name), None)
if existing:
    print('Existing index:', existing['name'], 'status:', existing.get('status'), 'queryable:', existing.get('queryable'))
else:
    name = collection.create_search_index(SearchIndexModel(name=cfg.vector_index_name, type='vectorSearch', definition={
        'fields': [
            {'type': 'vector', 'path': 'embedding', 'numDimensions': cfg.embedding_dimension or 1024, 'similarity': 'cosine'},
            {'type': 'filter', 'path': 'project_id'},
        ],
    }))
    print('Created:', name, '(wait until queryable before running the live demo)')
