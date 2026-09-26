"""Frontend integration: project-scoped persistence and measured service receipts.

Uses the team's engine and retrieval implementation; no simulated candidates.
The workspace document is the commit point. Only committed precedent IDs may
influence a resolution, even if a separate vector upsert succeeded before a failure.
"""
from __future__ import annotations

import copy
import re
import threading
import time
import uuid
from datetime import date, datetime, timezone
from dataclasses import replace
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.integrations.elmir_engine import engine, ElmirResolutionEngine
from app.integrations.danny_retrieval import DannyPrecedentRetriever
from app.services.orchestration import OrchestrationService
from retrieval.config import RetrievalConfig
from retrieval.embeddings import embed_text
from retrieval.models import StoredPrecedent
from retrieval.retrieval import find_matching_precedent
from retrieval.store import build_store

router = APIRouter(prefix='/api/ledger')
LOCK = threading.RLock()
MEMORY: dict[str, dict] = {}
CLIENT = None
STORES = {}


def config():
    cfg = RetrievalConfig.from_env()
    return replace(cfg, store_backend='atlas' if cfg.mongodb_uri else 'memory')


def database():
    global CLIENT
    cfg = config()
    if not cfg.mongodb_uri:
        return None
    if CLIENT is None:
        from pymongo import MongoClient
        CLIENT = MongoClient(cfg.mongodb_uri, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)
    return CLIENT[cfg.mongodb_db]


def read(workspace):
    db = database()
    doc = db.workspaces.find_one({'_id': workspace}) if db is not None else MEMORY.get(workspace)
    if not doc:
        raise HTTPException(404, 'Workspace not found. Initialize a new workspace first.')
    return copy.deepcopy(doc)


def write(doc):
    db = database()
    if db is not None:
        db.workspaces.replace_one({'_id': doc['_id']}, doc, upsert=True)
    else:
        MEMORY[doc['_id']] = copy.deepcopy(doc)


def receipt(service, stage, title, start, *, route=None, input='', output='', **extra):
    return {'id': 'event-' + uuid.uuid4().hex, 'service': service, 'stage': stage,
            'title': title, 'operation': title, 'detail': output, 'inputSummary': input,
            'outputSummary': output, 'at': datetime.now(timezone.utc).isoformat(),
            'elapsedMs': round((time.perf_counter() - start) * 1000),
            'status': 'succeeded', **({'route': route} if route else {}), **extra}


def storage_service():
    return 'atlas' if config().mongodb_uri else 'storage'


def persist(doc, title, start=None, **extra):
    start = start or time.perf_counter()
    write(doc)
    return receipt(storage_service(), 'storage', title, start,
                   input='Project ' + doc['_id'], output=('MongoDB acknowledged' if config().mongodb_uri else 'Server memory only; not durable'),
                   collection='workspaces', projectId=doc['_id'], **extra)


class WorkspaceRequest(BaseModel):
    workspaceId: str = Field(pattern=r'^workspace-[a-zA-Z0-9-]{1,80}$')


class SaveRequest(WorkspaceRequest):
    state: dict[str, Any]
    operation: str = 'Save workspace'
    route: str | None = None


class ResolveRequest(WorkspaceRequest):
    conflictId: str
    factIds: list[str]
    scope: str


class CorrectRequest(WorkspaceRequest):
    conflictId: str
    requestId: str
    factId: str | None = None
    reason: str = ''
    rememberAuthority: bool = False


def normalize_authority_key(value):
    return re.sub(r'[\s_]+', '-', str(value or '').strip().lower())


def authority_attribute(fact):
    subject = normalize_authority_key(fact.get('subject'))
    fallback = 'date' if subject in ('launch', 'next-release') or normalize_authority_key(fact.get('scope')) == 'launch-readiness' else 'budget' if re.search(r'\bbudget\b', subject) else 'owner' if re.search(r'\bowner(?:ship)?\b', subject) else 'status' if re.search(r'\bstatus\b', subject) else 'value'
    return normalize_authority_key(fact.get('attribute') or fact.get('predicate') or fallback)


