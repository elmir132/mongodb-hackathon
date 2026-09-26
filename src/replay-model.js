// Presentation only: never executes retrieval, persistence, or generation.
export function reachedStage(trace, cursor, stage, predicate = () => true) {
  const index = trace.findIndex(event => event.stage === stage && predicate(event));
  return index >= 0 && cursor >= index;
}

export function replayStatus(turn, cursor) {
  const reached = (stage, predicate) => reachedStage(turn.trace, cursor, stage, predicate);
  return {
    saved: reached('saved', event => event.entity !== 'document'),
    extracted: reached('extract'),
    recalled: reached('recall') || reached('memory-read'),
    compared: reached('compare') || reached('policy'),
    policy: reached('policy'),
    resolved: reached('resolve') || reached('policy', event => event.service === 'engine' && event.selectedFactId !== undefined),
    committed: reached('committed'),
  };
}

export function serviceEvidence(turn, id, cursor = Infinity) {
  const matches = event => event.service === id || (id === 'atlas' && event.service === 'storage');
  const events = (turn?.trace || []).slice(0, cursor + 1).filter(matches);
  const upcoming = (turn?.trace || []).slice(cursor + 1).some(matches);
  const failed = events.some(event => ['failed', 'unavailable'].includes(event.status));
  const confirmed = events.some(event => event.status === 'succeeded');
  const local = id === 'atlas' && events.some(event => event.service === 'storage');
  let absent = 'No call to this service was captured in this replay.';
  if (id === 'vector' || id === 'voyage') {
    const visible = (turn?.trace || []).slice(0, cursor + 1);
    if (turn?.serviceMode === 'browser') absent += ' This older browser-only recording predates the connected retrieval path. Submit a new conflicting update to capture Voyage and Atlas Vector Search.';
    else if (visible.some(event => event.stage === 'retrieval-unavailable')) absent += ' Retrieval was unavailable; inspect the recorded service failure. The engine continued with stored policy.';
    else if (visible.some(event => event.humanReview)) absent += ' This request reused a saved human answer for the same claims, so no new precedent search was needed.';
    else absent += ' Precedent retrieval runs for new structured conflicts, not every message. It uses Voyage to embed the conflict, then searches Atlas for candidate lessons.';
  }
  return { events, tag: local ? 'SERVER MEMORY · NOT ATLAS' : failed ? 'RECORDED FAILURE' : confirmed ? 'LIVE · RECORDED' : upcoming ? 'NOT REACHED YET' : 'NOT CALLED IN THIS REPLAY',
    current: events.length ? `${events.length} recorded operations in this replay${failed ? ' · includes a failure' : ''}. Inspect their receipts below.` : upcoming ? 'This call appears later in the recording.' : absent };
}

// Narration uses the receipt's result; IDs, scores and full explanations remain
// in the inspector. A retrieved candidate must never read as an applied lesson.
export function replayOutput(step) {
  const receipt = step.events?.findLast(event => event.status === 'succeeded');
  if (receipt?.service === 'vector' && receipt.stage === 'search' && Array.isArray(receipt.candidates)) {
    const count = receipt.candidates.length;
    return `${count} candidate ${count === 1 ? 'lesson' : 'lessons'} returned for applicability checking`;
  }
  if (receipt?.service === 'voyage' && Number.isFinite(receipt.dimensions)) {
    return `${receipt.dimensions.toLocaleString()}-dimension embedding${receipt.model ? ` · ${receipt.model}` : ''}`;
  }
  if (receipt?.service === 'engine' && receipt.stage === 'policy') {
    if (receipt.policyDiff) return `Scoped policy v${receipt.policyDiff.previous_version} → v${receipt.policyDiff.new_version}`;
    const fact = step.turn?.candidates?.find(item => item.id === receipt.selectedFactId);
    if (fact) return `${fact.value} selected · ${receipt.applied ? 'scoped lesson applied' : 'current policy'} · policy v${step.turn.policy}`;
    if (receipt.selectedFactId === null) return 'No justified selection · human input needed';
  }
  return step.output;
}

