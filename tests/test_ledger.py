"""Integration contracts with isolated storage and deterministic test embeddings."""
import copy
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'resolution-engine'))
from app.api import ledger
from retrieval.offline_embed import offline_embed


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.delenv('MONGODB_URI', raising=False)
    monkeypatch.setattr(ledger, 'MEMORY', {})
    monkeypatch.setattr(ledger, 'STORES', {})
    monkeypatch.setattr(ledger, 'embed_text', lambda text, **kwargs: offline_embed(text))


def workspace(id='workspace-test'):
    state = {'facts': [
        {'id': 'marketing', 'text': 'Launch is Friday', 'source': 'Marketing', 'subject': 'launch', 'scope': 'launch readiness', 'sourceDate': '2026-09-26'},
        {'id': 'engineering', 'text': 'Launch is Monday', 'source': 'Engineering', 'subject': 'launch', 'scope': 'launch readiness', 'sourceDate': '2026-09-18'},
    ], 'notes': [], 'turns': [], 'policy': 999, 'lesson': {'id': 'client-forged'}}
    ledger.save(ledger.SaveRequest(workspaceId=id, state=state))
    return id


def resolve(id='workspace-test', conflict='c1', facts=None, scope='launch-readiness'):
    return ledger.resolve(ledger.ResolveRequest(workspaceId=id, conflictId=conflict,
        factIds=facts or ['marketing', 'engineering'], scope=scope))


def correct(id='workspace-test', remember=True, selected='engineering', request='answer1'):
    return ledger.correct(ledger.CorrectRequest(workspaceId=id, conflictId='c1', requestId=request,
        factId=selected, reason='Engineering owns readiness.', rememberAuthority=remember))


def test_stable_ids_authoritative_policy_and_candidate_receipts():
    workspace()
    initial = resolve()
    assert initial['resolution']['selected_fact_id'] == 'marketing'
    assert initial['policy'] == 1
    assert initial['lesson'] is None
    assert initial['resolution']['supporting_fact_ids'] == ['marketing', 'engineering']
    assert len({e['id'] for e in initial['trace']}) == len(initial['trace'])
    assert not any(e['service'] == 'atlas' for e in initial['trace'])
    assert any(e['stage'] == 'search' and e['candidates'] == [] for e in initial['trace'])


def test_correction_retrieval_reuse_scope_and_idempotent_retry():
    workspace()
    resolve()
    answer = correct()
    assert answer['policy'] == 2 and answer['retrievalReady'] is True
    assert correct(request='retry-new-client-id')['lesson']['id'] == answer['lesson']['id']
    doc = ledger.read('workspace-test')
    assert len(doc['policyVersions']) == 1
    # Simulate a fresh release; preserve project/domain but use a new subject.
    state = ledger.public(doc)
    for f in state['facts']:
        f['id'] += '-next'
        f['subject'] = 'next release'
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    second = resolve(conflict='c2', facts=['marketing-next', 'engineering-next'])
    assert second['resolution']['applied_precedent_id'] == answer['lesson']['id']
    assert second['resolution']['selected_fact_id'] == 'engineering-next'
    with pytest.raises(ledger.HTTPException) as exc:
        resolve(conflict='budget', facts=['marketing-next', 'engineering-next'], scope='budget')
    assert exc.value.status_code == 400
    workspace('workspace-other')
    assert resolve('workspace-other')['resolution']['applied_precedent_id'] is None


@pytest.mark.parametrize('selected', ['marketing', None])
def test_explicit_answer_without_lesson_keeps_original(selected):
    workspace()
    initial = resolve()
    answer = correct(remember=False, selected=selected)
    assert answer['policy'] == 1 and answer['lesson'] is None
    assert answer['resolution']['selected_fact_id'] == selected
    assert ledger.read('workspace-test')['resolutions']['c1']['resolution'] == initial['resolution']
    assert not any(e['service'] == 'voyage' for e in answer['trace'])


