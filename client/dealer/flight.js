const clamp = value => Math.max(0, Math.min(1, value));

// A single quadratic curve, sampled by the shared clock. No intermediate
// keyframe easings or React callbacks can restart/pause the flight.
export function flightPose(from, to, progress, startScale, endScale, variation, reducedMotion = false) {
  const p = clamp(progress);
  if (reducedMotion) {
    return { x: to.x, y: to.y, scale: endScale, rotate: 0, tilt: 0, opacity: p < .8 ? 0 : (p - .8) / .2, glow: 0 };
  }
  const landingStart = .84;
  const direction = Math.sign(to.x - from.x) || 1;
  const overshoot = { x: to.x + direction * 2.5, y: to.y - 1.5 };
  if (p >= landingStart) {
    const settle = (p - landingStart) / (1 - landingStart);
    const damping = (1 - settle) ** 2;
    return {
      x: to.x + (overshoot.x - to.x) * damping,
      y: to.y + (overshoot.y - to.y) * damping,
      scale: endScale * (1 + .025 * Math.sin(Math.PI * settle)),
      rotate: variation * .15 * damping,
      tilt: 3 * damping,
      opacity: 1,
      glow: Math.sin(Math.PI * settle) * .35
    };
  }
  const t = 1 - (1 - p / landingStart) ** 1.12;
  const control = {
    x: from.x + (to.x - from.x) * .38 + direction * 18,
    y: from.y + (to.y - from.y) * .3 - Math.min(70, Math.abs(to.x - from.x) * .09 + 24)
  };
  const q = 1 - t;
  return {
    x: q * q * from.x + 2 * q * t * control.x + t * t * overshoot.x,
    y: q * q * from.y + 2 * q * t * control.y + t * t * overshoot.y,
    scale: startScale + (endScale - startScale) * t,
    rotate: variation * q + direction * Math.sin(Math.PI * t) * 5,
    tilt: 26 * q + 3 * t,
    opacity: 1,
    glow: .12 * Math.sin(Math.PI * t)
  };
}
