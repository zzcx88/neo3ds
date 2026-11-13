// Device rendering is independent of the future launcher screen's contents.
(() => {
  const stage = document.getElementById('deviceStage');
  const device = document.getElementById('introDevice');
  const controls = document.getElementById('deviceControls');
  if (!stage || !device || !controls || !window.matchMedia || !window.CSS ||
      !CSS.supports('transform-style', 'preserve-3d') || !CSS.supports('perspective', '1px')) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const initial = { x: -8, y: -12 };
  let x = initial.x, y = initial.y, drag = null;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function render() {
    device.style.setProperty('--device-x', `${x}deg`);
    device.style.setProperty('--device-y', `${y}deg`);
  }
  function setMode() {
    drag = null;
    stage.classList.remove('is-dragging');
    stage.classList.toggle('is-rotatable', !motion.matches);
    controls.hidden = motion.matches;
    x = initial.x; y = initial.y;
    render();
  }
  controls.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.rotate;
    if (!action) return;
    if (action === 'reset') { x = initial.x; y = initial.y; }
    if (action === 'left') y -= 10;
    if (action === 'right') y += 10;
    if (action === 'up') x -= 10;
    if (action === 'down') x += 10;
    x = clamp(x, -35, 25); y = clamp(y, -45, 45);
    render();
  });
  controls.addEventListener('keydown', (event) => {
    const actions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    controls.querySelector(`[data-rotate="${action}"]`).click();
  });
  stage.addEventListener('dragstart', (event) => {
    if (event.target instanceof HTMLImageElement) event.preventDefault();
  });
  stage.addEventListener('pointerdown', (event) => {
    if (motion.matches || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('#deviceLauncherScreen, button, a, input, select, textarea')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: x, startY: y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    x = clamp(drag.startX - (event.clientY - drag.y) * 0.25, -35, 25);
    y = clamp(drag.startY + (event.clientX - drag.x) * 0.25, -45, 45);
    render();
  });
  function endDrag(event) {
    if (drag && event.pointerId === drag.id) { drag = null; stage.classList.remove('is-dragging'); }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);
  if (motion.addEventListener) motion.addEventListener('change', setMode);
  else if (motion.addListener) motion.addListener(setMode);
  setMode();
})();
