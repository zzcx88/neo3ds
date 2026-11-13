import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LAUNCHER_PREVIEWS } from './launcher-previews.mjs';

// The Korean home page is the hand-written source; the English page is generated from it,
// so the preview markup lives here first (#378).
const html = fs.readFileSync(new URL('./ko/index.html', import.meta.url), 'utf8');
const previews = new Map(
  [...html.matchAll(/<img\b[^>]*data-preview-set="([^"]+)"[^>]*src="([^"]+)"/g)]
    .map(([, set, src]) => [set, src]),
);

test('every preview set matches its image on the home page', () => {
  assert.equal(Object.keys(LAUNCHER_PREVIEWS).length, 5);
  assert.deepEqual([...previews.keys()].sort(), Object.keys(LAUNCHER_PREVIEWS).sort());
  for (const [set, image] of Object.entries(LAUNCHER_PREVIEWS)) {
    const src = previews.get(set);
    assert.ok(src, `missing preview image for ${set}`);
    assert.equal(src.split('/').pop(), image, `${set} preview`);
  }
});

test('the page shows exactly five previews and no maxres duplicate entry', () => {
  assert.equal(previews.size, 5);
  assert.equal(previews.has('kof98h-maxres'), false);
});
