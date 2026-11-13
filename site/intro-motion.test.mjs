import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REST, ENTRANCE_FROM, ENTRANCE_MS, DRAG_LIMITS,
  clamp, easeOutCirc, entranceFrame, dragTo,
} from './intro-motion.mjs';

test('rest matches the spec angle of -6deg x -14deg', () => {
  assert.deepEqual(REST, { x: -6, y: -14 });
});

test('the 2.4s entrance starts wide at frame 0 and ends at rest at 2400ms', () => {
  assert.equal(ENTRANCE_MS, 2400);
  const first = entranceFrame(0);
  assert.deepEqual(
    { x: first.x, y: first.y, opacity: first.opacity, scale: first.scale, done: first.done },
    { x: ENTRANCE_FROM.x, y: ENTRANCE_FROM.y, opacity: .35, scale: .94, done: false },
  );
  const late = entranceFrame(2399);
  assert.equal(late.done, false);
  const settled = entranceFrame(2400);
  assert.deepEqual(
    { x: settled.x, y: settled.y, opacity: settled.opacity, scale: settled.scale, done: settled.done },
    { x: REST.x, y: REST.y, opacity: 1, scale: 1, done: true },
  );
});

test('the entrance decelerates instead of moving at a constant rate', () => {
  assert.equal(easeOutCirc(0), 0);
  assert.equal(easeOutCirc(1), 1);
  const quarter = easeOutCirc(.25);
  const half = easeOutCirc(.5);
  const threeQuarters = easeOutCirc(.75);
  assert.ok(quarter > .25, 'the first quarter already covers a quarter of the travel');
  assert.ok(threeQuarters > .75);
  assert.ok(quarter < half && half < threeQuarters, 'the curve is monotonic');
  assert.ok(half - quarter > threeQuarters - half, 'each later quarter adds less travel');
});

test('400ms lands past the midpoint of the rotation on the way to 2400ms', () => {
  const frame = entranceFrame(400);
  assert.ok(!frame.done);
  // sqrt(1 - (1/6 - 1)^2) ≈ .553 of the travel: y ≈ -36.8deg, x ≈ 1.2deg.
  assert.ok(frame.y > -39 && frame.y < -35, `y=${frame.y}`);
  assert.ok(frame.x > 0 && frame.x < 3, `x=${frame.x}`);
  assert.ok(frame.opacity > .69 && frame.opacity < .73);
  const halfway = entranceFrame(1200);
  assert.ok(halfway.y > frame.y && halfway.y < REST.y);
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
