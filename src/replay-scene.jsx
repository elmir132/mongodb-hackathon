import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sourceLabel } from './memory.js';
import { activeOperation, replayStatus, segmentStyle, directorPose, recordedModelTrace, serviceGeometry, serviceEvidence, STACK_OFFSET } from './replay-model.js';
import './replay.css';
import { advanceCamera } from './replay-camera.js';
import { createPlayback, seekPlayback, advancePlayback, packetStyle } from './replay-playback.js';
import { cycleServiceRecording } from './replay-cycle.js';

function useCameraPose(node, expanded, reducedMotion, returning) {
  const target = directorPose(node);
  const current = useRef({ pose: directorPose('terminal'), velocity: { x: 0, y: 0, rx: 0, ry: 0, zoom: 0 } });
  const [pose, setPose] = useState(current.current.pose);
  useLayoutEffect(() => {
    if (!expanded || reducedMotion) {
      current.current = { pose: expanded ? target : directorPose('terminal'), velocity: { x: 0, y: 0, rx: 0, ry: 0, zoom: 0 } };
      setPose(current.current.pose);
      return;
    }
    if (returning) return;
    let frame, last = performance.now();
    const tick = now => {
      current.current = advanceCamera(current.current, target, (now - last) / 1000);
      last = now;
      const settled = Object.keys(target).every(key => Math.abs(current.current.pose[key] - target[key]) < .02 && Math.abs(current.current.velocity[key]) < .02);
      if (settled) current.current = { pose: target, velocity: { x: 0, y: 0, rx: 0, ry: 0, zoom: 0 } };
      setPose(current.current.pose);
      if (!settled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [node, expanded, reducedMotion, returning]);
  return pose;
}

const services = {
  atlas: { title: 'MongoDB Atlas', description: 'Stores the project workspace: original documents, facts, conversations, engine resolutions, human decisions, policy versions and trace history. Precedent vectors use Danny’s precedents collection.', input: 'Project-scoped records and source IDs', output: 'Acknowledged writes and stored evidence', owner: 'Sahil · data platform' },
  voyage: { title: 'Voyage AI', description: 'Danny’s retrieval module embeds conflict queries and correction documents. The receipt records the actual model, vector size, input type and measured duration.', input: 'Conflict query or precedent text', output: 'Embedding vector; no authority decision', owner: 'Danny · retrieval, hosted by backend' },
  vector: { title: 'Atlas Vector Search', description: 'Danny’s search filters by project and returns ranked precedent candidates. Only committed precedents can influence the engine. Candidate similarity does not establish applicability.', input: 'Query vector and project filter', output: 'Candidate IDs, scores and scope', owner: 'Danny · retrieval, hosted by backend' },
  engine: { title: 'Resolution engine', description: 'Elmir’s Python engine evaluates source authority, recency and candidate scope. It returns a selected fact or unresolved result, applied precedent ID, policy version and explanation. The browser still extracts limited structured claims from the memo.', input: 'Stored facts, policy and retrieved candidates', output: 'Resolution and explanation; proposed correction policy', owner: 'Elmir · resolution' },
  model: { title: 'Response model', description: 'The selected provider reviews the full memo with project evidence and the engine result. Replay displays its recorded request and response without making another call.', input: 'Prompt, full memo, evidence and policy', output: 'Completed response', owner: 'Existing local provider bridge' },
};


function Wire({ route }) {
  return <div className="scene-route active" aria-hidden="true">
    {route.points.slice(1).map((end, i) => <div key={i} className="wire-segment" style={segmentStyle(route.points[i], end)}/>) }
  </div>;
}

function ProcessStack({ id, step, opened }) {
  const [x, y, z, width, height] = serviceGeometry[id];
  return <div className={`process-stack ${opened ? 'is-open' : ''}`} style={{ left: x, top: y, width, height, transform: `translateZ(${z}px)` }} aria-hidden="true">
    {[2, 1].map((depth, index) => <div className="process-layer" key={depth} style={{ '--layer': depth, '--stack-x': `${STACK_OFFSET.x}px`, '--stack-y': `${STACK_OFFSET.y}px`, '--stack-z': `${STACK_OFFSET.z}px` }}>
      <span className="layer-grid"/>
      <span className="layer-label"><i>{String(index + 1).padStart(2, '0')}</i>{opened ? step.layers[index] : 'Process layer'}</span>
    </div>)}
  </div>;
}

function MotionPacket({ steps, cursor, replayRun, playing, playMode, reducedMotion, returning, onCursorChange, onPlaybackComplete, onPhase }) {
  const element = useRef(null);
  const playback = useRef(null);
  const controls = useRef(null);
  controls.current = { playMode, onCursorChange, onPlaybackComplete, onPhase };
  const reported = useRef('');
  const report = () => {
    const current = playback.current, step = current.steps[current.cursor];
    const reached = current.elapsed >= step.motion.stackDelayMs;
    const key = `${current.cursor}:${reached}`;
    if (key !== reported.current) { reported.current = key; controls.current.onPhase({ id: step.id, reached }); }
  };
  useLayoutEffect(() => {
    playback.current = createPlayback(steps);
    seekPlayback(playback.current, cursor);
  }, [steps, replayRun]);
  useLayoutEffect(() => {
    // Autoplay already advanced this cursor. Only an explicit seek rewinds it.
    if (playback.current.cursor !== cursor) seekPlayback(playback.current, cursor);
    Object.assign(element.current.style, packetStyle(playback.current));
    reported.current = ''; report();
  }, [steps, cursor, replayRun]);
  useLayoutEffect(() => {
    if (!playing || returning) return;
    let frame, last = performance.now();
    const tick = now => {
      const action = advancePlayback(playback.current, Math.min(64, now - last), controls.current.playMode);
      last = now;
      report();
      if (!reducedMotion) Object.assign(element.current.style, packetStyle(playback.current));
      if (action === 'next') controls.current.onCursorChange(playback.current.cursor);
      if (action === 'pause' || action === 'return') { controls.current.onPlaybackComplete(action); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [steps, replayRun, playing, reducedMotion, returning]);
  return <div ref={element} className="motion-packet" aria-hidden="true"/>;
}

function ServiceCard({ id, active, selected, onSelect, children, className = '', title }) {
  return <button type="button" onClick={() => onSelect(id)} className={`service-card service-${id} ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${className}`} aria-label={`Inspect ${services[id].title}`} aria-pressed={selected}>
    <span className="service-heading"><span>{title || (id === 'atlas' && className === 'memory-storage' ? 'Server memory' : services[id].title)}</span><span className="inspect-arrow">↗</span></span>
    {children}
  </button>;
}

export default function ReplayScene({ turn, step, steps, cursor, playing, playMode, replayRun, returning, onCursorChange, onPlaybackComplete, onReturnComplete, onPause, children }) {
  const expanded = Boolean(turn);
  const [scale, setScale] = useState(1);
  const [view, setView] = useState({ x: 0, y: 0 });
  const [exitPhase, setExitPhase] = useState('');
  const [exitRect, setExitRect] = useState(null);
  const [following, setFollowing] = useState(true);
  const [inspected, setInspected] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const viewport = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const inspectorRef = useRef(null);
  const lastInspected = useRef(null);
  const [packetPhase, setPacketPhase] = useState({ id: null, reached: false });
  const evidenceCursor = step ? packetPhase.id === step.id && packetPhase.reached ? step.traceIndex : step.traceStartIndex - 1 : -1;
  const event = step?.event;
  const active = step || activeOperation(event);
  const status = turn ? replayStatus(turn, evidenceCursor) : {};
  const pose = useCameraPose(following ? step?.cameraNode || active.node : 'terminal', expanded, reducedMotion, returning);
  const focused = following && active.node !== 'terminal' ? active.node : null;
  const facts = turn?.candidates || [];
  const engineReached = turn?.trace.slice(0, evidenceCursor + 1).some(event => event.service === 'engine');
  const engineStatus = engineReached ? status : {};
  const visibleFacts = engineReached ? status.recalled ? facts : status.extracted ? turn.incoming : [] : [];
  const displayedFacts = visibleFacts.length && status.recalled && turn?.selected ? [turn.selected, ...visibleFacts.filter(fact => fact.id !== turn.selected.id)].slice(0, 2) : visibleFacts.slice(-2);
  const selected = services[inspected];
  const recording = cycleServiceRecording(steps, cursor, packetPhase.id === step?.id && packetPhase.reached);
  const evidence = Object.fromEntries(Object.keys(services).map(id => [id, id === 'model'
    ? serviceEvidence(turn, id, evidenceCursor)
    : serviceEvidence(recording, id, recording.evidenceCursor)]));
  const candidateApplied = candidate => evidence.engine.events.some(event => event.status === 'succeeded' && event.applied === candidate.precedent_id);
  const latest = id => evidence[id].events.at(-1);
  const embedding = latest('voyage');
  const search = evidence.vector.events.findLast(event => event.stage === 'search');
  const { request, response } = recordedModelTrace(turn ? { trace: turn.trace.slice(0, evidenceCursor + 1) } : null);
  const browserRecording = turn && (turn.serviceMode === 'browser' || (!turn.serviceMode && !turn.trace.some(event => event.service && event.service !== 'model')));
  const responseSeen = Boolean(turn && step && turn.trace.slice(0, evidenceCursor + 1).some(event => event.stage === 'generated'));

  useLayoutEffect(() => {
    const measure = () => {
      const { width, height } = viewport.current.getBoundingClientRect();
      setScale(Math.max(.1, Math.min((width - 60) / 1360, (height - 155) / 800)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setView({ x: 0, y: 0 }); setInspected(null); setFollowing(true); }, [turn?.id, expanded]);
  useEffect(() => { if (playing) { setFollowing(true); setView({ x: 0, y: 0 }); setInspected(null); } }, [playing]);
  useEffect(() => { if (inspected) inspectorRef.current?.focus({ preventScroll: true }); }, [inspected]);
  useEffect(() => {
    if (!returning) { setExitPhase(''); setExitRect(null); return; }
    setInspected(null);
    if (reducedMotion) { onReturnComplete(); return; }
    setExitPhase('flatten');
    let zoomTimer;
    const flattenTimer = setTimeout(() => {
      const rect = viewport.current.querySelector('.terminal').getBoundingClientRect();
      const parent = viewport.current.getBoundingClientRect();
      setExitRect({ left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, height: rect.height });
      setExitPhase('zoom');
      zoomTimer = setTimeout(onReturnComplete, 700);
    }, 1250);
    return () => { clearTimeout(flattenTimer); clearTimeout(zoomTimer); };
  }, [returning, reducedMotion, onReturnComplete]);
  function closeInspector() {
    setInspected(null);
    viewport.current?.querySelector(`.service-${lastInspected.current}`)?.focus({ preventScroll: true });
  }
  function inspect(id) { if (moved.current) return; onPause(); lastInspected.current = id; setInspected(id); }
  function pointerDown(event) {
    if (!expanded || returning || reducedMotion || event.target.closest('button, input, select, textarea, .terminal, .service-inspector, .scene-toolbar') || event.button !== 0) return;
    setFollowing(false); onPause();
    moved.current = false;
    drag.current = { x: event.clientX, y: event.clientY, view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!drag.current) return;
    const dx = (event.clientX - drag.current.x) / 240;
    const dy = (event.clientY - drag.current.y) / 240;
    if (Math.abs(dx) + Math.abs(dy) > .02) moved.current = true;
    setView({ x: Math.max(-1, Math.min(1, drag.current.view.x + dx)), y: Math.max(-1, Math.min(1, drag.current.view.y + dy)) });
  }
  const finishDrag = () => { drag.current = null; moved.current = false; };
  return <div ref={viewport} className={`replay-viewport ${expanded ? 'revealed' : 'working-view'} ${!reducedMotion ? 'has-depth' : 'flat-view'} ${active.node === 'terminal' ? 'terminal-active' : ''} ${focused ? 'directed-focus' : ''} ${exitPhase ? `return-${exitPhase}` : ''}`} style={exitRect ? { '--exit-left': `${exitRect.left}px`, '--exit-top': `${exitRect.top}px`, '--exit-width': `${exitRect.width}px`, '--exit-height': `${exitRect.height}px` } : undefined} data-focus={focused || 'overview'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
    {expanded && <div className="scene-toolbar">
      <div><span className="scene-eyebrow">LIVING LEDGER / {turn?.correction ? 'HUMAN CORRECTION' : 'REQUEST REVIEW'}</span><p>{browserRecording ? 'Browser-only recording · send a new conflict to record connected services' : 'Recorded run · automatic camera'}</p></div>
    </div>}
    <div className="scene-fit" style={{ '--scene-scale': scale }}>
      <div className="scene-world" style={{ '--pan-x': `${view.x * 22}px`, '--pan-y': `${view.y * 12}px`, '--rotate-x': `${pose.rx - view.y * 4}deg`, '--rotate-y': `${pose.ry + view.x * 6}deg`, '--director-x': `${pose.x}px`, '--director-y': `${pose.y}px`, '--director-zoom': pose.zoom }}>
        {expanded && <>
          <div className="scene-plane conversation-plane" aria-hidden="true"><span>01 / CONVERSATION</span></div>
          <div className="scene-plane execution-plane" aria-hidden="true"><span>02 / REASON + RESPOND</span></div>
          <div className="scene-plane memory-plane" aria-hidden="true"><span>03 / PERSIST + RETRIEVE</span><small>PROJECT: ATLAS LAUNCH</small></div>
          {Object.keys(serviceGeometry).map(id => <ProcessStack key={id} id={id} step={step} opened={focused === id && !returning && !reducedMotion}/>)}
          {step?.transfer && <Wire key={step.transfer.id} route={step.transfer}/>}
          {step && <MotionPacket steps={steps} cursor={cursor} replayRun={replayRun} playing={playing} playMode={playMode} reducedMotion={reducedMotion} returning={returning} onCursorChange={onCursorChange} onPlaybackComplete={onPlaybackComplete} onPhase={setPacketPhase}/>}
          <ServiceCard id="atlas" title={browserRecording ? "Browser memory" : undefined} active={active.node === 'atlas'} selected={inspected === 'atlas'} onSelect={inspect} className={turn.serviceMode === 'server-memory' ? 'memory-storage' : ''}>
            <span className="service-tag">{browserRecording ? 'RECORDED LOCAL STORAGE' : evidence.atlas.tag}</span>
            <span className="database-glyph" aria-hidden="true"><i/><i/><i/></span>
            <strong className="service-result">{event?.entity === 'document' ? event.stage === 'write' ? 'Saving original memo' : 'Original memo retained' : event?.stage === 'write' ? turn.correction ? 'Saving the correction' : 'Saving incoming claims' : event?.stage === 'commit' ? 'Saving decision + evidence' : status.committed ? turn.serviceMode === 'atlas' ? 'Decision saved in Atlas' : 'Decision saved' : status.saved ? turn.correction ? 'Human answer saved' : 'Write confirmed' : 'Project memory'}</strong>
            <span className="collection-list"><span>facts</span><span>precedents</span><span>policy versions</span></span>
            <span className="service-description">{turn.factCount - (status.saved ? 0 : turn.incoming.length)} retained facts · original sources preserved</span>
            <span className="service-bottom">{status.committed ? 'Answer + supporting IDs + trace retained' : 'Documents → claims → decisions'}</span>
          </ServiceCard>
          <ServiceCard id="engine" active={active.node === 'engine'} selected={inspected === 'engine'} onSelect={inspect} className={engineStatus.compared && turn.conflict ? 'has-conflict' : ''}>
            <span className="service-tag">{evidence.engine.tag}</span>
            <strong className="service-result">{engineStatus.resolved ? turn.selected?.value ? `${turn.selected.value} selected` : turn.correction ? 'Left unresolved' : turn.conflict ? 'Human input needed' : 'Answer prepared' : engineStatus.policy && turn.applied ? 'Scoped precedent applies' : engineStatus.compared && turn.conflict ? 'Two claims. One conflict.' : 'Check evidence and authority'}</strong>
            <span className="claim-pair">{visibleFacts.length ? displayedFacts.map(fact => <span key={fact.id} className={`claim ${fact.source.toLowerCase()} ${engineStatus.resolved && turn.selected?.id === fact.id ? 'used' : ''}`}><small>{sourceLabel(fact)}</small><b>{fact.value}</b></span>) : <span className="no-claims">{engineStatus.recalled ? 'No matching structured facts for this request.' : 'Stored evidence appears after the memory read.'}</span>}</span>
            <span className={`engine-policy ${engineStatus.policy && turn.applied ? 'lesson-used' : ''}`}>{engineStatus.policy ? `Policy v${turn.policy}` : 'Policy pending'} <span>·</span> {engineStatus.policy ? turn.applied ? 'Saved precedent applied' : turn.correction ? 'Recorded human answer' : 'No precedent applied' : 'Applicability checked before use'}</span>
          </ServiceCard>
          <ServiceCard id="model" active={active.node === 'model'} selected={inspected === 'model'} onSelect={inspect}>
            <span className="model-orbit" aria-hidden="true"><i/><i/><i/></span>
            <span className="service-description">{request ? `${request.model} · request sent` : responseSeen ? 'Response received' : 'Awaiting a recorded model request'}</span>
            <span className="model-input-counts">{request ? `${request.attachments.length} files · ${request.factIds.length} facts · ${request.noteIds.length} notes · ${request.history.length} prior exchanges` : turn.provider === 'local' ? 'No provider call in this turn' : 'Request context appears when sent'}</span>
            <span className="service-bottom">{response && responseSeen ? `${response.characters} characters returned · ${(response.elapsedMs / 1000).toFixed(1)}s` : request ? `${request.transport} · policy v${request.policyVersion}` : 'Recorded response boundary'}</span>
          </ServiceCard>
          <ServiceCard id="voyage" active={active.node === 'voyage'} selected={inspected === 'voyage'} onSelect={inspect}>
            <span className="service-tag">{evidence.voyage.tag}</span>
            <strong className="service-result">Text → vector</strong>
            <span className="embedding-glyph"><strong>{embedding?.status === 'succeeded' ? `${embedding.dimensions.toLocaleString()} dimensions` : 'No measured vector'}</strong></span>
            <span className="service-description">Conflict query + saved precedents</span>
            <span className="service-bottom">{embedding?.status === 'succeeded' ? `${embedding.model} · ${embedding.dimensions} dimensions · ${embedding.elapsedMs} ms` : embedding ? 'Request failed; no vector returned' : 'No embedding request recorded'}</span>
          </ServiceCard>
          <ServiceCard id="vector" active={active.node === 'vector'} selected={inspected === 'vector'} onSelect={inspect}>
            <span className="service-tag">{evidence.vector.tag}</span>
            <strong className="service-result">Find candidate lessons</strong>
            <span className="search-glyph">{search?.candidates?.length ? search.candidates.slice(0, 2).map(candidate => <span key={candidate.precedent_id}>{candidate.precedent_id}<small>{candidate.score.toFixed(3)} · {candidateApplied(candidate) ? 'applied by engine' : 'candidate only'}</small></span>) : <span>{search?.status === 'succeeded' ? 'No matching precedent' : 'No recorded candidates'}</span>}</span>
            <span className="service-description">{search?.status === 'succeeded' ? `${search.candidates.length} candidates returned · project filtered` : 'No successful search recorded'}</span>
            <span className="service-bottom">Candidate ≠ applied precedent</span>
          </ServiceCard>
        </>}
        {children}
      </div>
    </div>
    {expanded && step && <div className={`process-caption ${step.kind === 'illustration' ? 'illustrated' : ''}`} aria-label="Current data transformation">
      <div><span>INPUT</span><strong>{step.input}</strong></div><i aria-hidden="true">→</i>
      <div className="caption-operation"><span>{step.kind === 'illustration' ? 'PLANNED PROCESS' : 'OPERATION'}</span><strong>{step.operation}</strong></div><i aria-hidden="true">→</i>
      <div><span>OUTPUT</span><strong>{step.output}</strong></div>
    </div>}
    {expanded && <div className="scene-legend"><span><i/>Recorded operation</span><span>Connections follow recorded station visits</span><span className="pan-hint">{following ? 'Camera follows each step · pause anytime for narration' : 'Exploration paused · press Play to resume the guided flow'}</span></div>}
    {selected && expanded && <aside className="service-inspector" aria-label={`${selected.title} details`} ref={inspectorRef} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') closeInspector(); }}>
      <button className="inspector-close" aria-label="Close service details" onClick={closeInspector}>×</button>
      <span className="scene-eyebrow">SERVICE / {evidence[inspected].tag}</span><h2>{selected.title}</h2><p>{selected.description}</p>
      <dl><dt>Receives</dt><dd>{selected.input}</dd><dt>Returns</dt><dd>{selected.output}</dd></dl>
      {inspected === 'engine' && <div className="decision-evidence"><strong>{status.policy ? `Policy v${turn.policy} · ${turn.applied ? 'precedent applied' : 'no precedent applied'}` : 'Policy not yet evaluated in replay'}</strong>{facts.map(fact => <p key={fact.id}>{sourceLabel(fact)}: {fact.value}<small>{fact.document || fact.id}{fact.sourceDate ? ` · ${fact.sourceDate}` : ''}</small></p>)}{status.policy && turn.applied && <p>{turn.lesson?.text}<small>{turn.applied} · {turn.lesson?.project} / {turn.lesson?.scope}</small></p>}</div>}
      {inspected === 'model' && <div className="model-receipt">
        {request ? <><h3>What was sent</h3><p className="request-prompt">{request.prompt}</p><dl>
          <dt>Provider request</dt><dd>{request.provider} / {request.model}<small>{request.transport} · {request.contextBytes.toLocaleString()} context bytes</small></dd>
          <dt>Instructions</dt><dd>{request.instructions}</dd>
          <dt>Attached documents ({request.attachments.length})</dt><dd>{request.attachments.length ? request.attachments.map(file => <span key={file.name}>{file.name} · {file.characters.toLocaleString()} characters<br/></span>) : 'None'}</dd>
          <dt>Conversation history ({request.history.length} prior exchanges)</dt><dd>{request.history.length ? request.history.map((item, i) => <span key={item.id || i}>{item.prompt}<br/></span>) : 'No prior exchanges sent'}</dd>
          <dt>Project context actually sent</dt><dd>{request.factIds.length} facts · {request.noteIds.length} notes · policy v{request.policyVersion}<small>Selected fact: {request.selectedFactId || 'none'}<br/>Lesson: {request.lessonId || 'none'}</small></dd>
        </dl><details><summary>Sent fact IDs</summary><p>{request.factIds.join(' · ') || 'None'}</p></details></> : <p>{turn.provider === 'local' ? 'No provider request was made for this turn.' : 'This older turn has no captured request receipt. Replay does not reconstruct or guess its payload.'}</p>}
        {response && responseSeen && <p className="integration-note">Response: {response.characters.toLocaleString()} characters · {(response.elapsedMs / 1000).toFixed(1)} seconds measured. Playback timing is shortened for narration.</p>}
      </div>}
      {inspected !== 'model' && <div className="service-receipts">{evidence[inspected].events.map(receipt => <details key={receipt.id}><summary>{receipt.title} · {receipt.status} · {receipt.elapsedMs} ms</summary><p>{receipt.inputSummary} → {receipt.outputSummary}</p>{receipt.candidates?.map(candidate => <p key={candidate.precedent_id}>{candidate.precedent_id} · score {candidate.score.toFixed(3)} · {candidateApplied(candidate) ? 'applied by engine' : 'candidate only'}<small>{candidate.scope.project_id} / {candidate.scope.topic}</small></p>)}{receipt.policyDiff && <p>Policy v{receipt.policyDiff.previous_version} → v{receipt.policyDiff.new_version}: {receipt.policyDiff.before.join(' > ')} → {receipt.policyDiff.after.join(' > ')}</p>}</details>)}</div>}
      <p className="integration-note">{inspected === 'model'  && turn.provider === 'local' ? 'This turn used local rules. No provider call occurred.' : evidence[inspected].current}</p><small>{selected.owner}</small>
      <details><summary>Development tools</summary><p>MongoDB Agent Skills and MCP help the team inspect schemas and query Atlas during development. They are not runtime stops in this application flow. Python clients connect the retrieval module to Voyage and MongoDB.</p></details>
    </aside>}
  </div>;
}