def test_failed_correction_write_cannot_publish_policy_or_uncommitted_vector(monkeypatch):
    workspace()
    resolve()
    before = ledger.read('workspace-test')
    original = ledger.write
    monkeypatch.setattr(ledger, 'write', lambda doc: (_ for _ in ()).throw(RuntimeError('write unavailable')))
    with pytest.raises(RuntimeError):
        correct()
    assert ledger.read('workspace-test') == before
    monkeypatch.setattr(ledger, 'write', original)
    # The orphan vector may exist, but cannot be supplied to the engine.
    second = resolve(conflict='c2')
    assert second['resolution']['applied_precedent_id'] is None
    assert second['policy'] == 1


def test_retrieval_failure_never_invents_candidates(monkeypatch):
    workspace()
    monkeypatch.setattr(ledger, 'embed_text', lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('provider unavailable')))
    result = resolve()
    assert result['resolution']['applied_precedent_id'] is None
    assert any(e['service'] == 'voyage' and e['status'] == 'failed' for e in result['trace'])
    assert not any(e['stage'] == 'search' for e in result['trace'])


def add_claims(workspace_id, subject, scope, suffix='', attribute=None):
    state = ledger.public(ledger.read(workspace_id))
    facts = [
        {'id': f'finance{suffix}', 'text': f'{subject} is $15000', 'value': '$15000', 'source': 'Finance', 'subject': subject, 'scope': scope, 'sourceDate': '2026-09-18'},
        {'id': f'marketing{suffix}', 'text': f'{subject} is $20000', 'value': '$20000', 'source': 'Marketing', 'subject': subject, 'scope': scope, 'sourceDate': '2026-09-26'},
    ]
    if attribute:
        values = {'date': ['October 5', 'October 2'], 'owner': ['Nadia', 'Owen'], 'status': ['blocked', 'approved']}.get(attribute, ['$15000', '$20000'])
        for fact, value in zip(facts, values):
            fact['attribute'] = attribute
            fact['value'] = value
            fact['text'] = f'{subject} {attribute} is {value}'
    state['facts'].extend(facts)
    ledger.save(ledger.SaveRequest(workspaceId=workspace_id, state=state))
    return [f['id'] for f in facts]


def test_second_domain_lesson_survives_reload_and_reports_correct_applied_evidence():
    workspace()
    resolve()
    launch_lesson = correct()['lesson']
    ids = add_claims('workspace-test', 'budget', 'other', '-budget')
    scope = 'claim:budget:budget'
    resolve(conflict='budget-1', facts=ids, scope=scope)
    budget = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='budget-1', requestId='b1', factId=ids[0], rememberAuthority=True))
    assert budget['policy'] == 3
    assert budget['lesson']['source'] == 'Finance'
    assert budget['lesson']['scope'] == scope
    reloaded = ledger.load(ledger.WorkspaceRequest(workspaceId='workspace-test'))['state']
    assert set(reloaded['lessons']) == {launch_lesson['id'], budget['lesson']['id']}
    again = resolve(conflict='launch-again')
    assert again['resolution']['applied_precedent_id'] == launch_lesson['id']
    assert again['lesson']['id'] == launch_lesson['id']
    new_ids = add_claims('workspace-test', 'budget', 'other', '-budget-next')
    reused = resolve(conflict='budget-again', facts=new_ids, scope=scope)
    assert reused['resolution']['applied_precedent_id'] == budget['lesson']['id']
    assert reused['lesson']['id'] == budget['lesson']['id']
    assert reused['resolution']['selected_fact_id'] == new_ids[0]
    retry = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='budget-1', requestId='retry', factId=ids[1], rememberAuthority=True))
    assert retry['lesson']['id'] == budget['lesson']['id']
    assert len(ledger.read('workspace-test')['policyVersions']) == 2
    other = add_claims('workspace-test', 'owner', 'other', '-owner')
    unrelated = resolve(conflict='owner', facts=other, scope='claim:owner:owner')
    assert unrelated['resolution']['applied_precedent_id'] is None
    assert ledger.read('workspace-test')['policy']['rules'][-1]['scope'] == scope
    workspace('workspace-other')
    other_ids = add_claims('workspace-other', 'budget', 'other', '-budget')
    assert resolve('workspace-other', conflict='budget', facts=other_ids, scope=scope)['resolution']['applied_precedent_id'] is None