export function activeOperation(event) {
  if (!event) return { node: null, route: null };
  if (event.service === 'model' && event.route === 'model-answer') return { node: 'terminal', route: 'model-answer' };
  if (event.service === 'model' && event.route === 'prompt-to-model') return { node: 'model', route: 'prompt-to-model' };
  // Explicit service receipts override legacy stage assumptions. Browser parsing
  // never lights up the Python engine; a storage receipt names its real backend.
  if (event.service && event.service !== 'model') {
    const node = event.service === 'local' ? 'terminal' : event.service === 'storage' ? 'atlas' : event.service;
    if (['terminal', 'atlas', 'voyage', 'vector', 'engine'].includes(node)) return { node, route: routes.some(route => route.id === event.route) ? event.route : null };
  }
  switch (event.stage) {
    case 'receive': return { node: 'terminal', route: null };
    case 'write': return { node: 'atlas', route: event.entity === 'extracted-facts' ? 'fact-write' : 'ingest' };
    case 'saved': return { node: 'atlas', route: null };
    case 'recall': case 'extract': case 'compare': case 'policy': return { node: 'terminal', route: null };
    case 'generate': return { node: 'model', route: 'generate', secondaryRoute: 'prompt-to-model' };
    case 'generated': return { node: 'terminal', route: 'model-answer' };
    case 'resolve': return { node: 'terminal', route: null };
    case 'commit': return { node: 'atlas', route: 'decision-write' };
    case 'committed': return { node: 'atlas', route: null };
    case 'respond': return { node: 'terminal', route: 'respond' };
    default: return { node: ['atlas', 'voyage', 'vector', 'engine', 'model', 'terminal'].includes(event.service) ? event.service : null, route: routes.some(route => route.id === event.route) ? event.route : null };
  }
}

// Node ports and wires share world coordinates, including actual depth.
export const routes = [
  { id: 'ingest', points: [[285, 385, 150], [285, 455, 150], [235, 455, -65], [235, 510, -65]] },
  { id: 'fact-write', points: [[650, 230, 55], [590, 230, 55], [590, 465, -65], [235, 465, -65], [235, 510, -65]] },
  { id: 'recall', points: [[235, 510, -65], [235, 465, -65], [590, 465, 55], [590, 205, 55], [650, 205, 55]] },
  { id: 'generate', points: [[915, 330, 55], [915, 350, 55]] },
  { id: 'prompt-to-model', points: [[550, 315, 150], [605, 315, 150], [605, 415, 55], [650, 415, 55]] },
  { id: 'model-answer', points: [[650, 415, 55], [605, 415, 55], [605, 315, 150], [550, 315, 150]] },
  { id: 'model-return', points: [[650, 415, 55], [610, 415, 55], [610, 285, 55], [650, 285, 55]] },
  { id: 'decision-write', points: [[650, 285, 55], [590, 285, 55], [590, 465, -65], [235, 465, -65], [235, 510, -65]] },
  { id: 'respond', points: [[235, 510, -65], [235, 455, -65], [285, 455, 150], [285, 385, 150]] },
  // Activated only by recorded server receipts.
  { id: 'embed', points: [[760, 330, 55], [760, 490, -65], [645, 490, -65], [645, 510, -65]] },
  { id: 'search', points: [[770, 615, -65], [840, 615, -65]] },
  { id: 'embedding-write', points: [[520, 615, -65], [420, 615, -65]] },
  { id: 'index-check', points: [[420, 675, -65], [480, 770, -65], [980, 770, -65], [980, 730, -65]] },
  { id: 'candidates', points: [[1120, 560, -65], [1180, 560, -65], [1180, 285, 55], [1140, 285, 55]] },
];