def authority_scope(fact):
    scope = normalize_authority_key(fact.get('scope'))
    subject = normalize_authority_key(fact.get('subject'))
    if scope in ('', 'other', 'general', 'project', 'unknown'):
        return f'claim:{subject}:{authority_attribute(fact)}' if subject else None
    attribute = authority_attribute(fact)
    return scope if attribute == 'value' or scope == attribute or scope.endswith(f':{attribute}') or (scope == 'launch-readiness' and attribute == 'date') else f'{scope}:{attribute}'


def evidence_scope(facts):
    scopes = {authority_scope(fact) for fact in facts}
    if len(scopes) != 1 or None in scopes or len({authority_attribute(f) for f in facts}) != 1:
        raise HTTPException(400, 'Conflict facts must share a meaningful scope and attribute.')
    if len({f.get('subject') for f in facts}) != 1:
        raise HTTPException(400, 'Conflict facts must share the same subject.')
    starts, ends = [], []
    for fact in facts:
        try:
            start = date.fromisoformat(fact['validFrom']) if fact.get('validFrom') else None
            end = date.fromisoformat(fact['validTo']) if fact.get('validTo') else None
        except (TypeError, ValueError):
            raise HTTPException(400, 'Fact validity must use calendar dates.')
        if start:
            starts.append(start)
        if end:
            ends.append(end)
    if starts and ends and max(starts) > min(ends):
        raise HTTPException(400, 'Conflict facts must have overlapping validity periods.')
    return scopes.pop()


REPORTER_NAME = r'[A-Za-z][A-Za-z0-9 &-]{0,59}?'
REPORTING_VERB = r'(?:says|said|reports|reported|states|stated|claims|claimed|thinks|believes|confirms|confirmed|insists)'


def reported_source(quote):
    text = re.sub(r'^(?:[-*]\s+|\d+[.)]\s+)', '', quote.strip())
    patterns = [rf'^({REPORTER_NAME})\s+{REPORTING_VERB}\s+',
                rf'^According to\s+({REPORTER_NAME}),\s*',
                rf',\s*according to\s+({REPORTER_NAME})[.!]?\s*$',
                rf'^({REPORTER_NAME}):\s+']
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1).strip()
    return None


def reporter_count(quote):
    return len(re.findall(rf'\b{REPORTING_VERB}\b|\baccording to\b', quote, re.I)) or int(bool(reported_source(quote)))


def validate_claim_provenance(state):
    """Check retained evidence at the save boundary without reinterpreting it."""
    turns = {turn.get('id'): turn for turn in state['turns']}
    documents = {document.get('id'): document for document in state.get('documents', [])}
    for fact in state['facts']:
        provenance = fact.get('provenance') or {}
        if provenance.get('method') != 'model-extracted':
            continue
        quote = provenance.get('quote')
        turn = turns.get(provenance.get('turnId'))
        source_ref = provenance.get('sourceRef')
        if not isinstance(quote, str) or not quote.strip() or quote != fact.get('text') or not turn:
            raise HTTPException(400, 'Extracted claims require their original message and exact supporting quote.')
        record = turn
        text = turn.get('prompt')
        if isinstance(source_ref, str) and re.fullmatch(r'attachment:[0-9]+', source_ref):
            index = int(source_ref.split(':')[1])
            attachments = turn.get('attachments') or []
            record = documents.get(fact.get('documentId'))
            if not record or index >= len(attachments) or record.get('text') != attachments[index].get('text'):
                raise HTTPException(400, 'Extracted document claims must link to the retained attachment.')
            text = record.get('text')
        elif source_ref != 'prompt':
            raise HTTPException(400, 'Extracted claims require a recorded source reference.')
        if not isinstance(text, str) or quote not in text or record.get('source') != turn.get('source'):
            raise HTTPException(400, 'Extracted claim evidence and source must match the retained original.')
        reporter = provenance.get('reportedSource')
        if reporter is not None:
            retained_reporter = reported_source(quote)
            submitted = {'source': turn.get('source')}
            if turn.get('author'):
                submitted['author'] = turn['author']
            if (reporter != retained_reporter or fact.get('source') != reporter
                    or fact.get('author') or fact.get('submittedBy') != submitted
                    or reporter_count(quote) != 1):
                raise HTTPException(400, 'Reported claims require explicit attribution and a separate recorded submitter.')
        elif fact.get('source') != turn.get('source'):
            raise HTTPException(400, 'Extracted claim source must match its sender or explicit reported attribution.')
        context = provenance.get('contextQuote')
        if context is not None:
            # Both slices stay verbatim, including their internal line wraps;
            # only whitespace may separate the adjacent context and claim.
            adjacent = isinstance(context, str) and bool(context.strip()) and re.search(
                re.escape(context) + r'(?:\s+|;\s*|,?\s+(?i:and|but|while|whereas)\s+)' + re.escape(quote), text)
            if not reporter or not adjacent:
                raise HTTPException(400, 'Shorthand claims require the immediately preceding source passage.')


