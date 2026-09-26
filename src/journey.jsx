import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEY, seedState, processPrompt, DEMO_MEMBERS, sourceLabel } from './memory.js';
import './styles.css';
import './conversation.css';
import { normalizeConversations, turnsForChat, titleConversation } from './conversations.js';
import { recoverDraftAfterFailure } from './composer-draft.js';
import AutoTextarea from './auto-textarea.jsx';
import ConflictQuestion from './conflict-question.jsx';
import { authorityLabel, findConflictTurn, needsConflictReview, currentConflictQuestion } from './conflict-review.js';
import PendingReply from './pending-reply.jsx';
import { hasSavedDecision } from './decision-status.js';
import MessageContent from './message-content.jsx';
import ModelSelector from './model-selector.jsx';
import ReplayScene from './replay-scene.jsx';
import { completedReplayCycle, buildCycleReplaySteps } from './replay-cycle.js';
import { workspaceId, newWorkspaceId, selectWorkspace, serviceRequest, liveServices } from './services.js';
import exampleMemo from './fixtures/launch-memo.md?raw';

const FIRST_PROMPT = 'Can you review this launch memo before I share it with the team?';
const sampleMemo = () => ({ name: 'Atlas launch — marketing memo.md', text: exampleMemo, example: true });
function readMemory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { state: normalizeConversations(seedState()), error: '' };
    const state = JSON.parse(saved);
    if (state.version !== 3 || !Array.isArray(state.facts) || !Array.isArray(state.turns)) throw new Error('Unrecognized local memory');
    state.documents ||= [];
    state.facts = state.facts.map(fact => fact.id === 'fact-seed-engineering' ? { document: 'Release readiness update', sourceDate: '2026-09-18', ...fact } : fact);
    return { state: normalizeConversations(state), error: '' };
  } catch { return { state: normalizeConversations(seedState()), error: 'Local memory could not be read. Reset the local demo to start over; nothing has been reported as saved.' }; }
}

