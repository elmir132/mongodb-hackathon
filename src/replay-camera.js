// Critically damped motion keeps velocity when the destination changes.
// Unlike restarting a CSS ease for each station, it never snaps or reverses
// velocity instantaneously when playback advances or the presenter scrubs.
export function advanceCamera(current, target, seconds) {
  const omega = 3.5;
  const dt = Math.max(0, Math.min(seconds, .064));
  const decay = Math.exp(-omega * dt);
  const pose = {}, velocity = {};
  for (const key of Object.keys(target)) {
    const displacement = current.pose[key] - target[key];
    const c = current.velocity[key] + omega * displacement;
    pose[key] = target[key] + (displacement + c * dt) * decay;
    velocity[key] = (current.velocity[key] - omega * c * dt) * decay;
  }
  return { pose, velocity };
}
