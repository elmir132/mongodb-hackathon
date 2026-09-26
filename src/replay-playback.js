import { packetKeyframes } from './replay-model.js';

export const REPLAY_TARGET_MS = 45_000;
export const REPLAY_RETURN_MS = { flatten: 1250, zoom: 700 };

// Compress long recordings for narration, without padding shorter requests or
// changing stored events. A manually replayed step keeps its readable pace.
export function playbackTiming(steps) {
  const recordedMs = steps.reduce((total, step) => total + step.duration, 0);
  const returnMs = REPLAY_RETURN_MS.flatten + REPLAY_RETURN_MS.zoom;
  const rate = Math.max(1, recordedMs / (REPLAY_TARGET_MS - returnMs));
  return { rate, durationMs: recordedMs / rate + (steps.length ? returnMs : 0) };
}

// A single clock owns both the dot and the caption. A caption update must never
// start a second animation or rewind the current one.
export function createPlayback(steps) {
  return { steps, frames: steps.map(packetKeyframes), cursor: 0, elapsed: 0, rate: playbackTiming(steps).rate };
}
export function seekPlayback(playback, cursor) {
  playback.cursor = cursor;
  playback.elapsed = 0;
}
export function advancePlayback(playback, delta, mode) {
  const step = playback.steps[playback.cursor];
  if (!step) return 'return';
  playback.elapsed = Math.min(step.duration, playback.elapsed + Math.max(0, delta) * (mode === 'step' ? 1 : playback.rate));
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
