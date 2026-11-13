import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEMO_GAMES } from './demo-games.mjs';

// The Korean home page is the hand-written source; the English page is generated from it,
// so the demo preview markup lives here first (#374).
const html = fs.readFileSync(new URL('./ko/index.html', import.meta.url), 'utf8');
const previews = new Map(
  [...html.matchAll(/<img\b[^>]*data-demo-id="([^"]+)"[^>]*src="([^"]+)"/g)]
    .map(([, id, src]) => [id, src]),
);

test('every demo entry matches its preview image on the home page', () => {
  assert.equal(DEMO_GAMES.length, 5);
  for (const game of DEMO_GAMES) {
    const src = previews.get(game.id);
    assert.ok(src, `missing preview image for ${game.id}`);
    assert.equal(src.split('/').pop(), game.image, `${game.id} preview`);
  }
});

test('the demo ids are unique and the page shows exactly five previews', () => {
  assert.equal(new Set(DEMO_GAMES.map(game => game.id)).size, DEMO_GAMES.length);
  assert.equal(previews.size, 5);
});
