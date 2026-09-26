import { packetKeyframes } from './replay-model.js';

// A single clock owns both the dot and the caption. A caption update must never
// start a second animation or rewind the current one.
export function createPlayback(steps) {
  return { steps, frames: steps.map(packetKeyframes), cursor: 0, elapsed: 0 };
}
export function seekPlayback(playback, cursor) {
  playback.cursor = cursor;
  playback.elapsed = 0;
}
export function advancePlayback(playback, delta, mode) {
  const step = playback.steps[playback.cursor];
  if (!step) return 'return';
  playback.elapsed = Math.min(step.duration, playback.elapsed + Math.max(0, delta));
  if (playback.elapsed < step.duration) return 'continue';
  if (mode === 'step') return 'pause';
  if (playback.cursor === playback.steps.length - 1) return 'return';
  playback.cursor++;
  playback.elapsed = 0;
  return 'next';
}
export function packetStyle(playback) {
  const frames = playback.frames[playback.cursor];
  if (!frames?.length) return {};
  const offset = playback.elapsed / playback.steps[playback.cursor].duration;
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1].offset <= offset) i++;
  const a = frames[i], b = frames[i + 1];
  if (!b || offset <= a.offset) return { transform: a.transform, opacity: a.opacity };
  const fraction = (offset - a.offset) / (b.offset - a.offset);
  const xyz = frame => frame.transform.match(/translate3d\((.*?)\)/)[1].split(',').map(parseFloat);
  const from = xyz(a), to = xyz(b);
  return {
    transform: `translate3d(${from.map((value, axis) => `${value + (to[axis] - value) * fraction}px`).join(', ')})`,
    opacity: a.opacity + (b.opacity - a.opacity) * fraction,
  };
}
