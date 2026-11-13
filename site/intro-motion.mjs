// Pure maths for the device entrance and drag rotation, kept out of the DOM so it
// can be tested with `node --test`. intro-device.js owns the rAF loop and events.

export const REST = Object.freeze({ x: -6, y: -14 });
export const ENTRANCE_FROM = Object.freeze({ x: 10, y: -65 });
export const ENTRANCE_MS = 2400;
export const DRAG_LIMITS = Object.freeze({ xMin: -40, xMax: 30, yMin: -65, yMax: 65 });
const DRAG_RATIO = .25;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Circular ease-out: sqrt(1 - (t - 1)^2). It leaves the start fast and lands with a
// near-zero slope, so the 2.4s rotation settles without the abrupt log stop.
export function easeOutCirc(progress) {
  const t = clamp(progress, 0, 1);
  return Math.sqrt(1 - (t - 1) ** 2);
}

export function entranceFrame(elapsed) {
  if (elapsed >= ENTRANCE_MS) {
    return { x: REST.x, y: REST.y, opacity: 1, scale: 1, done: true };
  }
  const eased = easeOutCirc(Math.max(0, elapsed) / ENTRANCE_MS);
  return {
    x: ENTRANCE_FROM.x + (REST.x - ENTRANCE_FROM.x) * eased,
    y: ENTRANCE_FROM.y + (REST.y - ENTRANCE_FROM.y) * eased,
    opacity: .35 + .65 * eased,
    scale: .94 + .06 * eased,
    done: false,
  };
}

export function dragTo(start, dx, dy) {
  return {
    x: clamp(start.x - dy * DRAG_RATIO, DRAG_LIMITS.xMin, DRAG_LIMITS.xMax),
    y: clamp(start.y + dx * DRAG_RATIO, DRAG_LIMITS.yMin, DRAG_LIMITS.yMax),
  };
}
