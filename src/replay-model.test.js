import test from 'node:test';
import assert from 'node:assert/strict';
import { reachedStage, replayStatus, activeOperation, routes, segmentStyle, replayOutput } from './replay-model.js';
import { processPrompt, seedState } from './memory.js';

test('missing stages never appear completed and confirmation gates saved status', () => {
  const trace = [{ stage: 'receive' }, { stage: 'write' }, { stage: 'saved', entity: 'document' }, { stage: 'extract' }, { stage: 'saved' }, { stage: 'commit' }, { stage: 'committed' }];
  assert.equal(reachedStage(trace, 6, 'resolve'), false);
  assert.equal(replayStatus({ trace }, 2).saved, false);
  assert.equal(replayStatus({ trace }, 4).saved, true);
  assert.equal(replayStatus({ trace }, 5).committed, false);
  assert.equal(replayStatus({ trace }, 6).committed, true);
});

test('narration distinguishes retrieved candidates, applied lessons, and failed receipts', () => {
  const output = 'Original recorded explanation';
  const search = { service: 'vector', stage: 'search', status: 'succeeded', candidates: [{ precedent_id: 'p1' }] };
  assert.match(replayOutput({ events: [search], output }), /1 candidate lesson/);
  assert.doesNotMatch(replayOutput({ events: [search], output }), /applied/);
  const turn = { policy: 2, candidates: [{ id: 'f1', value: 'Thursday' }], applied: 'stale-other-lesson' };
  const policy = { service: 'engine', stage: 'policy', status: 'succeeded', selectedFactId: 'f1', applied: null };
  assert.match(replayOutput({ events: [policy], turn, output }), /Thursday selected · current policy/);
  assert.match(replayOutput({ events: [{ ...policy, applied: 'p1' }], turn, output }), /scoped lesson applied/);
  assert.equal(replayOutput({ events: [{ ...policy, status: 'failed' }], turn, output }), output);
  assert.equal(replayOutput({ events: [{ ...policy, selectedFactId: 'unknown' }], turn, output }), output);
});

test('local traces never animate unconnected Voyage or Vector Search', async () => {
  const first = await processPrompt(seedState(), 'The launch is Friday.', 'Marketing', () => {});
  const corrected = await processPrompt(first.state, 'Engineering owns launch readiness for this project.', 'You', () => {});
  const reused = await processPrompt(corrected.state, 'The next release is Tuesday.', 'Marketing', () => {});
  const general = await processPrompt(reused.state, 'What is a database?', 'You', () => {}, async () => ({ answer: 'A data store.', model: 'Test provider', provider: 'fixture' }));
  for (const { turn } of [first, corrected, reused, general]) {
    const snapshot = JSON.stringify(turn);
    for (const [cursor, event] of turn.trace.entries()) {
      const operation = activeOperation(event);
      if (operation.route) assert.equal(routes.find(route => route.id === operation.route)?.planned, undefined);
      assert.ok(!['voyage', 'vector'].includes(operation.node));
      replayStatus(turn, cursor);
    }
    assert.equal(JSON.stringify(turn), snapshot, 'replaying must not mutate the stored turn');
  }
  assert.ok(reused.turn.applied);
  assert.equal(replayStatus(general.turn, 0).resolved, false);
});

test('3D wire segments preserve length across depth and have finite transforms', () => {
  assert.equal(segmentStyle([0, 0, 0], [3, 4, 12]).width, 13);
  for (const route of routes) for (let i = 1; i < route.points.length; i++) {
    const style = segmentStyle(route.points[i - 1], route.points[i]);
    assert.ok(style.width > 0);
    assert.ok(!/NaN|Infinity/.test(style.transform));
  }
});

import { buildReplaySteps, directorPose, playbackAction, packetKeyframes, TELEPORT_MS } from './replay-model.js';

test('replay contains exactly the recorded events, including conflict turns', async () => {
  const { turn } = await processPrompt(seedState(), 'The launch is Friday.', 'Marketing', () => {});
  const before = JSON.stringify(turn);
  const steps = buildReplaySteps(turn);
  assert.deepEqual(steps.flatMap(step => step.events), turn.trace);
  assert.ok(steps.length < turn.trace.length, 'save request and confirmation are one visible beat');
  assert.ok(steps.every(step => step.kind === 'recorded'));
  assert.ok(steps.every(step => !['voyage', 'vector'].includes(step.node)));
  assert.equal(JSON.stringify(turn), before);
});