export const serviceGeometry = {
  atlas: [60, 510, -65, 360, 220], engine: [650, 80, 55, 490, 250],
  model: [650, 350, 55, 490, 130], voyage: [520, 510, -65, 250, 220], vector: [840, 510, -65, 280, 220],
};
export const TELEPORT_MS = 250;
const STACK_BOUNCE_SPEED = 1.25;
export const STACK_OFFSET = { x: 34, y: 25, z: -95 };
// Stop just above the lowest sheet so the packet's glow does not overshoot it.
const STACK_BOUNCE_DEPTH = 1.6;
export function stackPoint(node, depth) {
  const [x, y, z, width, height] = serviceGeometry[node];
  return [x + width + 2 + depth * STACK_OFFSET.x, y + height + 2 + depth * STACK_OFFSET.y, z + 4 + depth * STACK_OFFSET.z];
}

// One persistent dot. Fade out/in over the teleport beat, changing position
// only at zero opacity instead of drawing a connecting flight.
export function packetKeyframes(step) {
  const points = [];
  const add = (time, point, opacity = 1) => points.push({ time, point, opacity });
  const route = step.transfer;
  if (step.motion.transitPoints) {
    const path = step.motion.transitPoints;
    const lengths = path.slice(1).map((point, i) => Math.hypot(...point.map((n, axis) => n - path[i][axis])));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    let distance = 0;
    path.forEach((point, i) => {
      if (i) distance += lengths[i - 1];
      add(step.motion.transitDelayMs + (total ? distance / total : i / (path.length - 1)) * step.motion.transitMs, point);
    });
  } else if (step.motion.routeMs && route) {
    const lengths = route.points.slice(1).map((point, i) => Math.hypot(...point.map((n, axis) => n - route.points[i][axis])));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    let distance = 0;
    route.points.forEach((point, i) => {
      if (i) distance += lengths[i - 1];
      add(step.motion.departureDelayMs + distance / total * step.motion.routeMs, point);
    });
    if (step.motion.stackMs) add(step.motion.stackDelayMs - TELEPORT_MS / 2, route.points.at(-1), 0);
  }
  if (step.motion.stackMs && serviceGeometry[step.node]) {
    if (step.motion.routeMs) add(step.motion.stackDelayMs - TELEPORT_MS / 2, stackPoint(step.node, 0), 0);
    [0, .5, 1, .5, 0].forEach((progress, i) => add(step.motion.stackDelayMs + i / 4 * step.motion.stackMs, stackPoint(step.node, progress * STACK_BOUNCE_DEPTH)));
  }
  const at = time => {
    let i = 0;
    while (i + 1 < points.length && points[i + 1].time <= time) i++;
    const a = points[i], b = points[i + 1];
    if (!b || time <= a.time) return a;
    const fraction = (time - a.time) / (b.time - a.time);
    return { point: a.point.map((n, axis) => n + (b.point[axis] - n) * fraction), opacity: a.opacity + (b.opacity - a.opacity) * fraction };
  };
  const start = step.motion.departureDelayMs;
  const visible = [{ ...at(start), time: start }, ...points.filter(item => item.time > start && item.time < step.duration), { ...at(step.duration), time: step.duration }];
  const frames = visible.map(({ time, point, opacity }) => ({ offset: time / step.duration, transform: `translate3d(${point[0]}px, ${point[1]}px, ${point[2]}px)`, opacity }));
  return start && step.motion.teleportFrom ? [
    { offset: 0, transform: step.motion.teleportFrom, opacity: 1 },
    { offset: start / 2 / step.duration, transform: step.motion.teleportFrom, opacity: 0 },
    { offset: start / 2 / step.duration, transform: frames[0].transform, opacity: 0 },
    ...frames,
  ] : frames;
}

export function segmentStyle(start, end) {
  const [dx, dy, dz] = end.map((value, i) => value - start[i]);
  const length = Math.hypot(dx, dy, dz);
  return {
    width: length,
    transform: `translate3d(${start[0]}px, ${start[1]}px, ${start[2]}px) rotateZ(${Math.atan2(dy, dx)}rad) rotateY(${-Math.atan2(dz, Math.hypot(dx, dy))}rad)`,
  };
}

