// Keep the rest of the page usable while the interactive device prepares.
const demo = document.getElementById('deviceDemo');
const loading = document.getElementById('deviceLoading');

try {
  const styles = ['styles.css', 'intro-device.css', 'intro-home.css'];
  for (const name of styles) {
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find(element => new URL(element.href).pathname.endsWith(`/${name}`));
    // A failed stylesheet can still expose a sheet object in some browsers. All three
    // stylesheets are same-origin, so reading their rules also detects an unusable sheet.
    if (!link?.sheet || !link.sheet.cssRules.length) throw new Error(`Missing stylesheet: ${name}`);
  }

  const [launcher] = await Promise.all([
    import('./intro-launcher.mjs'),
    document.fonts ? Promise.all([
      document.fonts.load('400 13px Galmuri11'),
      document.fonts.load('700 13px Galmuri11'),
      document.fonts.load('400 10px Galmuri9'),
    ]) : Promise.resolve(),
  ]);
  if (!launcher.launcherReady) throw new Error('Launcher initialization failed');
  if (window.deviceDemoFailed) throw new Error('Device initialization timed out');

  // Start the entrance only after the launcher and fonts are ready; the module also handles
  // reduced motion and the static 2D fallback when CSS 3D is unavailable.
  await import('./intro-device.js');
  if (window.deviceDemoFailed) throw new Error('Device initialization timed out');
  clearTimeout(window.deviceDemoTimer);
  document.getElementById('deviceStage').removeAttribute('inert');
  document.getElementById('deviceStage').removeAttribute('aria-hidden');
  document.getElementById('launcherInfo').removeAttribute('inert');
  loading.hidden = true;
  demo.style.visibility = 'visible';
  demo.setAttribute('aria-busy', 'false');
} catch (error) {
  clearTimeout(window.deviceDemoTimer);
  window.deviceDemoFailed = true;
  demo.setAttribute('aria-busy', 'false');
  loading.textContent = '3DS demo unavailable. Reload to try again.';
  console.error('3DS demo initialization failed:', error);
}