def saved_lessons(doc):
    lessons = copy.deepcopy(doc.get('lessons') or {})
    legacy = doc.get('lesson')
    if legacy and legacy.get('id'):
        lessons.setdefault(legacy['id'], legacy)
    return lessons



def active_precedent_ids(doc):
    # Keep every saved version, but a newer authority for the same domain
    # supersedes its older ranking. Vector similarity must not reverse that.
    lessons = saved_lessons(doc)
    latest = {}
    for precedent_id in doc['precedentIds']:
        lesson = lessons.get(precedent_id)
        if lesson:
            latest[normalize_authority_key(lesson.get('scope'))] = precedent_id
    return [precedent_id for precedent_id in doc['precedentIds']
            if precedent_id not in lessons or latest[normalize_authority_key(lessons[precedent_id].get('scope'))] == precedent_id]


def response_lessons(doc, applied=None):
    lessons = saved_lessons(doc)
    # A decision that applies an older domain must show that domain's evidence.
    return {'lessons': lessons, 'lesson': lessons.get(applied) if applied else doc.get('lesson')}


def public(doc):
    state = copy.deepcopy(doc['state'])
    state['policy'] = doc['policy']['version']
    state.update(response_lessons(doc))
    return state


def engine_fact(f, project):
    stamp = f.get('sourceDate') or f.get('createdAt') or datetime.now(timezone.utc).isoformat()
    return engine.Fact(id=f['id'], text=f['text'], source=f['source'], subject=f['subject'],
                       project_id=project, timestamp=datetime.fromisoformat(stamp.replace('Z', '+00:00')).replace(tzinfo=timezone.utc))


@router.get('/status')
def status():
    cfg = config()
    return {'engine': 'python', 'storage': 'atlas' if cfg.mongodb_uri else 'server-memory',
            'voyageConfigured': bool(cfg.voyage_api_key), 'embeddingModel': cfg.embedding_model,
            'vectorIndex': cfg.vector_index_name, 'atlasConfigured': bool(cfg.mongodb_uri)}


@router.post('/load')
def load(req: WorkspaceRequest):
    with LOCK:
        try:
            doc = read(req.workspaceId)
            return {'state': public(doc), 'services': status()}
        except HTTPException as exc:
            if exc.status_code == 404:
                return {'state': None, 'services': status()}
            raise


@router.post('/save')
def save(req: SaveRequest):
    with LOCK:
        started = time.perf_counter()
        if not all(isinstance(req.state.get(k), list) for k in ('facts', 'turns', 'notes')):
            raise HTTPException(400, 'Invalid workspace records.')
        validate_claim_provenance(req.state)
        try:
            doc = read(req.workspaceId)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            doc = {'_id': req.workspaceId, 'policy': engine.demo_starting_policy().snapshot(),
                   'resolutions': {}, 'corrections': {}, 'precedentIds': [], 'policyVersions': [], 'lesson': None, 'lessons': {}}
        doc['state'] = copy.deepcopy(req.state)
        doc['state']['policy'] = doc['policy']['version']
        doc['state'].update(response_lessons(doc))
        event = persist(doc, req.operation, started, route=req.route)
        return {'trace': [event], 'policy': doc['policy']['version'], **response_lessons(doc)}