// One recorded event = one replay step. Never infer service execution from a
// conflict, a candidate, or a service's presence in the architecture diagram.
export function buildReplaySteps(turn) {
  if (!turn) return [];
  const steps = turn.trace.map((event, traceIndex) => ({
    id: event.id, kind: 'recorded', traceIndex, traceStartIndex: traceIndex, events: [event], event,
    ...activeOperation(event), ...describeProcess(turn, event),
    ...(event.inputSummary ? { input: event.inputSummary } : {}),
    ...(event.outputSummary ? { output: event.outputSummary } : {}),
    ...(event.operation ? { operation: event.operation } : {}),
  }));
  // A browser write intent and its backend receipt describe one operation.
  // Keep both captions, at the destination, without another trip through the UI.
  steps.forEach((step, i) => {
    if (['write', 'commit'].includes(step.event.stage) && step.event.service === 'local') {
      const receipt = steps[i + 1];
      if (receipt?.node === 'atlas') step.node = 'atlas';
    }
  });
  const beats = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (['write', 'commit'].includes(step.event.stage)) {
      const confirmation = step.event.stage === 'write' ? 'saved' : 'committed';
      let last = i;
      if (steps[last + 1]?.event.stage === 'storage' && steps[last + 1].node === step.node) last++;
      if (steps[last + 1]?.event.stage === confirmation) last++;
      if (last > i) {
        const end = steps[last];
        beats.push({ ...step, traceIndex: end.traceIndex, events: steps.slice(i, last + 1).flatMap(item => item.events), output: end.output });
        i = last;
        continue;
      }
    }
    beats.push(step);
  }
  return compileReplayMotion(beats);
}

export function compileReplayMotion(steps) {
  for (let start = 0; start < steps.length;) {
    const first = steps[start];
    let end = start + 1;
    // A station visit has one arrival and one bounce, regardless of how many
    // bookkeeping captions or repeated route hints the receipts contain.
    while (end < steps.length && steps[end].node === first.node && steps[end].turn === first.turn) end++;
    const previous = start ? steps[start - 1] : null;
    const from = previous?.node || 'terminal';
    const transfer = connectionBetween(from, first.node);
    const routeMs = transfer ? 1000 : 0;
    if (first.node === 'terminal') {
      // Chat bookkeeping rides the incoming transfer. No in-chat sweep, bounce,
      // arrival teleport, or camera excursion for every local caption.
      const transitPoints = transfer?.points || [[532, 110, 154], [532, 365, 154]];
      const transitMs = transfer ? 1000 : 500;
      const departure = previous ? TELEPORT_MS : 0;
      const teleportFrom = previous ? packetKeyframes(previous).at(-1).transform : null;
      let elapsed = 0;
      for (let i = start; i < end; i++) {
        steps[i].transfer = transfer;
        steps[i].duration = transitMs / (end - start) + (i === start ? departure : 0);
        steps[i].cameraNode = previous?.cameraNode || 'terminal';
        steps[i].motion = { groupId: first.id, routeMs: i === start ? routeMs : 0, packetRoute: transfer?.id || null,
          departureDelayMs: i === start ? departure : 0, teleportFrom, stackMs: 0, terminalMs: 0,
          stackDelayMs: departure - elapsed, transitPoints, transitMs, transitDelayMs: departure - elapsed };
        elapsed += steps[i].duration;
      }
      start = end;
      continue;
    }
    const processMs = Math.max(2400, (end - start) * 1200) / STACK_BOUNCE_SPEED;
    const stackMs = first.node !== 'terminal' ? processMs : 0;
    const terminalMs = first.node === 'terminal' ? processMs : 0;
    const sliceMs = processMs / (end - start);
    const departureDelayMs = previous && (transfer || previous.turn !== first.turn) ? TELEPORT_MS : 0;
    const arrivalDelayMs = transfer ? TELEPORT_MS : 0;
    const teleportFrom = previous ? packetKeyframes(previous).at(-1).transform : null;
    let elapsedMs = 0;
    for (let i = start; i < end; i++) {
      const duration = sliceMs + (i === start ? departureDelayMs + routeMs + arrivalDelayMs : 0);
      steps[i].transfer = transfer;
      steps[i].cameraNode = first.node;
      steps[i].motion = {
        groupId: first.id, routeMs: i === start ? routeMs : 0,
        packetRoute: transfer?.id || null,
        departureDelayMs: i === start ? departureDelayMs : 0, teleportFrom,
        stackMs, terminalMs, stackDelayMs: departureDelayMs + routeMs + arrivalDelayMs - elapsedMs,
      };
      steps[i].duration = duration;
      elapsedMs += duration;
    }
    start = end;
  }
  return steps;
}

