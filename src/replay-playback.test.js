import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplaySteps, TELEPORT_MS } from './replay-model.js';
import { createPlayback, seekPlayback, advancePlayback, packetStyle } from './replay-playback.js';
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
