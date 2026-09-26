"""Launch Sahil's canonical app with the root server-only environment."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
# Match the existing connected terminal unless an explicit mode was supplied.
if os.getenv('MONGODB_URI'):
    os.environ.setdefault('CHRONICLE_STORAGE_MODE', 'mongodb')
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'backend'))

if __name__ == '__main__':
    uvicorn.run('app.main:app', host='127.0.0.1', port=8000)
