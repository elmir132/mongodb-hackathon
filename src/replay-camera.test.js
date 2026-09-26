import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCamera } from './replay-camera.js';

test('camera glides into a destination without overshoot', () => {
  let state = { pose: { x: 0 }, velocity: { x: 0 } };
  for (let i = 0; i < 600; i++) {
    const next = advanceCamera(state, { x: 330 }, 1 / 60);
    assert.ok(next.pose.x >= state.pose.x && next.pose.x <= 330);
    state = next;
  }
  assert.ok(Math.abs(state.pose.x - 330) < .001);
  assert.ok(Math.abs(state.velocity.x) < .001);
});

test('a changed destination preserves motion rather than snapping or instantly reversing', () => {
  let state = { pose: { x: 0 }, velocity: { x: 0 } };
  for (let i = 0; i < 15; i++) state = advanceCamera(state, { x: 330 }, 1 / 60);
  const next = advanceCamera(state, { x: -230 }, 1 / 60);
  assert.ok(next.pose.x > state.pose.x, 'existing momentum decelerates smoothly');
  assert.ok(next.pose.x - state.pose.x < 10, 'no position jump');
  assert.ok(next.velocity.x > 0 && next.velocity.x < state.velocity.x);
  assert.deepEqual(advanceCamera(state, { x: -230 }, 0), state);
});
