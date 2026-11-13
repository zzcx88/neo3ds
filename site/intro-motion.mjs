// Pure maths for the device entrance and drag rotation, kept out of the DOM so it
// can be tested with `node --test`. intro-device.js owns the rAF loop and events.

export const REST = Object.freeze({ x: -8, y: -16 });
export const ENTRANCE_FROM = Object.freeze({ x: 10, y: -65 });
export const ENTRANCE_MS = 1400;
export const DRAG_LIMITS = Object.freeze({ xMin: -40, xMax: 30, yMin: -65, yMax: 65 });
const DRAG_RATIO = .25;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Log ease-out: 28% of the travel in the first 10% of the time, then a long settle.
export function logEaseOut(progress) {
  const t = clamp(progress, 0, 1);
  return Math.log1p(9 * t) / Math.log(10);
}

export function entranceFrame(elapsed) {
  if (elapsed >= ENTRANCE_MS) {
    return { x: REST.x, y: REST.y, opacity: 1, scale: 1, done: true };
  }
  const eased = logEaseOut(Math.max(0, elapsed) / ENTRANCE_MS);
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
