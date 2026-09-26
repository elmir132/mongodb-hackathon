import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplaySteps, TELEPORT_MS } from './replay-model.js';
import { createPlayback, seekPlayback, advancePlayback, packetStyle, playbackTiming, REPLAY_RETURN_MS } from './replay-playback.js';
const steps = () => buildReplaySteps({ trace: [{ id: 'write', stage: 'storage', service: 'atlas' }, { id: 'saved', stage: 'saved' }, { id: 'embed', stage: 'embedding', service: 'voyage', route: 'embed', status: 'succeeded' }, { id: 'search', stage: 'search', service: 'vector', route: 'search', status: 'succeeded' }] });

test('autoplay advances once and continues the stack instead of replaying its first half', () => {
  const playback = createPlayback(steps());
  advancePlayback(playback, playback.steps[0].duration - 1, 'auto');
  const before = packetStyle(playback);
  assert.equal(advancePlayback(playback, 1, 'auto'), 'next');
  assert.equal(playback.cursor, 1);
  assert.equal(packetStyle(playback).transform, playback.frames[0].at(-1).transform);
  assert.notEqual(packetStyle(playback).transform, playback.frames[0][0].transform);
  assert.equal(advancePlayback(playback, 20, 'auto'), 'continue');
  assert.equal(playback.elapsed, 20);
  assert.notDeepEqual(packetStyle(playback), before);
  const visited = [0, 1];
  while (true) {
    const action = advancePlayback(playback, playback.steps[playback.cursor].duration, 'auto');
    if (action === 'return') break;
    assert.equal(action, 'next'); visited.push(playback.cursor);
  }
  assert.deepEqual(visited.map(i => playback.steps[i].id), ['write', 'saved', 'embed', 'search']);
  assert.deepEqual(visited.map(i => playback.steps[i].node), ['atlas', 'atlas', 'voyage', 'vector']);
});

test('pausing keeps the exact position; seeking and replaying a step restart only that step', () => {
  const playback = createPlayback(steps());
  advancePlayback(playback, 500, 'auto');
  const paused = packetStyle(playback);
  advancePlayback(playback, 0, 'auto');
  assert.deepEqual(packetStyle(playback), paused);
  seekPlayback(playback, 2);
  assert.equal(playback.elapsed, 0);
  assert.equal(advancePlayback(playback, playback.steps[2].duration, 'step'), 'pause');
  assert.equal(playback.cursor, 2);
  assert.deepEqual(packetStyle(playback), { transform: playback.frames[2].at(-1).transform, opacity: 1 });
  seekPlayback(playback, 2);
  assert.equal(playback.elapsed, 0);
});

test('the shared clock preserves the hidden 250 ms teleport without diagonal travel', () => {
  const playback = createPlayback(steps());
  seekPlayback(playback, 2);
  const from = packetStyle(playback).transform;
  advancePlayback(playback, TELEPORT_MS / 4, 'auto');
  assert.equal(packetStyle(playback).transform, from);
  assert.equal(packetStyle(playback).opacity, .5);
  advancePlayback(playback, TELEPORT_MS / 4, 'auto');
  assert.equal(packetStyle(playback).opacity, 0);
  assert.notEqual(packetStyle(playback).transform, from);
  advancePlayback(playback, TELEPORT_MS / 2, 'auto');
  assert.equal(packetStyle(playback).opacity, 1);
});

test('long autoplay fits the narration budget and retains every event; step replay stays at its base pace', () => {
  const trace = Array.from({ length: 24 }, (_, id) => ({ id, stage: 'storage', service: id % 2 ? 'voyage' : 'atlas' }));
  const recording = { trace };
  const snapshot = JSON.stringify(recording);
  const playback = createPlayback(buildReplaySteps(recording));
  assert.ok(playback.rate > 1);
  assert.equal(playbackTiming(playback.steps).durationMs, 45_000);
  const visited = [playback.steps[0].id];
  let wallMs = 0;
  while (true) {
    const duration = playback.steps[playback.cursor].duration / playback.rate;
    wallMs += duration;
    const action = advancePlayback(playback, duration + .000001, 'auto');
    if (action === 'return') break;
    assert.equal(action, 'next');
    visited.push(playback.steps[playback.cursor].id);
  }
  assert.deepEqual(visited, trace.map(event => event.id));
  assert.ok(Math.abs(wallMs + REPLAY_RETURN_MS.flatten + REPLAY_RETURN_MS.zoom - 45_000) < .001);
  seekPlayback(playback, 2);
  advancePlayback(playback, 500, 'step');
  assert.equal(playback.elapsed, 500);
  assert.equal(JSON.stringify(recording), snapshot);
});

test('short recordings are not padded or accelerated and pause keeps the packet position', () => {
  const playback = createPlayback(steps());
  assert.equal(playback.rate, 1);
  assert.ok(playbackTiming(playback.steps).durationMs < 45_000);
  advancePlayback(playback, 600, 'auto');
  const before = packetStyle(playback);
  advancePlayback(playback, 0, 'auto');
  assert.deepEqual(packetStyle(playback), before);
  assert.equal(playbackTiming([]).durationMs, 0);
});