def test_scope_is_derived_from_saved_evidence_and_attribute():
    workspace()
    ids = add_claims('workspace-test', 'budget', 'other', '-budget')
    with pytest.raises(ledger.HTTPException):
        resolve(conflict='too-broad', facts=ids, scope='other')
    state = ledger.public(ledger.read('workspace-test'))
    next(f for f in state['facts'] if f['id'] == ids[1])['attribute'] = 'owner'
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    with pytest.raises(ledger.HTTPException):
        resolve(conflict='mixed-attributes', facts=ids, scope='claim:budget:budget')
    assert ledger.authority_scope({'subject': 'release', 'scope': 'launch readiness', 'attribute': 'owner'}) == 'launch-readiness:owner'
    assert ledger.authority_scope({'subject': 'release', 'scope': 'launch readiness', 'attribute': 'date'}) == 'launch-readiness'


def test_plain_budget_answer_never_changes_authority():
    workspace()
    ids = add_claims('workspace-test', 'budget', 'other', '-budget')
    resolve(conflict='budget', facts=ids, scope='claim:budget:budget')
    result = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='budget', requestId='answer', factId=ids[0]))
    assert result['policy'] == 1
    assert result['lesson'] is None
    assert result['lessons'] == {}
    assert not any(event['service'] == 'voyage' for event in result['trace'])


def test_newer_authority_supersedes_older_retrieved_rule_without_deleting_history():
    workspace()
    resolve()
    first = correct()
    resolve(conflict='c2')
    second = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='c2', requestId='answer2', factId='marketing', rememberAuthority=True))
    assert second['policy'] == 3
    doc = ledger.read('workspace-test')
    assert len(doc['precedentIds']) == 2
    assert set(doc['lessons']) == {first['lesson']['id'], second['lesson']['id']}
    assert ledger.active_precedent_ids(doc) == [second['lesson']['id']]
    later = resolve(conflict='c3')
    assert later['resolution']['selected_fact_id'] == 'marketing'
    assert later['resolution']['applied_precedent_id'] == second['lesson']['id']
    assert later['lesson']['id'] == second['lesson']['id']
    assert doc['resolutions']['c1']['resolution']['selected_fact_id'] == 'marketing'


def test_latest_saved_authority_survives_retrieval_failure_without_claiming_precedent_use(monkeypatch):
    workspace()
    resolve()
    correct()
    resolve(conflict='c2')
    ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='c2', requestId='answer2', factId='marketing', rememberAuthority=True))
    monkeypatch.setattr(ledger, 'embed_text', lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('provider unavailable')))
    result = resolve(conflict='c3')
    assert result['policy'] == 3
    assert result['resolution']['selected_fact_id'] == 'marketing'
    assert result['resolution']['applied_precedent_id'] is None
    assert any(event['stage'] == 'retrieval-unavailable' for event in result['trace'])
    assert not any(event.get('applied') for event in result['trace'])


def test_explicit_domain_authority_does_not_cross_attributes():
    workspace()
    ids = add_claims('workspace-test', 'release plan', 'release planning', '-dates', 'date')
    resolve(conflict='dates', facts=ids, scope='release-planning:date')
    learned = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='dates', requestId='date-choice', factId=ids[0], rememberAuthority=True))
    assert learned['lesson']['scope'] == 'release-planning:date'
    # Same subject and domain, different attribute: no inherited Finance rule.
    owner_ids = add_claims('workspace-test', 'release plan', 'release planning', '-owners', 'owner')
    owner = resolve(conflict='owners', facts=owner_ids, scope='release-planning:owner')
    assert owner['resolution']['applied_precedent_id'] is None
    assert owner['resolution']['selected_fact_id'] != owner_ids[0]
    # A new subject can reuse an explicitly authorized domain for that attribute.
    next_ids = add_claims('workspace-test', 'next release plan', 'release planning', '-next', 'date')
    reused = resolve(conflict='next-plan', facts=next_ids, scope='release-planning:date')
    assert reused['resolution']['applied_precedent_id'] == learned['lesson']['id']
    assert reused['resolution']['selected_fact_id'] == next_ids[0]