test('future service events are rendered only when explicitly recorded, with their actual summaries', () => {
  const event = { id: 'recorded-search', stage: 'search.completed', service: 'vector', route: 'candidates', title: 'Precedents returned', inputSummary: 'Project X · query q1', outputSummary: '2 candidates · p1, p2', operation: 'Scoped vector query' };
  const [step] = buildReplaySteps({ trace: [event] });
  assert.equal(step.node, 'vector');
  assert.equal(step.input, event.inputSummary);
  assert.equal(step.output, event.outputSummary);
  assert.equal(step.operation, event.operation);
  assert.equal(step.route, 'candidates');
});

test('replaying one step stops there; full playback returns to the terminal', () => {
  assert.equal(playbackAction(2, 8, 'step'), 'pause');
  assert.equal(playbackAction(7, 8, 'step'), 'pause');
  assert.equal(playbackAction(2, 8, 'auto'), 'next');
  assert.equal(playbackAction(7, 8, 'auto'), 'return');
});

test('each service visit is one slow round trip, continuous across confirmations', () => {
  const stages = ['receive', 'write', 'saved', 'recall', 'compare', 'policy', 'generate', 'generated', 'resolve', 'commit', 'committed', 'respond'];
  const turn = { trace: stages.map((stage, id) => ({ id, stage })) };
  const snapshot = JSON.stringify(turn);
  const steps = buildReplaySteps(turn);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i], next = steps[i + 1];
    if (step.route && step.node !== 'terminal') {
      assert.equal(step.motion.routeMs, 1000, 'restore the original route pace');
      assert.equal(step.motion.stackDelayMs, step.motion.departureDelayMs + step.motion.routeMs + TELEPORT_MS);
      assert.ok(step.motion.stackMs >= 1920, 'keep the descent and ascent readable at 1.25× speed');
    }
    if (step.motion.stackMs) {
      const endProgressMs = step.duration - step.motion.stackDelayMs;
      if (next?.motion.groupId === step.motion.groupId) {
        assert.equal(-next.motion.stackDelayMs, endProgressMs, 'next caption continues at the exact same position');
        assert.equal(next.motion.stackMs, step.motion.stackMs);
        assert.equal(next.motion.routeMs, 0, 'no repeated incoming transfer');
      } else assert.equal(endProgressMs, step.motion.stackMs, 'leave immediately after returning to the top');
    }
  }
  const generated = steps.find(step => step.event.stage === 'generate');
  assert.equal(generated.motion.packetRoute, 'terminal:model', 'one moving packet, even with two input connections');
  assert.equal(steps.find(step => step.event.stage === 'respond').motion.stackMs, 0);
  assert.equal(JSON.stringify(turn), snapshot);
});

test('unrelated prompts and corrections do not invent a conflict retrieval story', async () => {
  for (const prompt of ['What is a database?', 'Engineering owns launch readiness for this project.']) {
    const { turn } = await processPrompt(seedState(), prompt, 'You', () => {});
    assert.ok(buildReplaySteps(turn).every(step => step.kind === 'recorded'));
  }
});

test('one dot fades through the teleport and continues its bounce across captions', () => {
  const [write, saved] = buildReplaySteps({ trace: [{ id: 'w', stage: 'memory-read', service: 'atlas' }, { id: 's', stage: 'policy-read', service: 'atlas' }] });
  const down = packetKeyframes(write), up = packetKeyframes(saved);
  const arrival = down.filter(frame => frame.offset === (write.motion.stackDelayMs - TELEPORT_MS / 2) / write.duration);
  assert.equal(arrival.length, 2, 'wire endpoint and stack corner share one timestamp: no connecting flight');
  const landed = down.find(frame => frame.offset === write.motion.routeMs / write.duration);
  assert.equal(landed.transform, arrival[0].transform);
  assert.equal(landed.opacity, 1);
  assert.equal(Math.round((arrival[0].offset - landed.offset) * write.duration), 125, 'fade out immediately after landing');
  assert.ok(arrival.every(frame => frame.opacity === 0), 'teleport only while invisible');
  assert.notEqual(arrival[0].transform, arrival[1].transform);
  const bounce = down.find(frame => frame.offset === write.motion.stackDelayMs / write.duration);
  assert.equal(bounce.transform, arrival[1].transform);
  assert.equal(bounce.opacity, 1);
  assert.equal(Math.round((bounce.offset - arrival[1].offset) * write.duration), 125, 'fade in at the stack corner');
  assert.equal(down.at(-1).transform, up[0].transform, 'caption changes keep the dot at the bottom');
  assert.equal(arrival[1].transform, up.at(-1).transform, 'the dot returns to the same corner');
  for (const frames of [down, up]) {
    assert.equal(frames[0].offset, 0);
    assert.equal(frames.at(-1).offset, 1);
    assert.equal(frames[0].opacity, 1);
    assert.equal(frames.at(-1).opacity, 1);
  }
  assert.ok(up.every(frame => frame.opacity === 1), 'caption changes never fade the continuing bounce');
});

