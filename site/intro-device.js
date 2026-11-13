// Device rendering is independent of the launcher screen's contents.
// Pure angles/curve live in intro-motion.mjs so they stay testable.
import {
  REST, ENTRANCE_MS, entranceFrame, dragTo,
} from './intro-motion.mjs';

const stage = document.getElementById('deviceStage');
const device = document.getElementById('introDevice');
const controls = document.getElementById('deviceControls');
if (!stage || !device || !controls || !window.matchMedia || !window.CSS ||
    !CSS.supports('transform-style', 'preserve-3d') || !CSS.supports('perspective', '1px')) {
  // No CSS 3D: leave the static device and hide the rotation chrome.
  if (controls) controls.hidden = true;
} else {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let x = REST.x, y = REST.y, drag = null, frame = 0;

  function render(scale = 1, opacity = 1) {
    device.style.setProperty('--device-x', `${x.toFixed(2)}deg`);
    device.style.setProperty('--device-y', `${y.toFixed(2)}deg`);
    device.style.setProperty('--device-scale', scale.toFixed(4));
    stage.style.opacity = opacity === 1 ? '' : opacity.toFixed(3);
  }

  function stopEntrance() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function settle() {
    stopEntrance();
    x = REST.x; y = REST.y;
    render();
  }

  function startEntrance() {
    stopEntrance();
    if (motion.matches) { settle(); return; }
    const started = performance.now();
    const first = entranceFrame(0);
    x = first.x; y = first.y;
    render(first.scale, first.opacity);
    const step = (now) => {
      const state = entranceFrame(now - started);
      if (state.done) { settle(); return; }
      x = state.x; y = state.y;
      render(state.scale, state.opacity);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  controls.addEventListener('click', (event) => {
    if (!event.target.closest('[data-rotate="reset"]')) return;
    settle();
  });

  stage.addEventListener('dragstart', (event) => {
    if (event.target instanceof HTMLImageElement) event.preventDefault();
  });
  stage.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) ||
        event.target.closest('#deviceLauncherScreen, button, a, input, select, textarea')) return;
    stopEntrance();
    render();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: x, startY: y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    ({ x, y } = dragTo(
      { x: drag.startX, y: drag.startY },
      event.clientX - drag.x,
      event.clientY - drag.y,
    ));
    render();
  });
  function endDrag(event) {
    if (drag && event.pointerId === drag.id) { drag = null; stage.classList.remove('is-dragging'); }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);

  function setMode() {
    drag = null;
    stage.classList.remove('is-dragging');
    stage.classList.add('is-rotatable');
    controls.hidden = false;
    if (motion.matches) settle();
  }
  if (motion.addEventListener) motion.addEventListener('change', setMode);
  else if (motion.addListener) motion.addListener(setMode);

  setMode();
  startEntrance();
}