// These paths describe consecutive recorded station visits, not stage-name
// guesses. Every endpoint is on the corresponding card, in shared coordinates.
export function connectionBetween(from, to) {
  if (!from || !to || from === to) return null;
  const known = {
    'terminal:atlas': routes.find(route => route.id === 'ingest').points,
    'terminal:model': routes.find(route => route.id === 'prompt-to-model').points,
    'terminal:engine': [[550, 205, 150], [605, 205, 150], [605, 205, 55], [650, 205, 55]],
    'atlas:engine': routes.find(route => route.id === 'recall').points,
    'engine:voyage': [[650, 285, 55], [600, 285, 55], [600, 485, -65], [645, 485, -65], [645, 510, -65]],
    'voyage:vector': routes.find(route => route.id === 'search').points,
    'voyage:atlas': routes.find(route => route.id === 'embedding-write').points,
    'atlas:vector': routes.find(route => route.id === 'index-check').points,
    'vector:engine': routes.find(route => route.id === 'candidates').points,
    'atlas:model': [[420, 615, -65], [470, 615, -65], [470, 485, -65], [605, 485, 55], [605, 415, 55], [650, 415, 55]],
  };
  const points = known[`${from}:${to}`] || known[`${to}:${from}`]?.slice().reverse();
  if (points) return { id: `${from}:${to}`, from, to, points };
  const geometry = { terminal: [60, 70, 150, 490, 315], ...serviceGeometry };
  const a = geometry[from], b = geometry[to];
  if (!a || !b) return null;
  // Uncommon transitions take the outer corridor rather than cross other cards.
  const start = [a[0] + a[3], a[1] + a[4] / 2, a[2]];
  const finish = [b[0] + b[3], b[1] + b[4] / 2, b[2]];
  return { id: `${from}:${to}`, from, to, points: [start, [1210, start[1], start[2]], [1210, finish[1], finish[2]], finish] };
}

export function recordedModelTrace(turn) {
  return {
    request: turn?.trace.find(event => event.stage === 'generate')?.request,
    response: turn?.trace.find(event => event.stage === 'generated')?.response,
  };
}

export function playbackAction(cursor, count, mode) {
  if (mode === 'step') return 'pause';
  return cursor < count - 1 ? 'next' : 'return';
}

