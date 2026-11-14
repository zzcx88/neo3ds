import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the real coordinator with controlled resource completion. Browser checks cover paint.
const source = (await readFile(new URL('./intro-ready.mjs', import.meta.url), 'utf8'))
  .replaceAll("import('./intro-launcher.mjs')", "globalThis.__introImport('launcher')")
  .replaceAll("import('./intro-device.js')", "globalThis.__introImport('device')");
let sequence = 0;

function element() {
  return {
    style: { visibility: 'hidden' }, attributes: new Map([['inert', ''], ['aria-hidden', 'true']]),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
}

test('device stays hidden until launcher, fonts and device module are ready', async () => {
  const demo = element(), loading = element(), stage = element(), info = element();
  let releaseLauncher, releaseFont, releaseDevice;
  const launcher = new Promise(resolve => { releaseLauncher = resolve; });
  const font = new Promise(resolve => { releaseFont = resolve; });
  const device = new Promise(resolve => { releaseDevice = resolve; });
  globalThis.document = {
    getElementById: id => ({ deviceDemo: demo, deviceLoading: loading, deviceStage: stage, launcherInfo: info })[id],
    querySelectorAll: () => ['styles.css', 'intro-device.css', 'intro-home.css'].map(name => ({ href: `https://example.test/${name}`, sheet: { cssRules: [{}] } })),
    fonts: { load: () => font },
  };
  globalThis.window = { deviceDemoTimer: 0 };
  globalThis.__introImport = name => name === 'launcher' ? launcher : device;
  try {
    const run = import(`data:text/javascript,${encodeURIComponent(source)}#${sequence++}`);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(demo.style.visibility, 'hidden');
    releaseLauncher({ launcherReady: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(demo.style.visibility, 'hidden');
    releaseFont([]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(demo.style.visibility, 'hidden');
    releaseDevice({});
    await run;
    assert.equal(demo.style.visibility, 'visible');
    assert.equal(stage.attributes.has('inert'), false);
    assert.equal(stage.attributes.has('aria-hidden'), false);
    assert.equal(info.attributes.has('inert'), false);
    assert.equal(loading.hidden, true);
    assert.equal(demo.attributes.get('aria-busy'), 'false');
  } finally {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.__introImport;
  }
});
