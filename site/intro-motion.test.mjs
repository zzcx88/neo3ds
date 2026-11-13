import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REST, ENTRANCE_FROM, ENTRANCE_MS, DRAG_LIMITS,
  clamp, logEaseOut, entranceFrame, dragTo,
} from './intro-motion.mjs';

test('the logarithmic entrance starts at the wide angle and ends at rest', () => {
  const first = entranceFrame(0);
  assert.deepEqual(
    { x: first.x, y: first.y, opacity: first.opacity, scale: first.scale, done: first.done },
    { x: ENTRANCE_FROM.x, y: ENTRANCE_FROM.y, opacity: .35, scale: .94, done: false },
  );
  const settled = entranceFrame(ENTRANCE_MS);
  assert.deepEqual(
    { x: settled.x, y: settled.y, opacity: settled.opacity, scale: settled.scale, done: settled.done },
    { x: REST.x, y: REST.y, opacity: 1, scale: 1, done: true },
  );
});

test('the entrance decelerates instead of moving at a constant rate', () => {
  assert.equal(logEaseOut(0), 0);
  assert.equal(logEaseOut(1), 1);
  const quarter = logEaseOut(.25);
  const half = logEaseOut(.5);
  const threeQuarters = logEaseOut(.75);
  assert.ok(quarter > .25, 'the first quarter already covers a quarter of the travel');
  assert.ok(threeQuarters > .75);
  assert.ok(quarter < half && half < threeQuarters, 'the curve is monotonic');
  assert.ok(half - quarter > threeQuarters - half, 'each later quarter adds less travel');
});

test('400ms lands past the midpoint of the rotation', () => {
  const frame = entranceFrame(400);
  assert.ok(!frame.done);
  assert.ok(frame.y > -38 && frame.y < -16, `y=${frame.y}`);
  assert.ok(frame.x < 10 && frame.x > -8, `x=${frame.x}`);
  assert.ok(frame.opacity > .35 && frame.opacity < 1);
});

test('drag rotation is clamped to the widened range', () => {
  assert.equal(clamp(-100, DRAG_LIMITS.xMin, DRAG_LIMITS.xMax), DRAG_LIMITS.xMin);
  assert.equal(clamp(100, DRAG_LIMITS.xMin, DRAG_LIMITS.xMax), DRAG_LIMITS.xMax);
  const pulled = dragTo(REST, 4000, -4000);
  assert.deepEqual(pulled, { x: DRAG_LIMITS.xMax, y: DRAG_LIMITS.yMax });
  const pushed = dragTo(REST, -4000, 4000);
  assert.deepEqual(pushed, { x: DRAG_LIMITS.xMin, y: DRAG_LIMITS.yMin });
});

test('dragging right turns the device right and dragging up tilts it down', () => {
  const dragged = dragTo(REST, 40, -20);
  assert.equal(dragged.y, REST.y + 10);
  assert.equal(dragged.x, REST.x + 5);
});