test('departures fade out and back in with a hidden teleport in the middle', () => {
  const steps = buildReplaySteps({ trace: [{ id: 'r', stage: 'receive' }, { id: 'w', stage: 'write' }] });
  const previousEnd = packetKeyframes(steps[0]).at(-1).transform;
  const frames = packetKeyframes(steps[1]);
  assert.equal(frames[0].transform, previousEnd);
  assert.equal(frames[1].transform, previousEnd);
  assert.equal(frames[0].opacity, 1);
  assert.equal(Math.round(frames[1].offset * steps[1].duration), 125);
  assert.equal(frames[1].opacity, 0);
  assert.equal(frames[2].offset, frames[1].offset);
  assert.equal(frames[2].opacity, 0);
  assert.notEqual(frames[2].transform, previousEnd);
  assert.equal(frames[3].transform, frames[2].transform);
  assert.equal(frames[3].opacity, 1);
  assert.equal(Math.round(frames[3].offset * steps[1].duration), TELEPORT_MS);
});

test('a conflict-only answer never replays an invented authority lesson', async () => {
  const first = await processPrompt(seedState(), 'The launch is Friday.', 'Marketing', () => {});
  const result = await processPrompt(first.state, 'Leave this unresolved.', 'You', () => {}, undefined, [], {
    conflictReview: { conflictTurnId: first.turn.id, factId: null, rememberAuthority: false },
  });
  const steps = buildReplaySteps(result.turn);
  assert.doesNotMatch(steps.map(step => `${step.operation} ${step.output}`).join(' '), /Scoped lesson|Engineering owns|Record a scoped lesson/);
  assert.match(steps.find(step => step.event.stage === 'resolve').output, /Unresolved/);
});

test('camera stays fixed across stages in a service and returns to the overview', () => {
  assert.deepEqual(directorPose(activeOperation({ stage: 'write' }).node), directorPose(activeOperation({ stage: 'saved' }).node));
  assert.deepEqual(directorPose(activeOperation({ stage: 'respond' }).node), directorPose('terminal'));
  for (const node of ['atlas', 'engine', 'voyage', 'vector', 'model']) {
    const pose = directorPose(node);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(pose.zoom <= 1.5);
  }
});

test('backend save intent, receipt and confirmation make one visit with no repeated transfer', () => {
  const trace = [
    { id: 'r', stage: 'receive', service: 'local' },
    { id: 'w', stage: 'write', service: 'local' },
    { id: 'db', stage: 'storage', service: 'atlas', route: 'ingest', status: 'succeeded' },
    { id: 's', stage: 'saved', service: 'atlas' },
    { id: 'x', stage: 'extract', service: 'local' },
    { id: 'c', stage: 'compare', service: 'local' },
  ];
  const steps = buildReplaySteps({ trace });
  assert.deepEqual(steps.map(step => step.node), ['terminal', 'atlas', 'terminal', 'terminal']);
  assert.deepEqual(steps.map(step => step.motion.routeMs), [0, 1000, 1000, 0]);
  assert.equal(steps[1].events.length, 3);
  assert.equal(steps[1].traceStartIndex, 1);
  assert.equal(steps[1].traceIndex, 3);
  assert.equal(steps[2].motion.groupId, steps[3].motion.groupId);
  assert.equal(packetKeyframes(steps[2]).at(-1).transform, packetKeyframes(steps[3])[0].transform);
  assert.deepEqual(steps.flatMap(step => step.events), trace);
});