class TracedStore:
    """Observe Danny's real store boundary without changing retrieval semantics."""
    def __init__(self, store, trace, committed, history_count=0):
        self.store, self.trace, self.committed = store, trace, committed
        self.history_count = history_count

    def search(self, vector, project_id, **kwargs):
        start = time.perf_counter()
        service = 'vector' if config().mongodb_uri else 'local'
        try:
            requested = kwargs.get('top_k', 5)
            # Historical versions remain indexed. Fetch enough real candidates
            # to filter retired versions before filling the caller's top-k.
            fetch_limit = min(100, max(requested, self.history_count))
            result = self.store.search(vector, project_id, **{**kwargs, 'top_k': fetch_limit})
        except Exception:
            self.trace.append({**receipt(service, 'search', 'Candidate search failed', start,
                route='search' if service == 'vector' else None,
                input=f'{len(vector)} dimensions · project filter {project_id}', output='No candidate result available'), 'status': 'failed'})
            raise
        candidates = [c for c in result if c.precedent_id in self.committed][:requested]
        self.trace.append(receipt(service, 'search', 'Atlas Vector Search' if service == 'vector' else 'In-memory candidate search', start,
            route='search' if service == 'vector' else None, input=f'{len(vector)} dimensions · project filter {project_id}',
            output=f'{len(candidates)} committed candidates; applicability not yet decided', candidates=[c.to_dict() for c in candidates],
            index=config().vector_index_name if service == 'vector' else None))
        return candidates


def vector_store():
    cfg = config()
    key = (cfg.store_backend, cfg.mongodb_db, cfg.precedents_collection)
    if key not in STORES:
        STORES[key] = build_store(cfg)
    return STORES[key]


def retrieve(text, project, trace, committed, history_count=0):
    def measured_embedding(query):
        started = time.perf_counter()
        try:
            vector = embed_text(query, input_type='query', config=config())
        except Exception:
            trace.append({**receipt('voyage', 'embedding', 'Voyage query failed', started, route='embed',
                input=f'{len(query)} characters · query', output='No embedding returned'), 'status': 'failed'})
            raise
        trace.append(receipt('voyage', 'embedding', 'Embed conflict query', started, route='embed',
            input=f'{len(query)} characters · query', output=f'{len(vector)} dimensions returned',
            model=config().embedding_model, dimensions=len(vector), inputType='query'))
        return vector
    return find_matching_precedent(text, project, config=config(), embed_fn=measured_embedding,
        store=TracedStore(vector_store(), trace, committed, history_count), as_dicts=True)


def resolve(req: ResolveRequest):
    with LOCK:
        trace = []
        started = time.perf_counter()
        doc = read(req.workspaceId)
        if req.conflictId in doc['resolutions']:
            return doc['resolutions'][req.conflictId]
        by_id = {f['id']: f for f in doc['state']['facts']}
        if len(set(req.factIds)) < 2 or any(fid not in by_id for fid in req.factIds):
            raise HTTPException(400, 'Conflict requires at least two stored fact IDs.')
        stored_facts = [by_id[fid] for fid in req.factIds]
        if evidence_scope(stored_facts) != req.scope:
            raise HTTPException(400, 'Context scope must match the stored facts.')
        facts = [engine_fact(f, req.workspaceId) for f in stored_facts]
        trace.append(receipt(storage_service(), 'memory-read', 'Read saved conflict evidence', started,
            route='fact-write', input=f'{len(facts)} fact IDs', output=f'Policy v{doc["policy"]["version"]} + saved facts', factIds=req.factIds))
        def retrieval_fn(text, project, **kwargs):
            try:
                return retrieve(text, project, trace, active_precedent_ids(doc), len(doc['precedentIds']))
            except Exception:
                trace.append({**receipt('engine', 'retrieval-unavailable', 'Retrieval unavailable', time.perf_counter(),
                    output='Engine continues with stored policy; no candidates were invented.'), 'status': 'unavailable'})
                return []
        adapter = ElmirResolutionEngine(policy=engine.ResolutionPolicy.from_snapshot(doc['policy']), include_session_precedents=False)
        orchestration = OrchestrationService(None, DannyPrecedentRetriever(retrieval_fn), adapter)
        started = time.perf_counter()
        trace.append(receipt('engine', 'compare', 'Prepare stored conflict', started, route='recall', input=f'{len(facts)} stored facts', output='Backend orchestration retrieves candidates before the engine evaluates applicability'))
        value = orchestration.resolve_candidates(
            facts=[by_id[fid] for fid in req.factIds], conflict_text=engine.describe_conflict(facts),
            project_id=req.workspaceId, context={'scope': req.scope, 'subject': facts[0].subject, 'conflict_id': req.conflictId},
        )
        result = value['resolution']
        trace.append(receipt('engine', 'policy', 'Elmir’s resolution engine', started,
            route='candidates' if any(e['service'] == 'vector' and e['status'] == 'succeeded' for e in trace) else 'recall',
            input=f'{len(facts)} facts · policy v{result["policy_version"]}', output=result['explanation'],
            applied=result['applied_precedent_id'], selectedFactId=result['selected_fact_id'], factIds=req.factIds))
        payload = {'resolution': result, 'trace': trace, 'policy': doc['policy']['version'], **response_lessons(doc, result['applied_precedent_id'])}
        doc['resolutions'][req.conflictId] = copy.deepcopy(payload)
        trace.append(persist(doc, 'Save engine resolution', route='decision-write'))
        return payload