function App() {
  const [initial] = useState(readMemory);
  const [memory, setMemory] = useState(initial.state);
  const [error, setError] = useState(initial.error);
  const [serviceState, setServiceState] = useState(null);
  const [serviceLoading, setServiceLoading] = useState(true);
  const services = serviceState && liveServices(serviceState.workspaceId, serviceState);
  useEffect(() => {
    let cancelled = false;
    async function connect() {
      try {
        const id = workspaceId();
        let result = await serviceRequest('load', { workspaceId: id });
        if (!result.state) {
          await serviceRequest('save', { workspaceId: id, state: initial.state, operation: 'Initialize labeled example workspace' });
          result = await serviceRequest('load', { workspaceId: id });
        }
        if (cancelled) return;
        const state = normalizeConversations(result.state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setMemory(state);
        setServiceState({ ...result.services, workspaceId: id });
      } catch (failure) { if (!cancelled) setError(failure.message || 'Service backend unavailable. Start npm run backend, then reload.'); }
      finally { if (!cancelled) setServiceLoading(false); }
    }
    connect();
    return () => { cancelled = true; };
  }, []);
  const [input, setInput] = useState('');
  const [source, setSource] = useState('Marketing');
  const [attachments, setAttachments] = useState([]);
  const [documentPreview, setDocumentPreview] = useState(null);
  const draftsRef = useRef({});
  const composerDraftRef = useRef(null);
  composerDraftRef.current = { input, attachments, source };
  const chatTurns = turnsForChat(memory);
  const fileRef = useRef(null);
  const documentRef = useRef(null);
  useEffect(() => { if (documentPreview) documentRef.current?.showModal(); else if (documentRef.current?.open) documentRef.current.close(); }, [documentPreview]);
  async function attachMemo(file) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) { setError('Attach a plain-text (.txt) or Markdown (.md) memo. PDF and Word adapters can be added when those document services are connected.'); return; }
    if (file.size > 100_000) { setError('For this local demo, attach a memo smaller than 100 KB.'); return; }
    try { const text = await file.text(); setAttachments([{ name: file.name, text, example: false }]); setInput(current => current.trim() ? current : 'Can you review this document before I share it with the team?'); setError(''); }
    catch { setError('The memo could not be read. Try a plain-text or Markdown copy.'); }
  }
  function useExample() { setAttachments([sampleMemo()]); setInput(FIRST_PROMPT); setSource('Marketing'); setError(''); inputRef.current?.focus({ preventScroll: true }); }
  const [busy, setBusy] = useState(false);
  const [pendingTurn, setPendingTurn] = useState(null);
  const [conflictQuestion, setConflictQuestion] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [dismissedConflicts, setDismissedConflicts] = useState([]);
  const submittingRef = useRef(false);
  const [selection, setSelection] = useState('codex');
  const [providers, setProviders] = useState([]);
  const [memoryReviewEnabled, setMemoryReviewEnabled] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const connectionRef = useRef(null);
  const provider = selection.split(':')[0];
  const selectedModel = selection.includes(':') ? selection.slice(selection.indexOf(':') + 1) : '';
  const providerNames = { codex: 'OpenAI / Codex', openai: 'OpenAI', anthropic: 'Claude', compatible: 'Custom provider' };
  useEffect(() => { fetch('/api/providers').then(response => response.json()).then(data => { setProviders(data.providers || []); setMemoryReviewEnabled(data.memoryReview !== false); }).catch(() => setError('Start the local dev server to connect a model.')); }, []);
  useEffect(() => { if (connecting) connectionRef.current?.showModal(); else if (connectionRef.current?.open) connectionRef.current.close(); }, [connecting]);
  function openConnection() { setModelId(selectedModel || providers.find(item => item.id === provider)?.model || ''); setConnectionError(''); setConnecting(true); }
  async function saveConnection(event) {
    event.preventDefault(); setConnectionBusy(true); setConnectionError('');
    try {
      const response = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chronicle-Request': '1' }, body: JSON.stringify({ provider, model: modelId, apiKey, baseUrl }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setProviders(data.providers); setApiKey(''); setConnecting(false);
    } catch (error) { setConnectionError(error.message); } finally { setConnectionBusy(false); }
  }
  async function requestAnswer(context) {
    const response = await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chronicle-Request': '1' }, body: JSON.stringify({ ...context, state: { ...context.state, documents: [], conversations: undefined, turns: context.state.turns.filter(turn => turn.answer).slice(-8).map(turn => ({ id: turn.id, prompt: turn.prompt, answer: turn.answer })) }, provider, model: selectedModel }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The model request failed.'); return data;
  }
  const [replay, setReplay] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playMode, setPlayMode] = useState('auto');
  const [replayRun, setReplayRun] = useState(0);
  const [returning, setReturning] = useState(false);
  const finishReplay = useCallback(() => { setPlaying(false); setReturning(false); setReplay(null); }, []);
  const transcriptRef = useRef(null);
  const inputRef = useRef(null);
  const expanded = Boolean(replay);
  const replaySteps = useMemo(() => buildCycleReplaySteps(replay), [replay]);
  const step = replaySteps[cursor];
  const replayTurn = step?.turn || replay?.turns[0] || null;
  const event = step?.event;
  const traceDone = replay && cursor === replaySteps.length - 1 && !playing;

  const completePlayback = useCallback(action => {
    setPlaying(false);
    if (action === 'return') setReturning(true);
  }, []);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [chatTurns.length, memory.activeChatId, pendingTurn?.id, busy, expanded, conflictQuestion?.id]);

  useEffect(() => {
    if (busy || expanded) return;
    if (conflictQuestion && conflictQuestion.chatId === memory.activeChatId && needsConflictReview(memory, findConflictTurn(memory, conflictQuestion.id))) return;
    const pending = currentConflictQuestion(memory, memory.activeChatId, dismissedConflicts);
    setReviewError(''); setConflictQuestion(pending || null);
  }, [memory, busy, expanded, conflictQuestion, dismissedConflicts]);

  function dismissConflict() {
    setDismissedConflicts(ids => [...ids, conflictQuestion.id]);
    setConflictQuestion(null); setReviewError('');
  }
  async function answerConflict(review) {
    if (submittingRef.current || !services) return;
    submittingRef.current = true; setBusy(true); setReviewError('');
    const fact = conflictQuestion.candidates.find(item => item.id === review.factId);
    const prompt = `${fact ? `Use ${fact.value} from ${sourceLabel(fact)} for ${conflictQuestion.subject}.` : `Leave the ${conflictQuestion.subject} conflict unresolved.`}${review.rememberAuthority ? ` ${authorityLabel(conflictQuestion, fact)}` : ''}${review.reason ? ` Reason: ${review.reason}` : ''}`;
    try {
      const result = await processPrompt(memory, prompt, source, state => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), undefined, [], { chatId: memory.activeChatId, conflictReview: review, services });
      setMemory(result.state); setConflictQuestion(null);
    } catch (error) {
      const restored = readMemory().state;
      setMemory(restored);
      if (restored.conflictReviews?.some(item => item.conflictTurnId === review.conflictTurnId)) {
        setConflictQuestion(null); setError('Your choice was saved, but its response could not be completed.');
      } else setReviewError(`${error.message} Your answer has not been saved. Try again.`);
    } finally { submittingRef.current = false; setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!services || submittingRef.current || expanded || conflictQuestion || !input.trim()) return;
    if (provider !== 'codex' && !providers.some(item => item.id === provider && item.configured)) { openConnection(); return; }
    const prompt = input.trim();
    const submittedAttachments = attachments;
    const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
    submittingRef.current = true;
    setPendingTurn({ id: turnId, prompt, source, author: DEMO_MEMBERS[source], attachments: submittedAttachments, startedAt: Date.now(), pending: true });
    setInput('');
    setAttachments([]);
    setBusy(true);
    setError('');
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      const result = await processPrompt(titleConversation(memory, memory.activeChatId, prompt, submittedAttachments), prompt, source, state => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), requestAnswer, submittedAttachments, { turnId, chatId: memory.activeChatId, services, memoryReview: memoryReviewEnabled });
      setMemory(result.state); // Leave any next-message draft typed during generation intact.
    } catch (error) {
      setMemory(readMemory().state);
      const currentDraft = composerDraftRef.current;
      const recovered = recoverDraftAfterFailure(currentDraft, { input: prompt, attachments: submittedAttachments, source });
      setInput(recovered.input); setAttachments(recovered.attachments); setSource(recovered.source);
      setError(`${error.message} No completed response was saved; any acknowledged fact writes remain in project memory.${recovered === currentDraft ? ' Your next draft is preserved; the failed message remains in the conversation.' : ' Your message is restored for retry.'}`);
    } finally { submittingRef.current = false; setBusy(false); setPendingTurn(null); }
  }

  function startReplay(turn) { setReplay(turn); setCursor(0); setPlayMode('auto'); setReplayRun(run => run + 1); setReturning(false); setPlaying(true); }
  function back() { setPlaying(false); setReturning(true); }
  function replayStep() { setPlayMode('step'); setReplayRun(run => run + 1); setPlaying(true); }
  async function reset() {
    if (busy || serviceLoading || !services) return;
    setBusy(true);
    try {
      const id = newWorkspaceId(), empty = normalizeConversations(seedState());
      await serviceRequest('save', { workspaceId: id, state: empty, operation: 'Initialize fresh demo workspace' });
      selectWorkspace(id); localStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
      setServiceState(current => ({ ...current, workspaceId: id })); setMemory(empty);
      draftsRef.current = {}; setConflictQuestion(null); setDismissedConflicts([]); setReviewError('');
      setInput(''); setAttachments([]); setSource('Marketing'); setError(''); finishReplay();
    } catch (failure) { setError(failure.message || 'Reset failed. Existing records are retained.'); }
    finally { setBusy(false); }
  }
  async function switchChat(chatId, create = false) {
    if (busy || expanded) return;
    const next = { ...memory, activeChatId: chatId, conversations: create ? [...memory.conversations, { id: chatId, title: 'New chat' }] : memory.conversations };
    try {
      if (services) await services.save(next, 'Save chat navigation');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      draftsRef.current[memory.activeChatId] = { input, attachments, source };
      const draft = draftsRef.current[chatId] || { input: '', attachments: [], source: 'Marketing' };
      setMemory(next); setInput(draft.input); setAttachments(draft.attachments); setSource(draft.source); setError('');
      inputRef.current?.focus({ preventScroll: true });
    } catch { setError('The conversation could not be saved. Free up browser storage and try again.'); }
  }
  const turns = expanded ? [replayTurn] : pendingTurn ? [...chatTurns.filter(turn => turn.id !== pendingTurn.id), pendingTurn] : chatTurns;
  const replayCycle = useMemo(() => completedReplayCycle(memory), [memory]);
  const composerQuestion = !expanded && chatTurns.find(turn => turn.id === conflictQuestion?.id);

  return <main className={`experience ${expanded ? 'is-replaying' : ''} ${returning ? 'is-returning' : ''}`}>
    <header className="masthead"><span className="wordmark">chronicle</span><div className="header-actions">{expanded && <button onClick={back} disabled={returning}>Back to terminal <span>↙</span></button>}<button onClick={useExample} disabled={busy || expanded || Boolean(composerQuestion)}>Use example memo</button><button className="reset" onClick={reset} disabled={busy} title="Start a fresh workspace; previous Atlas records are retained" aria-label="Reset demo">Reset demo</button></div></header>
    <section className={`space ${expanded ? 'expanded' : 'close-up'}`} aria-label="Terminal and project memory">
      <div className="space-light"/>
      <ReplayScene turn={replayTurn} step={step} steps={replaySteps} cursor={cursor} playMode={playMode} onCursorChange={setCursor} onPlaybackComplete={completePlayback} playing={playing} replayRun={replayRun} returning={returning} onReturnComplete={finishReplay} onPause={() => setPlaying(false)}>
        <section className="terminal" aria-label="AI terminal">
          <div className="terminal-chrome"><span>Atlas launch</span><span className="terminal-project">/</span><label htmlFor="conversation" className="sr-only">Conversation</label><select id="conversation" className="conversation-picker" value={memory.activeChatId} onChange={event => switchChat(event.target.value)} disabled={busy || expanded}>{memory.conversations.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select><button className="new-chat" onClick={() => switchChat(`chat-${crypto.randomUUID()}`, true)} disabled={busy || expanded}><span aria-hidden="true">+</span> New chat</button></div>
          <div className="terminal-body">
            <div className="transcript" ref={transcriptRef} role="log" aria-label="Conversation">
              {!turns.length && <div className="session-start"><span className="session-eyebrow">PROJECT WORKSPACE</span><h1>Ready when you are{DEMO_MEMBERS[source] ? `, ${DEMO_MEMBERS[source]}` : ''}.</h1><p>Share a draft, ask a question, or pick up where the team left off.</p><small>Your conversations and project context stay together here.</small></div>}
              {turns.map(turn => <article className="turn" key={turn.id}><div className="message user-message"><span className="message-author">{sourceLabel(turn)}</span><MessageContent>{turn.prompt}</MessageContent>{turn.attachments?.map(file => <button key={file.name} className="message-attachment" onClick={() => setDocumentPreview(file)}>{file.name} <span>View memo ↗</span></button>)}</div><div className="message assistant-message"><span className="message-author">chronicle</span>{turn.pending ? <PendingReply startedAt={turn.startedAt} hasDocument={Boolean(turn.attachments?.length)}/> : <MessageContent>{expanded && !turn.trace.slice(0, step.traceIndex + 1).some(item => item.stage === 'respond') ? 'Processing the recorded request…' : turn.answer || 'No reply was completed for this message.'}</MessageContent>}</div>{turn.answer && <div className="turn-meta">{hasSavedDecision(turn, expanded ? step.traceIndex : undefined) && <span className="decision-saved"><span aria-hidden="true">✓</span> Decision saved to memory</span>}{!expanded && needsConflictReview(memory, turn) && conflictQuestion?.id !== turn.id && <button disabled={busy} onClick={() => { setReviewError(''); setConflictQuestion(turn.conflicts?.map(group => findConflictTurn(memory, group.id)).find(group => needsConflictReview(memory, group)) || turn); }}>Resolve conflict <span>↗</span></button>}{!expanded && !busy && !composerQuestion && replayCycle?.id === turn.id && <button onClick={() => startReplay(replayCycle)} aria-label="Replay internals"> Replay internals <span>↗</span></button>}</div>}</article>)}
            </div>
            {error && <p className="storage-error" role="alert">{error}</p>}

            {composerQuestion ? <ConflictQuestion key={composerQuestion.id} turn={composerQuestion} busy={busy} error={reviewError} onAnswer={answerConflict} onDismiss={dismissConflict}/> : <form onSubmit={submit} className="composer" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!expanded) attachMemo(event.dataTransfer.files[0]); }}>
            {!expanded && attachments.map(file => <div className="attachment-chip" key={file.name}><button type="button" onClick={() => setDocumentPreview(file)}>{file.name}<small>{file.example ? 'Example memo' : 'Attached document'}</small></button><button type="button" aria-label="Remove attached memo" onClick={() => setAttachments([])}>×</button></div>)}
            <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-label="Upload memo file" onChange={event => { attachMemo(event.target.files[0]); event.target.value = ''; }}/>
            <div className="composer-input"><label htmlFor="prompt" className="sr-only">Prompt Chronicle</label><AutoTextarea id="prompt" ref={inputRef} value={expanded ? '' : input} disabled={expanded} onChange={event => setInput(event.target.value)} placeholder={expanded ? 'Return to the terminal to continue…' : 'Ask anything, or add a project update…'} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/><button type="submit" disabled={busy || expanded || !input.trim()} aria-label="Send prompt" title={busy ? 'Reply in progress — you can keep drafting' : 'Send message'}>↑</button></div>
            <div className="composer-top composer-toolbar"><div className="composer-identity"><button className="attach-file" type="button" onClick={() => fileRef.current?.click()} disabled={expanded} aria-label="Attach file" title="Attach a text or Markdown file"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 12 7-7a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7L12 2"/><path d="m5 15 9-9"/></svg></button><label htmlFor="source">From</label><select id="source" value={source} onChange={event => setSource(event.target.value)} disabled={expanded}>{Object.entries(DEMO_MEMBERS).map(([team, name]) => <option key={team} value={team}>{name} [{team}]</option>)}</select></div><ModelSelector selection={selection} onChange={setSelection} providers={providers} disabled={busy || expanded} replaying={expanded} onConnect={openConnection}/>{expanded && <span>Read-only replay</span>}</div></form>}
          </div>
        </section>
      </ReplayScene>
    </section>
    <footer className="quiet-footer"><span className="prototype-label">{serviceLoading ? 'CONNECTING' : serviceState?.storage === 'atlas' ? 'ATLAS' : serviceState ? 'SERVER MEMORY' : 'BACKEND OFFLINE'} <span>· {providerNames[provider]}</span></span>{expanded ? <div className="replay-controls"><button aria-label="Previous replay step" disabled={returning || cursor === 0} onClick={() => { setPlaying(false); setCursor(cursor - 1); }}>←</button><button disabled={returning} onClick={() => { if (traceDone) { setCursor(0); setReplayRun(run => run + 1); } setPlayMode('auto'); setPlaying(!playing); }}>{playing ? 'Pause' : traceDone ? 'Replay all' : 'Play'}</button><button disabled={returning} onClick={replayStep}>Replay step</button><button aria-label="Next replay step" disabled={returning || cursor === replaySteps.length - 1} onClick={() => { setPlaying(false); setCursor(cursor + 1); }}>→</button><div><input className="replay-scrubber" type="range" disabled={returning} aria-label="Replay position" min="0" max={replaySteps.length - 1} value={cursor} onChange={event => { setPlaying(false); setCursor(Number(event.target.value)); }}/><div role="status"><span>{String(cursor + 1).padStart(2, '0')} / {replaySteps.length}</span><strong>{returning ? 'Returning to the terminal…' : event?.title}</strong><p>{event?.detail}</p></div></div></div> : <span className="footer-hint">Atlas launch · {serviceState?.storage === 'atlas' ? 'Connected workspace' : 'Atlas credentials needed'}</span>}</footer>
    <dialog ref={documentRef} className="document-dialog" onCancel={() => setDocumentPreview(null)} onClose={() => setDocumentPreview(null)}>
      <button className="dialog-close" onClick={() => setDocumentPreview(null)} aria-label="Close memo preview">×</button><h2>{documentPreview?.name}</h2><span>{documentPreview?.example ? 'EXAMPLE DOCUMENT' : 'ATTACHED DOCUMENT'}</span><pre>{documentPreview?.text}</pre>
    </dialog>
    <dialog ref={connectionRef} className="connection-dialog" onCancel={() => { setApiKey(''); setConnecting(false); }} onClose={() => { setApiKey(''); setConnecting(false); }}>
      <button className="dialog-close" onClick={() => { setApiKey(''); setConnecting(false); }} aria-label="Close provider settings">×</button>
      <h2>Connect {providerNames[provider]}</h2><p>Your key stays in this local server’s memory. It is not saved in the browser or repository.</p>
      <form onSubmit={saveConnection}><label htmlFor="api-key">API key</label><input id="api-key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required/><label htmlFor="provider-model">Model ID</label><input id="provider-model" readOnly={Boolean(selectedModel)} value={modelId} onChange={event => setModelId(event.target.value)} placeholder="Model ID from your provider" required/>{provider === 'compatible' && <><label htmlFor="base-url">API base URL</label><input id="base-url" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" required/></>}{connectionError && <p role="alert" className="storage-error">{connectionError}</p>}<button type="submit" disabled={connectionBusy}>{connectionBusy ? 'Connecting…' : 'Use this connection'}</button></form>
      <small>{provider === 'compatible' ? 'Supports the OpenAI Chat Completions request format. Other protocols need an adapter.' : 'Model access is checked when you send a prompt.'}</small>
    </dialog>
  </main>;
}

export default <App/>;