test('every displayed connection links the previous station to the next, regardless of stale route hints', () => {
  const trace = [
    { id: 'local', stage: 'compare', service: 'local' },
    { id: 'read', stage: 'memory-read', service: 'atlas', route: 'fact-write' },
    { id: 'engine', stage: 'compare', service: 'engine', route: 'recall' },
    { id: 'embed', stage: 'embedding', service: 'voyage', route: 'embed' },
    { id: 'search', stage: 'search', service: 'vector', route: 'search' },
    { id: 'policy', stage: 'policy', service: 'engine', route: 'candidates' },
    { id: 'commit', stage: 'storage', service: 'atlas', route: 'decision-write' },
    { id: 'model', stage: 'generate', service: 'model', route: 'prompt-to-model' },
  ];
  const steps = buildReplaySteps({ trace });
  assert.deepEqual(steps.slice(1).map(step => step.transfer.id), ['terminal:atlas','atlas:engine','engine:voyage','voyage:vector','vector:engine','engine:atlas','atlas:model']);
  for (let i=1; i<steps.length; i++) {
    assert.equal(steps[i].transfer.from, steps[i-1].node);
    assert.equal(steps[i].transfer.to, steps[i].node);
  }
  const embed = steps.find(step => step.node === 'voyage').transfer;
  assert.equal(embed.points[0][0], 650, 'leave the engine on its left, without passing through the model');
  assert.ok(embed.points.slice(1, -1).every(point => point[0] < 650));
});

test('service receipts and candidate results remain hidden until their recorded event', async () => {
  const { serviceEvidence } = await import('./replay-model.js');
  const turn = { trace: [{ service: 'local', stage: 'receive' }, { service: 'voyage', status: 'succeeded', dimensions: 1024 }, { service: 'vector', status: 'succeeded', candidates: [{ precedent_id:'p1',score:.9 }] }] };
  assert.equal(serviceEvidence(turn, 'voyage', 0).tag, 'NOT REACHED YET');
  assert.equal(serviceEvidence(turn, 'voyage', 0).events.length, 0);
  assert.equal(serviceEvidence(turn, 'voyage', 1).events[0].dimensions, 1024);
  assert.equal(serviceEvidence(turn, 'vector', 1).events.length, 0);
  assert.equal(serviceEvidence(turn, 'vector', 2).events[0].candidates[0].precedent_id, 'p1');
});

test('unused retrieval explains legacy recordings, saved answers, and recorded failures', async () => {
  const { serviceEvidence } = await import('./replay-model.js');
  const legacy = serviceEvidence({ serviceMode: 'browser', trace: [] }, 'vector');
  assert.match(legacy.current, /older browser-only recording/);
  assert.equal(legacy.tag, 'NOT CALLED IN THIS REPLAY');
  const saved = serviceEvidence({ trace: [{ stage: 'policy', humanReview: 'answer' }] }, 'vector');
  assert.match(saved.current, /reused a saved human answer/);
  const failure = serviceEvidence({ trace: [{ stage: 'retrieval-unavailable', service: 'engine', status: 'unavailable' }] }, 'vector');
  assert.match(failure.current, /Retrieval was unavailable/);
  const ordinary = serviceEvidence({ trace: [] }, 'vector');
  assert.match(ordinary.current, /new structured conflicts, not every message/);
  for (const evidence of [legacy, saved, failure, ordinary]) assert.equal(evidence.events.length, 0);
});

test('chat bookkeeping continues one incoming transfer without a bounce or camera return', () => {
  const steps = buildReplaySteps({ trace: [
    { id: 'db', service: 'atlas', stage: 'storage' },
    { id: 'recall', service: 'local', stage: 'recall' },
    { id: 'compare', service: 'local', stage: 'compare' },
    { id: 'engine', service: 'engine', stage: 'policy' },
    { id: 'answer', service: 'local', stage: 'respond' },
  ] });
  assert.deepEqual(steps.map(step => step.cameraNode), ['atlas', 'atlas', 'atlas', 'engine', 'engine']);
  const local = steps.slice(1, 3);
  assert.equal(local.reduce((sum, step) => sum + step.duration, 0), 1000 + TELEPORT_MS);
  assert.ok(local.every(step => step.motion.stackMs === 0 && step.motion.terminalMs === 0));
  assert.equal(packetKeyframes(local[0]).at(-1).transform, packetKeyframes(local[1])[0].transform);
  const end = local[1].transfer.points.at(-1);
  assert.equal(packetKeyframes(local[1]).at(-1).transform, `translate3d(${end[0]}px, ${end[1]}px, ${end[2]}px)`);
});

test('the packet lane shares the sheet offsets, just outside its edge', async () => {
  const { stackPoint, STACK_OFFSET, serviceGeometry } = await import('./replay-model.js');
  for (const [node, [x, y, z, width, height]] of Object.entries(serviceGeometry)) {
    const top = stackPoint(node, 0), bottom = stackPoint(node, 2);
    assert.deepEqual(top, [x + width + 2, y + height + 2, z + 4]);
    assert.deepEqual(bottom.map((value, i) => value - top[i]), [2 * STACK_OFFSET.x, 2 * STACK_OFFSET.y, 2 * STACK_OFFSET.z]);
  }
});