function describeProcess(turn, event) {
  const claims = turn.incoming?.map(fact => `${fact.source}: ${fact.value}`).join(' · ') || 'Candidate claims';
  const prior = turn.candidates?.find(fact => fact.seeded);
  const choice = turn.selected?.value || 'Human input needed';
  const document = event.entity === 'document';
  const { request, response } = recordedModelTrace(turn);
  const promptExcerpt = (request?.prompt || turn.prompt || '').slice(0, 95);
  const bundle = request ? `${request.attachments.length} files · ${request.factIds.length} facts · ${request.noteIds.length} notes · ${request.history.length} prior exchanges` : 'Request details not captured for this older turn';
  const phases = {
    receive: ['Review request + source', 'Receive the message', turn.attachments?.length ? 'Memo ready for review' : 'Message ready', ['Message', 'Source identity'], 2000],
    write: [document ? 'Original memo + author' : turn.correction ? 'Human answer + reason' : turn.incoming?.length ? claims : 'Conversation message', document ? 'Preserve the original source' : turn.correction ? 'Record the human answer' : 'Append to project memory', 'Write awaiting confirmation', ['Source envelope', 'Pending record'], 2200],
    saved: ['Acknowledged write', 'Confirm persistence', document ? 'Original memo retained' : turn.correction ? `Human answer saved · policy v${turn.policy}` : event.service === 'atlas' ? 'Record confirmed in Atlas' : event.service === 'storage' ? 'Record retained in server memory' : 'Record saved locally', ['Retained source', 'Confirmed record'], 2000],
    extract: ['Complete uploaded memo', 'Extract factual claims', claims, ['Source text', 'Candidate claims'], 2600],
    recall: [turn.subject || 'Request context', 'Read matching project facts', prior ? `${prior.author || prior.source}: ${prior.value} · ${prior.sourceDate || 'stored evidence'}` : 'Available project evidence', ['Project + subject', 'Prior evidence'], 2600],
    compare: ['New claims + stored evidence', 'Check for incompatible values', turn.conflict ? 'Conflict found' : 'No conflicting values found', ['Comparable claims', 'Conflict check'], 2600],
    policy: [turn.applied ? 'Saved lesson + current facts' : turn.correction ? 'Recorded human answer' : `Facts + policy v${turn.policy}`, 'Check scope and authority', turn.applied ? `Precedent applies → ${choice}` : turn.correction ? event.detail : turn.selected ? `Policy favors ${choice}` : 'No justified fact selection', ['Scope check', turn.applied ? 'Precedent applies' : 'Authority rule'], 3200],
    generate: [promptExcerpt, request ? `${request.model} · ${request.transport}` : turn.model || 'Recorded model call', bundle, request ? [`${request.attachments.length} files · ${request.history.length} prior exchanges`, `${request.factIds.length} facts · policy v${request.policyVersion}`] : ['Request detail not captured', 'Recorded provider boundary'], 3400],
    generated: [request?.model || turn.model || 'Recorded model call', 'Receive the model response', response ? `${response.characters} characters · ${(response.elapsedMs / 1000).toFixed(1)}s measured` : 'Response received · timing not captured', ['Provider boundary', 'Returned answer'], 2200],
    resolve: ['Evidence + evaluated policy', 'Record the decision basis', turn.selected ? `${choice} · policy v${turn.policy}` : turn.correction || turn.conflict ? 'Unresolved · human input needed' : 'Answer prepared', ['Supporting facts', 'Decision basis'], 2400],
    commit: ['Answer + supporting evidence', 'Append decision and trace', 'Decision write pending', ['Evidence IDs', 'Pending decision'], 2000],
    committed: ['Pending decision write', 'Confirm persistence', 'Answer + evidence retained', ['Decision record', 'Confirmed history'], 1800],
    respond: ['Saved answer + evidence', 'Return to the conversation', 'Reviewed answer, with context', ['Saved response', 'Conversation'], 2800],
  };
  const [input, operation, output, layers] = phases[event.stage] || [event.inputSummary || 'Input not captured', event.title, event.outputSummary || event.detail || 'Output not captured', ['Recorded input', 'Recorded output'], 2400];
  return { input, operation, output, layers };
}

// Held per service: consecutive stages don't make the camera oscillate.
export function directorPose(node) {
  const poses = {
    terminal: { x: 0, y: 0, rx: 16, ry: -9, zoom: 1 },
    atlas: { x: 330, y: -370, rx: 18, ry: -16.5, zoom: 1.3 },
    engine: { x: -230, y: 180, rx: 18, ry: -16.5, zoom: 1.3 },
    model: { x: -220, y: -20, rx: 18, ry: -16.5, zoom: 1.3 },
    voyage: { x: -45, y: -240, rx: 18, ry: -16.5, zoom: 1.3 },
    vector: { x: -420, y: -190, rx: 18, ry: -16.5, zoom: 1.3 },
  };
  return poses[node] || poses.terminal;
}