def test_model_extracted_claims_require_retained_quote_and_source():
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    quote = 'Launch owner is Nadia.'
    turn = {'id': 'review', 'prompt': quote, 'source': 'Marketing', 'attachments': []}
    fact = {'id': 'extracted', 'subject': 'launch', 'attribute': 'owner', 'scope': 'launch readiness', 'source': 'Marketing', 'value': 'Nadia', 'text': quote,
            'provenance': {'method': 'model-extracted', 'turnId': turn['id'], 'sourceRef': 'prompt', 'quote': quote}}
    state['turns'].append(turn)
    state['facts'].append(fact)
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    for change in ({'text': 'Launch owner is Owen.'}, {'source': 'Engineering'}, {'provenance': {**fact['provenance'], 'turnId': 'missing'}}, {'provenance': {**fact['provenance'], 'quote': 'Owen'}}):
        invalid = copy.deepcopy(state)
        invalid['facts'][-1].update(change)
        with pytest.raises(ledger.HTTPException):
            ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=invalid))
    # The document must be the actual retained attachment, not a new source name.
    state['turns'][-1]['attachments'] = [{'name': 'plan.md', 'text': quote}]
    state['documents'] = [{'id': 'document', 'name': 'plan.md', 'text': quote, 'source': 'Marketing'}]
    state['facts'][-1].update(documentId='document', provenance={**fact['provenance'], 'sourceRef': 'attachment:0'})
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    for change in ({'documentId': 'missing'}, {'provenance': {**state['facts'][-1]['provenance'], 'sourceRef': 'attachment:1'}}):
        invalid = copy.deepcopy(state)
        invalid['facts'][-1].update(change)
        with pytest.raises(ledger.HTTPException):
            ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=invalid))


def test_disjoint_validity_periods_cannot_be_resolved_as_one_conflict():
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    state['facts'][0].update(validFrom='2026-10-01', validTo='2026-10-31')
    state['facts'][1].update(validFrom='2026-11-01', validTo='2026-11-30')
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    with pytest.raises(ledger.HTTPException) as exc:
        resolve()
    assert 'overlapping validity' in exc.value.detail
    state['facts'][1]['validFrom'] = '2026-10-20'
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    assert resolve()['resolution']['supporting_fact_ids'] == ['marketing', 'engineering']


def test_retired_versions_do_not_fill_the_vector_candidate_limit(monkeypatch):
    import itertools
    sequence = itertools.count()
    monkeypatch.setattr(ledger.engine, '_new_id', lambda prefix: f'{prefix}-{next(sequence):04d}')
    workspace()
    for index in range(7):
        conflict_id = f'conflict-{index}'
        resolve(conflict=conflict_id)
        newest = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId=conflict_id, requestId=f'answer-{index}', factId='engineering', rememberAuthority=True))
    calls = []
    store = ledger.vector_store()
    search = store.search
    def capture_search(vector, project_id, **kwargs):
        calls.append(kwargs)
        return search(vector, project_id, **kwargs)
    monkeypatch.setattr(store, 'search', capture_search)
    result = resolve(conflict='after-history')
    assert result['resolution']['applied_precedent_id'] == newest['lesson']['id']
    assert len(calls) == 1
    assert calls[0]['top_k'] == 7
    candidates = next(event['candidates'] for event in result['trace'] if event['stage'] == 'search')
    assert [candidate['precedent_id'] for candidate in candidates] == [newest['lesson']['id']]
    assert len(ledger.read('workspace-test')['precedentIds']) == 7