def correct(req: CorrectRequest):
    with LOCK:
        doc = read(req.workspaceId)
        # Idempotent retries must not create another policy version or embedding.
        if req.conflictId in doc['corrections']:
            return doc['corrections'][req.conflictId]
        previous = doc['resolutions'].get(req.conflictId, {}).get('resolution')
        if not previous:
            raise HTTPException(404, 'No saved engine resolution for this conflict.')
        if req.factId is not None and req.factId not in previous['supporting_fact_ids']:
            raise HTTPException(400, 'Choose a supporting fact or leave unresolved.')
        trace = []
        policy = engine.ResolutionPolicy.from_snapshot(doc['policy'])
        by_id = {f['id']: f for f in doc['state']['facts']}
        learned = None
        ready = None
        if req.rememberAuthority:
            supporting = [by_id[fid] for fid in previous['supporting_fact_ids'] if fid in by_id]
            if len(supporting) != len(previous['supporting_fact_ids']) or not req.factId:
                raise HTTPException(400, 'A scoped authority lesson requires complete saved evidence and a selected source.')
            scope = evidence_scope(supporting)
            source = str(by_id[req.factId].get('source') or '').strip()
            if scope != previous['scope'] or not source or source.lower() in ('unknown', 'you') or len({str(f.get('source') or '').strip().lower() for f in supporting}) < 2:
                raise HTTPException(400, 'Authority must name a recorded source within the saved conflict scope.')
            started = time.perf_counter()
            adapter = ElmirResolutionEngine(policy=policy, include_session_precedents=False)
            adapter.restore_resolution(previous, list(by_id.values()))
            result = adapter.correct(correct_fact_id=req.factId,
                reason=req.reason or f'{source} owns {scope} decisions for this project.',
                context={'scope': previous['scope'], 'subject': by_id[req.factId]['subject'], 'project_id': req.workspaceId})
            learned = engine.Precedent(**result['precedent'])
            # Explicit domain authority may cross subjects, but generic claims remain
            # limited to the subject and attribute encoded in their domain.
            learned.subject = None if not scope.startswith('claim:') else by_id[req.factId]['subject']
            trace.append(receipt('engine', 'policy', 'Convert human answer into scoped precedent', started,
                input=req.factId, output=f'Proposed policy v{policy.version} · {learned.id}', policyDiff=result['policy_update']['diff']))
            started = time.perf_counter()
            stored = StoredPrecedent.from_document(learned.to_stored_document())
            stored.embedding = embed_text(stored.text, input_type='document', config=config())
            trace.append(receipt('voyage', 'embedding', 'Embed saved precedent text', started, route='embed',
                input=f'{len(stored.text)} characters · document', output=f'{len(stored.embedding)} dimensions returned',
                model=config().embedding_model, dimensions=len(stored.embedding), inputType='document'))
            started = time.perf_counter()
            vector_store().upsert(stored)
            trace.append(receipt(storage_service(), 'precedent-write', 'Save precedent embedding', started,
                route='embedding-write', input=learned.id, output='Precedent upsert acknowledged', collection=config().precedents_collection))
            doc['precedentIds'].append(learned.id)
            doc['policyVersions'].append(result['policy_update'])
            doc['policy'] = policy.snapshot()
            doc['lessons'] = saved_lessons(doc)
            doc['lesson'] = {'id': learned.id, 'text': learned.text, 'reason': learned.reason,
                             'project': req.workspaceId, 'scope': scope, 'source': source,
                             'attribute': authority_attribute(by_id[req.factId]), 'subject': learned.subject}
            doc['lessons'] = saved_lessons(doc)
            # Check actual indexed availability; never substitute session candidates.
            started = time.perf_counter()
            ready = False
            deadline = time.monotonic() + 8
            while True:
                found = vector_store().search(stored.embedding, req.workspaceId, top_k=10)
                if any(c.precedent_id == learned.id for c in found):
                    ready = True
                    break
                if time.monotonic() >= deadline:
                    break
                time.sleep(.5)
            trace.append(receipt('vector' if config().mongodb_uri else 'local', 'readiness', 'Check precedent retrieval readiness', started,
                route='index-check' if config().mongodb_uri else None, input=learned.id,
                output='Precedent returned by search' if ready else 'Saved; indexing still pending', retrievalReady=ready))
        decision = {**previous, 'selected_fact_id': req.factId, 'applied_precedent_id': None,
                    'policy_version': policy.version, 'status': 'resolved' if req.factId else 'unresolved',
                    'explanation': req.reason or 'Explicit human answer; original engine resolution preserved.'}
        payload = {'resolution': decision, 'policy': policy.version, **response_lessons(doc),
                   'trace': trace, 'retrievalReady': ready}
        doc['corrections'][req.conflictId] = copy.deepcopy(payload)
        trace.append(persist(doc, 'Save human decision and policy version', route='decision-write'))
        return payload


