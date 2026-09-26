import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STORAGE_KEY, seedState, processPrompt } from './memory.js';
import './styles.css';
import exampleMemo from './fixtures/launch-memo.md?raw';

const FIRST_PROMPT = 'Can you review this launch memo before I share it with the team?';
const sampleMemo = () => ({ name: 'Atlas launch — marketing memo.md', text: exampleMemo, example: true });
const CORRECTION = 'Engineering owns launch readiness for this project.';
function readMemory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { state: seedState(), error: '' };
    const state = JSON.parse(saved);
    if (state.version !== 3 || !Array.isArray(state.facts) || !Array.isArray(state.turns)) throw new Error('Unrecognized local memory');
    state.documents ||= [];
    state.facts = state.facts.map(fact => fact.id === 'fact-seed-engineering' ? { document: 'Release readiness update', sourceDate: '2026-09-18', ...fact } : fact);
    return { state, error: '' };
  } catch { return { state: seedState(), error: 'Local memory could not be read. Reset the local demo to start over; nothing has been reported as saved.' }; }
}
const widePaths = {
  ingest: 'M320 435 H290',
  lookup: 'M185 325 V285 Q185 270 205 270 H385 V255',
  factwrite: 'M385 255 V270 H205 Q185 270 185 285 V325',
  evaluate: 'M515 160 H720',
  decide: 'M980 155 H1030 Q1050 155 1050 175 V325',
  archive: 'M1050 520 V675 Q1050 687 1030 687 H205 Q185 687 185 667 V525',
  respond: 'M940 435 H880',
};
const compactPaths = {
  ingest: 'M145 735 H130 Q115 735 115 715 V515',
  lookup: 'M135 315 V295 Q135 285 155 285 H220 V265',
  factwrite: 'M220 265 V285 H155 Q135 285 135 295 V315',
  evaluate: 'M345 170 H500',
  decide: 'M760 170 H795 Q810 170 810 190 V295 Q810 305 790 305 H715 V315',
  archive: 'M715 510 V565 Q715 580 695 580 H160 Q135 580 135 565 V515',
  respond: 'M710 510 V600',
};
const routeFor = { receive: 'ingest', write: 'ingest', recall: 'lookup', extract: 'lookup', policy: 'evaluate', resolve: 'decide', commit: 'archive', generate: 'decide', respond: 'respond' };
const storageStages = ['write', 'saved', 'commit', 'committed'];
function Flow({ compact, event, running, replayKey }) {
  const routes = compact ? compactPaths : widePaths;
  const active = event?.stage === 'write' && event.entity === 'extracted-facts' ? 'factwrite' : routeFor[event?.stage];
  return <svg className="flow-lines" viewBox={compact ? '0 0 850 1000' : '0 0 1200 700'} aria-hidden="true">
    <defs><filter id="packet-glow" x="-250%" y="-250%" width="600%" height="600%"><feGaussianBlur stdDeviation="4"/></filter></defs>
    {Object.entries(routes).map(([key, path]) => <g className={`wire ${active === key ? 'active' : ''} ${key === 'archive' || key === 'ingest' ? 'storage-wire' : ''}`} key={key}><path d={path}/>{active === key && running && <g className="packet" key={`${replayKey}-${event.id}`}><circle r="9" filter="url(#packet-glow)"><animateMotion dur="1.5s" repeatCount="indefinite" path={path}/></circle><circle r="3"><animateMotion dur="1.5s" repeatCount="indefinite" path={path}/></circle></g>}</g>)}
  </svg>;
}