def test_reported_sources_preserve_submitter_and_require_literal_attribution():
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    first = 'Marketing says the next release is Wednesday.'
    quote = 'Engineering says Thursday.'
    turn = {'id': 'reported-review', 'prompt': first + ' ' + quote, 'source': 'Marketing', 'author': 'Maya', 'attachments': []}
    fact = {'id': 'reported', 'subject': 'next release', 'attribute': 'date', 'scope': 'launch readiness',
            'source': 'Engineering', 'value': 'Thursday', 'text': quote, 'submittedBy': {'source': 'Marketing', 'author': 'Maya'},
            'provenance': {'method': 'model-extracted', 'turnId': turn['id'], 'sourceRef': 'prompt', 'quote': quote,
                           'reportedSource': 'Engineering', 'contextQuote': first}}
    state['turns'].append(turn)
    state['facts'].append(fact)
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    for change in ({'source': 'CEO'}, {'author': 'Alex'}, {'submittedBy': {'source': 'Engineering'}},
                   {'provenance': {**fact['provenance'], 'reportedSource': 'CEO'}},
                   {'provenance': {**fact['provenance'], 'contextQuote': 'Invented context.'}}):
        invalid = copy.deepcopy(state)
        invalid['facts'][-1].update(change)
        with pytest.raises(ledger.HTTPException):
            ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=invalid))
    state['turns'][-1]['attachments'] = [{'name': 'reported.md', 'text': turn['prompt']}]
    state['documents'] = [{'id': 'reported-doc', 'name': 'reported.md', 'text': turn['prompt'], 'source': 'Marketing', 'author': 'Maya'}]
    state['facts'][-1].update(documentId='reported-doc', provenance={**fact['provenance'], 'sourceRef': 'attachment:0'})
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))


def test_wrapped_reported_shorthand_keeps_verbatim_adjacent_provenance():
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    first = 'Marketing says the next release is\n  Wednesday.'
    quote = 'Engineering says\n  Thursday.'
    turn = {'id': 'wrapped-review', 'prompt': first + '\n' + quote, 'source': 'Marketing', 'author': 'Maya', 'attachments': []}
    fact = {'id': 'wrapped', 'subject': 'next release', 'attribute': 'date', 'scope': 'launch readiness',
            'source': 'Engineering', 'value': 'Thursday', 'text': quote, 'submittedBy': {'source': 'Marketing', 'author': 'Maya'},
            'provenance': {'method': 'model-extracted', 'turnId': turn['id'], 'sourceRef': 'prompt', 'quote': quote,
                           'reportedSource': 'Engineering', 'contextQuote': first}}
    state['turns'].append(turn)
    state['facts'].append(fact)
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    assert ledger.public(ledger.read('workspace-test'))['facts'][-1]['text'] == quote
    for changed_prompt in [first + '\nAn unrelated update.\n' + quote, quote, turn['prompt'].replace('Thursday','Tuesday')]:
        invalid = copy.deepcopy(state)
        invalid['turns'][-1]['prompt'] = changed_prompt
        with pytest.raises(ledger.HTTPException):
            ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=invalid))
    invalid = copy.deepcopy(state)
    invalid['facts'][-1]['text'] = 'Engineering says Thursday.'
    invalid['facts'][-1]['provenance']['quote'] = 'Engineering says Thursday.'
    with pytest.raises(ledger.HTTPException):
        ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=invalid))


def test_access_claims_preserve_sources_and_save_a_scoped_human_answer():
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    quotes = ['Security says the new hire needs read-only access.', 'Manager says the new hire needs admin access.']
    state['turns'].append({'id': 'access-review', 'prompt': ' '.join(quotes), 'source': 'Marketing', 'author': 'Maya', 'attachments': []})
    for i, (source, value) in enumerate([('Security', 'read-only access'), ('Manager', 'admin access')]):
        state['facts'].append({'id': f'access-{i}', 'subject': 'new hire', 'attribute': 'access', 'scope': 'access control',
            'source': source, 'value': value, 'text': quotes[i], 'submittedBy': {'source': 'Marketing', 'author': 'Maya'},
            'provenance': {'method': 'model-extracted', 'turnId': 'access-review', 'sourceRef': 'prompt',
                           'quote': quotes[i], 'reportedSource': source}})
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    result = resolve(conflict='access-review', facts=['access-0', 'access-1'], scope='access-control:access')
    assert result['resolution']['supporting_fact_ids'] == ['access-0', 'access-1']
    answer = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='access-review',
        requestId='access-answer', factId='access-0', reason='QA choice', rememberAuthority=False))
    assert answer['resolution']['selected_fact_id'] == 'access-0'
    assert answer['policy'] == 1 and answer['lesson'] is None
    assert ledger.read('workspace-test')['resolutions']['access-review']['resolution'] == result['resolution']