def state_response(workspace_id, result):
    return {'revision': result['policy'], 'value': result, 'overrides': {},
            'updated_at': datetime.now(timezone.utc)}


def resolve_state(payload):
    context = payload.context
    workspace = context['workspace_id']
    if payload.project_id != workspace:
        raise HTTPException(400, 'Project ID must match the workspace.')
    doc = read(workspace)
    ids = context.get('fact_ids') or []
    if not context.get('conflict_id') or not isinstance(ids, list):
        raise HTTPException(400, 'Workspace resolution requires context.conflict_id and context.fact_ids.')
    chosen = [f for f in doc['state']['facts'] if f['id'] in ids]
    if not chosen or any(f['subject'] != context['subject'] for f in chosen):
        raise HTTPException(400, 'Context subject must match the stored facts.')
    if evidence_scope(chosen) != context['scope']:
        raise HTTPException(400, 'Context scope must match the stored facts.')
    req = ResolveRequest(workspaceId=workspace, conflictId=context['conflict_id'], factIds=ids, scope=context['scope'])
    return state_response(workspace, resolve(req))


def correct_state(payload):
    context = payload.context
    workspace = context['workspace_id']
    doc = read(workspace)
    previous = doc['resolutions'].get(context.get('conflict_id'), {}).get('resolution')
    if not previous:
        raise HTTPException(404, 'No saved resolution for this conflict.')
    facts = [f for f in doc['state']['facts'] if f['id'] in previous['supporting_fact_ids']]
    if previous['scope'] != context['scope'] or any(f['subject'] != context['subject'] for f in facts):
        raise HTTPException(400, 'Correction scope/subject must match the saved resolution.')
    req = CorrectRequest(workspaceId=workspace, conflictId=context['conflict_id'], requestId=context.get('request_id', context['conflict_id']),
        factId=payload.correct_fact_id, reason=payload.reason, rememberAuthority=context.get('remember_authority', False))
    return state_response(workspace, correct(req))