function App() {
  const [initial] = useState(readMemory);
  const [memory, setMemory] = useState(initial.state);
  const [error, setError] = useState(initial.error);
  const [input, setInput] = useState(initial.state.turns.length ? '' : FIRST_PROMPT);
  const [source, setSource] = useState('Marketing');
  const [attachments, setAttachments] = useState(initial.state.turns.length ? [] : [sampleMemo()]);
  const [documentPreview, setDocumentPreview] = useState(null);
  const fileRef = useRef(null);
  const documentRef = useRef(null);
  useEffect(() => { if (documentPreview) documentRef.current?.showModal(); else if (documentRef.current?.open) documentRef.current.close(); }, [documentPreview]);
  async function attachMemo(file) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) { setError('Attach a plain-text (.txt) or Markdown (.md) memo. PDF and Word adapters can be added when those document services are connected.'); return; }
    if (file.size > 100_000) { setError('For this local demo, attach a memo smaller than 100 KB.'); return; }
    try { const text = await file.text(); setAttachments([{ name: file.name, text, example: false }]); if (!input.trim()) setInput(FIRST_PROMPT); setError(''); }
    catch { setError('The memo could not be read. Try a plain-text or Markdown copy.'); }
  }
  function useExample() { setAttachments([sampleMemo()]); setInput(FIRST_PROMPT); setAttachments([sampleMemo()]); setSource('Marketing'); setError(''); inputRef.current?.focus({ preventScroll: true }); }
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState('codex');
  const [providers, setProviders] = useState([]);
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
  useEffect(() => { fetch('/api/providers').then(response => response.json()).then(data => setProviders(data.providers || [])).catch(() => setError('Start the local dev server to connect a model.')); }, []);
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
    const response = await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chronicle-Request': '1' }, body: JSON.stringify({ ...context, state: { ...context.state, documents: [], turns: context.state.turns.filter(turn => turn.answer).slice(-8).map(turn => ({ prompt: turn.prompt, answer: turn.answer })) }, provider, model: selectedModel }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The model request failed.'); return data;
  }
  const [replay, setReplay] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [camera, setCamera] = useState({ wide: 1, close: 1, compact: false });
  const stageRef = useRef(null);
  const transcriptRef = useRef(null);
  const inputRef = useRef(null);
  const expanded = Boolean(replay);
  const event = replay?.trace[cursor];
  const traceDone = replay && cursor === replay.trace.length - 1 && !playing;

  useLayoutEffect(() => {
    const measure = () => {
      const { width, height } = stageRef.current.getBoundingClientRect();
      const compact = width / height < 1.25;
      setCamera({ compact, wide: Math.min(width / (compact ? 850 : 1200), height / (compact ? 1000 : 700)) * .94, close: Math.min(width * .88 / 560, height * .9 / 355) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !replay) return;
    const timer = setTimeout(() => {
      if (cursor < replay.trace.length - 1) setCursor(cursor + 1);
      else setPlaying(false);
    }, cursor === 0 ? 2300 : 1750);
    return () => clearTimeout(timer);
  }, [playing, replay, cursor]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [memory.turns.length, busy, expanded]);

  async function submit(event) {
    event.preventDefault();
    if (busy || expanded || !input.trim()) return;
    if (provider !== 'codex' && !providers.some(item => item.id === provider && item.configured)) { openConnection(); return; }
    const prompt = input.trim();
    setBusy(true);
    setError('');
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      const result = await processPrompt(memory, prompt, source, state => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), requestAnswer, attachments);
      setMemory(result.state);
      setInput('');
      setAttachments([]);
    } catch (error) {
      setMemory(readMemory().state);
      setError(`${error.message} No completed response was saved; any earlier fact writes remain in local memory.`);
    } finally { setBusy(false); }
  }

  function startReplay(turn) { setReplay(turn); setCursor(0); setPlaying(true); setReplayKey(key => key + 1); }
  function back() { setPlaying(false); setReplay(null); }
  function prepareCorrection() { setSource('You'); setInput(CORRECTION); inputRef.current?.focus({ preventScroll: true }); }
  function reset() {
    try { const empty = seedState(); localStorage.setItem(STORAGE_KEY, JSON.stringify(empty)); setMemory(empty); setInput(FIRST_PROMPT); setAttachments([sampleMemo()]); setSource('Marketing'); setError(''); back(); }
    catch { setError('Local storage could not be reset. Existing records have not been reported as cleared.'); }
  }
  const turns = expanded ? [replay] : memory.turns;
  const last = memory.turns.at(-1);
  const savedIndex = replay?.trace.findIndex(item => item.stage === 'saved' && item.entity !== 'document') ?? -1;
  const factSaved = expanded && cursor >= savedIndex;
  const evidence = replay?.candidates || [];
  const compared = expanded && cursor >= replay.trace.findIndex(item => item.stage === 'compare' || item.stage === 'policy');
  const policyChecked = expanded && cursor >= replay.trace.findIndex(item => item.stage === 'policy');
  const resolved = expanded && cursor >= replay.trace.findIndex(item => item.stage === 'resolve');
  const decisionSaved = expanded && cursor >= replay.trace.findIndex(item => item.stage === 'committed');
  const localCount = replay ? replay.factCount - (factSaved ? 0 : replay.incoming.length) : memory.facts.length;

  return <main className="experience">
    <header className="masthead"><span className="wordmark">chronicle</span><div className="header-actions">{expanded && <button onClick={back}>Back to terminal <span>↙</span></button>}<button className="reset" onClick={reset} disabled={busy} title="Reset this browser’s demo records" aria-label="Reset local demo">Reset demo</button></div></header>
    <section ref={stageRef} className={`space ${expanded ? 'expanded' : 'close-up'}`} aria-label="Terminal and project memory">
      <div className="space-light"/>
      <div className={`universe ${camera.compact ? 'compact' : ''}`} style={{ '--camera-scale': expanded ? camera.wide : camera.close, '--camera-shift': expanded ? '0px' : camera.compact ? '-277.5px' : '-142.5px' }}>
        <div className="depth-plane plane-memory" aria-hidden="true"><span>PROJECT MEMORY</span></div><div className="depth-plane plane-execution" aria-hidden="true"><span>EXECUTION</span></div>
        <Flow compact={camera.compact} event={event} running={playing} replayKey={replayKey}/>

        <section className={`station storage ${storageStages.includes(event?.stage) ? 'awake' : ''}`} aria-hidden={!expanded} aria-label="Local storage">
          <span className="station-label">LOCAL STORE <span>01</span></span><h2>{event?.entity === 'document' ? event.stage === 'write' ? 'Saving memo…' : 'Memo retained' : event?.stage === 'write' ? 'Writing…' : event?.stage === 'commit' ? 'Saving decision…' : decisionSaved ? 'Decision saved' : factSaved ? replay?.correction ? 'Lesson retained' : replay?.incoming.length ? 'Fact retained' : 'Message retained' : 'Existing memory'}</h2><div className="record-stack"><div/><div/><div/></div><p>{localCount} retained fact{localCount === 1 ? '' : 's'} · {decisionSaved ? 'answer + trace' : 'append-only history'}</p><div className="station-detail">{factSaved && replay?.incoming.length ? replay.incoming.map(fact => <div key={fact.id}><span>{fact.source}</span><strong>{fact.value}</strong></div>) : <div><span>Engineering · seeded</span><strong>Monday</strong></div>}</div><code>{event?.stage === 'commit' ? 'append resolution + evidence' : factSaved ? 'write confirmed · this browser' : 'browser storage · seeded fixture'}</code>
        </section>
        <section className={`station comparison ${['extract', 'recall', 'compare'].includes(event?.stage) ? 'awake' : ''} ${compared && replay?.conflict ? 'conflicted' : ''}`} aria-hidden={!expanded} aria-label="Evidence comparison">
          <span className="station-label">RECALL + COMPARE <span>02</span></span><h2>{event?.stage === 'extract' ? 'Read the document' : !compared ? 'Look up the subject' : replay?.conflict ? 'Conflicting claims' : evidence.length ? 'Available evidence' : 'No matching evidence'}</h2><div className="evidence-list">{evidence.length ? evidence.slice(-3).map(fact => <div key={fact.id}><i className={fact.source.toLowerCase()}/><span>{fact.source}</span><strong>{fact.value}</strong>{fact.document && <small>{fact.document}{fact.sourceDate ? ` · ${fact.sourceDate}` : ''}</small>}</div>) : <p>No structured claim matches this prompt.</p>}</div><code>{event?.stage === 'extract' ? 'memo → candidate factual claims' : 'match project + subject + scope'}</code>
        </section>
        <section className={`station policy ${event?.stage === 'policy' ? 'awake' : ''} ${policyChecked && replay?.applied ? 'remembered' : ''}`} aria-hidden={!expanded} aria-label="Resolution policy">
          <span className="station-label">POLICY + PRECEDENTS <span>{replay ? `v${replay.policy}` : 'v1'}</span></span><h2>{policyChecked && replay?.applied ? 'Lesson applied' : replay?.correction ? 'A scoped lesson' : 'Check authority'}</h2><p>{replay?.lesson ? 'Engineering owns launch readiness for Atlas launch.' : 'Starting rule: Marketing has priority for launch dates.'}</p><div className="scope-line">{policyChecked ? replay?.applied ? 'Scope matched · precedent cited' : 'No precedent applied' : 'Candidate ≠ applied evidence'}</div><code>evaluate scope → select evidence</code>
        </section>
        <section className={`station result ${['generate', 'generated', 'resolve', 'respond'].includes(event?.stage) ? 'awake' : ''}`} aria-hidden={!expanded} aria-label="Decision output">
          <span className="station-label">RESOLUTION <span>03</span></span><h2>{resolved ? replay?.selected?.value || (replay?.correction ? 'Lesson recorded' : replay?.conflict ? 'Needs input' : 'Model response') : 'Awaiting evidence'}</h2><p>{resolved ? replay?.selected ? `${replay.selected.source} · ${replay.selected.subject}` : replay?.conflict ? 'No justified fact selection' : replay?.model || 'Answer composed' : 'Facts and policy determine the result.'}</p><span className={`save-state ${decisionSaved ? 'saved' : ''}`}>{decisionSaved ? 'Saved locally with evidence' : resolved ? 'Decision write pending' : 'Not resolved yet'}</span><code>selected fact · policy · explanation</code>
        </section>

        <section className="terminal" aria-label="AI terminal">
          <div className="terminal-chrome"><span>chronicle</span><span className="terminal-project">~/atlas-launch</span><div className="model-control"><label htmlFor="model" className="sr-only">AI model</label><select id="model" value={selection} disabled={busy || expanded} onChange={event => setSelection(event.target.value)}><optgroup label="OpenAI"><option value="codex">Codex · signed-in account</option><option value="openai">OpenAI · API model</option></optgroup><optgroup label="Anthropic"><option value="anthropic:claude-sonnet-5">Claude Sonnet 5</option><option value="anthropic:claude-opus-5-5">Claude Opus 5.5</option></optgroup><optgroup label="Other"><option value="compatible">Custom · OpenAI-compatible</option></optgroup></select>{provider !== 'codex' && !expanded && <button onClick={openConnection} disabled={busy}>{providers.some(item => item.id === provider && item.configured) ? 'Configure' : 'Connect'}</button>}</div></div>
          <div className="terminal-body">
            <div className="transcript" ref={transcriptRef} role="log" aria-label="Conversation">
              {!turns.length && <div className="session-start"><p>Atlas launch · project memory ready.</p><p>Attach a memo and I’ll review it against what the project already knows.</p><small>Text and Markdown documents · prior project context included</small></div>}
              {turns.map(turn => <article className="turn" key={turn.id}><div className="message user-message"><span className="message-author">{turn.source || 'You'}</span><p>{turn.prompt}</p>{turn.attachments?.map(file => <button key={file.name} className="message-attachment" onClick={() => setDocumentPreview(file)}>{file.name} <span>View memo ↗</span></button>)}</div><div className="message assistant-message"><span className="message-author">chronicle</span><p>{turn.answer || 'Message recorded; no completed response was saved.'}</p></div>{turn.answer && <div className="turn-meta"><span>Saved locally · {turn.model || `policy v${turn.policy}`}</span>{!expanded && turn.trace?.length > 0 && <button onClick={() => startReplay(turn)} aria-label={`Replay internals for ${turn.id}`}>Replay internals <span>↗</span></button>}</div>}</article>)}
              {busy && <p className="working">Waiting for {providerNames[provider]}…</p>}
            </div>
            {error && <p className="storage-error" role="alert">{error}</p>}
            {!expanded && last?.conflict && !memory.lesson && <button className="correction-action" onClick={prepareCorrection}>Correct the launch authority <span>↗</span></button>}
            {!expanded && last?.correction && <button className="correction-action" onClick={() => { setSource('Marketing'); setInput('Marketing says the next release is Tuesday. Engineering says it will be ready Thursday. When is the next release?'); inputRef.current?.focus({ preventScroll: true }); }}>Try the next release <span>↗</span></button>}
            <form onSubmit={submit} className="composer" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!expanded && !busy) attachMemo(event.dataTransfer.files[0]); }}>
            {!expanded && attachments.map(file => <div className="attachment-chip" key={file.name}><button type="button" onClick={() => setDocumentPreview(file)}>{file.name}<small>{file.example ? 'Example memo' : 'Attached document'}</small></button><button type="button" aria-label="Remove attached memo" onClick={() => setAttachments([])}>×</button></div>)}
            <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-label="Upload memo file" onChange={event => { attachMemo(event.target.files[0]); event.target.value = ''; }}/>
            <div className="attachment-tools">{!expanded && <><button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Attach memo</button><span>or drop a file</span>{!attachments.length && <button type="button" onClick={useExample} disabled={busy}>Use example memo</button>}</>}</div><div className="composer-top"><label htmlFor="source">Speaking as</label><select id="source" value={source} onChange={event => setSource(event.target.value)} disabled={busy || expanded}><option>Marketing</option><option>Engineering</option><option>You</option></select><span>{expanded ? 'Read-only replay' : 'Enter to send · Shift+Enter for a new line'}</span></div><div className="composer-input"><label htmlFor="prompt" className="sr-only">Prompt Chronicle</label><textarea id="prompt" ref={inputRef} value={expanded ? '' : input} disabled={busy || expanded} onChange={event => setInput(event.target.value)} placeholder={expanded ? 'Return to the terminal to continue…' : 'Ask anything, or add a project update…'} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/><button type="submit" disabled={busy || expanded || !input.trim()} aria-label="Send prompt">↑</button></div></form>
          </div>
        </section>
      </div>
    </section>
    <footer className="quiet-footer"><span className="prototype-label">LOCAL MEMORY <span>· {providerNames[provider]}</span></span>{expanded ? <div className="replay-controls"><button aria-label="Previous replay step" disabled={cursor === 0} onClick={() => { setPlaying(false); setCursor(cursor - 1); }}>←</button><button onClick={() => { if (traceDone) { setCursor(0); setReplayKey(key => key + 1); } setPlaying(!playing); }}>{playing ? 'Pause' : traceDone ? 'Replay' : 'Play'}</button><button aria-label="Next replay step" disabled={cursor === replay.trace.length - 1} onClick={() => { setPlaying(false); setCursor(cursor + 1); }}>→</button><div role="status"><span>{String(cursor + 1).padStart(2, '0')} / {replay.trace.length}</span><strong>{event?.title}</strong><p>{event?.detail}</p></div></div> : <span className="footer-hint">Responses first. Explore the internals when you choose.</span>}</footer>
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