@pytest.mark.parametrize('quote', [
    'QA states the login bug is a frontend issue.',
    'According to QA, the login bug is a frontend issue.',
    'The login bug is a frontend issue, according to QA.',
    'QA: the login bug is a frontend issue.',
    '- QA believes the login bug is a frontend issue.',
])
def test_general_reported_claims_validate_at_storage_boundary(quote):
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    state['turns'].append({'id': 'custom-review', 'prompt': quote, 'source': 'Marketing', 'author': 'Maya', 'attachments': []})
    fact = {'id': 'custom-claim', 'subject': 'login bug', 'attribute': 'component', 'scope': 'login bug',
            'source': 'QA', 'value': 'frontend issue', 'text': quote,
            'submittedBy': {'source': 'Marketing', 'author': 'Maya'},
            'provenance': {'method': 'model-extracted', 'turnId': 'custom-review', 'sourceRef': 'prompt',
                           'quote': quote, 'reportedSource': 'QA'}}
    state['facts'].append(fact)
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    assert ledger.public(ledger.read('workspace-test'))['facts'][-1] == fact
    for change in ({'source': 'Backend'}, {'author': 'Alex'}, {'submittedBy': {'source': 'QA'}},
                   {'provenance': {**fact['provenance'], 'reportedSource': 'Backend'}}):
        invalid = copy.deepcopy(state)
        invalid['facts'][-1].update(change)
        with pytest.raises(ledger.HTTPException):
            ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=invalid))


def test_general_conflict_correction_and_scope_remain_in_existing_engine():
    workspace()
    state = ledger.public(ledger.read('workspace-test'))
    quotes = ['According to QA, the login bug is a frontend issue.', 'Backend states the login bug is a backend issue.']
    state['turns'].append({'id': 'bug-review', 'prompt': ' '.join(quotes), 'source': 'Marketing', 'author': 'Maya', 'attachments': []})
    for i, (source, value) in enumerate([('QA', 'frontend issue'), ('Backend', 'backend issue')]):
        state['facts'].append({'id': f'bug-{i}', 'subject': 'login bug', 'attribute': 'component', 'scope': 'login bug',
            'source': source, 'value': value, 'text': quotes[i], 'submittedBy': {'source': 'Marketing', 'author': 'Maya'},
            'provenance': {'method': 'model-extracted', 'turnId': 'bug-review', 'sourceRef': 'prompt',
                           'quote': quotes[i], 'reportedSource': source}})
    ledger.save(ledger.SaveRequest(workspaceId='workspace-test', state=state))
    result = resolve(conflict='bug-review', facts=['bug-0', 'bug-1'], scope='login-bug:component')
    assert result['resolution']['supporting_fact_ids'] == ['bug-0', 'bug-1']
    assert result['resolution']['selected_fact_id'] is None
    answer = ledger.correct(ledger.CorrectRequest(workspaceId='workspace-test', conflictId='bug-review',
        requestId='bug-answer', factId='bug-0', reason='Confirmed diagnosis', rememberAuthority=True))
    assert answer['resolution']['selected_fact_id'] == 'bug-0'
    assert answer['policy'] == 2
    assert answer['lesson']['scope'] == 'login-bug:component'
    assert ledger.read('workspace-test')['resolutions']['bug-review']['resolution'] == result['resolution']
    with pytest.raises(ledger.HTTPException):
        resolve(conflict='wrong-property', facts=['bug-0', 'bug-1'], scope='login-bug:owner')
