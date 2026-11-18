// Real-paint regression coverage for the CSS 3D demo (#394). Desktop WebKit is
// not an iPhone: passing this check never replaces the real-device acceptance.
// Setup and usage: docs/build.md §7.1.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const require = createRequire(new URL('../out/site-browser/package.json', import.meta.url));
const { webkit, chromium } = require('playwright');
const engineName = process.env.BROWSER || 'webkit';
assert.ok(['webkit', 'chromium'].includes(engineName), 'BROWSER must be webkit or chromium');
const width = Number(process.env.WIDTH || 390);
assert.ok(Number.isInteger(width) && width >= 320 && width <= 1920, 'WIDTH must be 320..1920');
const artifacts = fileURLToPath(new URL(`../out/site-browser-artifacts/${engineName}-${width}/`, import.meta.url));
await mkdir(artifacts, { recursive: true });
const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await ({ webkit, chromium }[engineName]).launch();
  const page = await browser.newPage({
    viewport: { width, height: width > 760 ? 1000 : 844 }, deviceScaleFactor: width > 760 ? 1 : 2,
    isMobile: width <= 760, hasTouch: width <= 760, reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Local regression runs must not send analytics or wait on third-party hosts.
  await page.route('https://**/*', route => route.abort());
  const press = selector => page.locator(selector)[width > 760 ? 'click' : 'tap']();
  // Screenshot decoding stays in the browser; no PNG library or pixel
  // baselines tied to one machine's font rasterizer are needed.
  async function pixels(png, other, rect, kind) {
    return page.evaluate(async ({ png, other, rect, kind }) => {
      async function decode(base64) {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height };
      }
      const a = await decode(png);
      const b = other ? await decode(other) : null;
      const scale = a.width / innerWidth;
      let count = 0;
      const x0 = rect ? Math.max(0, Math.floor(rect.x * scale)) : 0;
      const y0 = rect ? Math.max(0, Math.floor(rect.y * scale)) : 0;
      const x1 = rect ? Math.min(a.width, Math.ceil((rect.x + rect.width) * scale)) : a.width;
      const y1 = rect ? Math.min(a.height, Math.ceil((rect.y + rect.height) * scale)) : a.height;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        const [r, g, blue] = a.data.subarray(i, i + 3);
        if (kind === 'header' ? r > 45 && r > g * 1.6 && r > blue * 1.2 :
          Math.max(Math.abs(r - b.data[i]), Math.abs(g - b.data[i + 1]), Math.abs(blue - b.data[i + 2])) > 8) count++;
      }
      return count;
    }, { png: png.toString('base64'), other: other?.toString('base64'), rect, kind });
  }
  // Two compositor frames plus a brief compositor-settle interval avoid
  // mistaking a stale WebKit screenshot for a disappearing control.
  async function paint() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(100);
    return page.screenshot();
  }
  const controls = ['.dpad', '.face-a', '.face-b', '.face-x', '.face-y', '.sh-l', '.sh-r'];
  const angles = [[0, 0], [10, -65], [30, -45], [-40, -65], [30, 65], [-40, 65], [1, -1], [-1, 1]];
  for (const locale of ['', 'ko/']) {
    await page.goto(`http://127.0.0.1:${server.address().port}/${locale}`, { waitUntil: 'load' });
    await page.locator('#deviceDemo[aria-busy="false"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#deviceStage').scrollIntoViewIfNeeded();
    for (const [x, y] of angles) {
      await page.evaluate(([x, y]) => {
        const device = document.getElementById('introDevice');
        device.style.setProperty('--device-x', `${x}deg`);
        device.style.setProperty('--device-y', `${y}deg`);
      }, [x, y]);
      const shown = await paint();
      await page.screenshot({ path: resolve(artifacts, `${locale ? 'ko' : 'en'}-${x}-${y}.png`) });
      const screen = await page.locator('#deviceLauncherScreen').boundingBox();
      assert.ok(await pixels(shown, null, screen, 'header') > 20,
        `${engineName} /${locale} (${x},${y}): launcher header is covered by the shell`);
      for (const selector of controls) {
        // Compare the whole viewport, not getBoundingClientRect's axis-aligned
        // box: WebKit's 3D hit-test bounds can differ from the painted bounds.
        const visible = await paint();
        const probe = await page.addStyleTag({ content: `.hero ${selector}{visibility:hidden!important}` });
        const hidden = await paint();
        let changed = await pixels(visible, hidden, null, 'difference');
        await probe.evaluate(el => el.remove());
        const restored = await paint();
        // Re-rasterizing a transformed glyph can shift its antialiasing after
        // visibility changes. Check paint presence in both directions, not an
        // exact visible-vs-restored snapshot match.
        let repainted = await pixels(hidden, restored, null, 'difference');
        if ((changed <= 20 || repainted <= 20) && ['.sh-l', '.sh-r'].includes(selector)) {
          // At the steepest poses the lid/hinge can physically cover a shoulder
          // button (notably desktop -40,-65). Keep this shell's own background,
          // sides and rear intact: only remove the other solids to distinguish
          // legitimate lid occlusion from the reported front-face paint bug.
          const lid = await page.addStyleTag({ content: '.hero .shell-top,.hero .hinge{visibility:hidden!important}' });
          const uncovered = await paint();
          const button = await page.addStyleTag({ content: `.hero ${selector}{visibility:hidden!important}` });
          const uncoveredHidden = await paint();
          changed = await pixels(uncovered, uncoveredHidden, null, 'difference');
          await button.evaluate(el => el.remove());
          repainted = await pixels(uncoveredHidden, await paint(), null, 'difference');
          await lid.evaluate(el => el.remove());
          await paint();
          console.log(`INFO ${engineName} /${locale} (${x},${y}): ${selector} checked without lid/hinge occlusion`);
        }
        assert.ok(repainted > 20,
          `${engineName} /${locale} (${x},${y}): ${selector} did not repaint (${repainted} changed pixels)`);
        assert.ok(changed > 20, `${engineName} /${locale} (${x},${y}): ${selector} is not painted (${changed} changed pixels)`);
      }
      console.log(`PASS ${engineName} /${locale} (${x},${y}): screen + D-pad/L/R/ABXY painted`);
    }
    for (const [x, y] of [[0, 0], [20, -35]]) {
      await page.evaluate(([x, y]) => {
        const device = document.getElementById('introDevice');
        device.style.setProperty('--device-x', `${x}deg`);
        device.style.setProperty('--device-y', `${y}deg`);
      }, [x, y]);
      await paint();
      const selected = () => page.locator('#launcherRows [aria-pressed="true"]').getAttribute('data-id');
      const first = await selected();
      await press('.dpad-down');
      assert.notEqual(await selected(), first, 'D-pad down must change selection');
      await press('.dpad-up');
      assert.equal(await selected(), first, 'D-pad up must restore selection');
      await press('.sh-r');
      assert.notEqual(await selected(), first, 'R must change page selection');
      await press('.sh-l');
      assert.equal(await selected(), first, 'L must restore page selection');
      await press('.dpad-right');
      assert.equal(await page.locator('[data-tab="fav"]').getAttribute('aria-selected'), 'true');
      await press('.dpad-left');
      assert.equal(await page.locator('[data-tab="all"]').getAttribute('aria-selected'), 'true');
      await press('.face-a');
      assert.equal(await page.locator('#ingamePanel').isVisible(), true, 'A must open the game menu');
      await paint();
      await press('.face-b');
      assert.equal(await page.locator('#launcherPanel').isVisible(), true, 'B must return to the list');
      console.log(`PASS ${engineName} /${locale} (${x},${y}): D-pad/L/R/A/B touch actions`);
    }
    await page.locator('[data-rotate="reset"]').click();
    const start = await page.locator('.launcher-wordmark-top').boundingBox();
    const sx = start.x + start.width / 2, sy = start.y + start.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (const distance of [12, 40, 80, 120, 150]) {
      await page.mouse.move(sx - distance, sy - distance * .7);
      const frame = await paint();
      const screen = await page.locator('#deviceLauncherScreen').boundingBox();
      assert.ok(await pixels(frame, null, screen, 'header') > 20, 'screen must stay painted during northwest drag');
    }
    await page.mouse.up();
    assert.notEqual(await page.locator('#introDevice').evaluate(el => el.style.getPropertyValue('--device-y')), '0.00deg');
    await page.locator('[data-rotate="reset"]').click();
    assert.equal(await page.locator('#introDevice').evaluate(el => el.style.getPropertyValue('--device-y')), '0.00deg');
    console.log(`PASS ${engineName} /${locale}: northwest drag + reset`);
  }
  // Observe the real entrance, rather than only assigning its final angles.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`http://127.0.0.1:${server.address().port}/ko/`, { waitUntil: 'load' });
  await page.locator('#deviceDemo[aria-busy="false"]').waitFor();
  await page.locator('#deviceStage').scrollIntoViewIfNeeded();
  let movingSamples = 0;
  for (let i = 0; i < 8; i++) {
    const y = await page.locator('#introDevice').evaluate(el => el.style.getPropertyValue('--device-y'));
    if (y !== '0.00deg') movingSamples++;
    const frame = await paint();
    const screen = await page.locator('#deviceLauncherScreen').boundingBox();
    assert.ok(await pixels(frame, null, screen, 'header') > 20, 'screen must stay painted during entrance');
    await page.waitForTimeout(100);
  }
  assert.ok(movingSamples > 0, 'the test must observe the entrance while moving');
  await page.waitForFunction(() => document.getElementById('introDevice').style.getPropertyValue('--device-y') === '0.00deg');
  assert.deepEqual(errors, [], 'no browser JavaScript errors');
  console.log(`PASS ${engineName}: entrance animation (${movingSamples} moving samples), no JS errors`);
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
