import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncher } from './launcher-model.mjs';
import { LAUNCHER_PREVIEWS } from './launcher-previews.mjs';

// Same row shape as site/games.js: [set, title, year, maker, ROM MB, decrypt, status, note ko, note en, sprite MB].
const row = (set, title, status = 0, noteKo = '', noteEn = '') =>
  [set, title, '1998', 'Maker', 12, '', status, noteKo, noteEn, 8];

// Four installed games (the screenshots) plus catalog entries that are not installed (#361).
const catalog = { games: [
  row('kof98h', "The King of Fighters '98 - The Slugfest", 1, '실기 확인 · 풀 스피드', 'verified · full speed'),
  row('kof98', 'The King of Fighters 98 (MVS)', 0, '변환 가능 · 보호 칩', 'buildable · protection chip'),
  row('mslug3', 'Metal Slug 3', 1, '실기 확인 · 풀 스피드', 'verified · full speed'),
  row('sonicwi3', 'Aero Fighters 3', 2, '변환 불가 · 메모리', 'unsupported · memory'),
  row('samsh5sp', 'Samurai Shodown V Special', 0, '변환 가능', 'buildable'),
  row('garou', 'Garou - Mark of the Wolves', 0, '', ''),
] };

// A larger installed set for the paging contract: the real page has four games, so a page is
// also the end of the list there. Twelve games exercise L/R properly.
const many = { games: Array.from({ length: 12 }, (_, i) => row(`set${i}`, `Game ${i}`)) };
const manyInstalled = Object.fromEntries(many.games.map(([set]) => [set, 'hero_test.jpg']));

const launcher = () => createLauncher(catalog);
const ids = instance => instance.view().rows.map(game => game.id);

test('the list holds only the games with a real screenshot', () => {
  const view = launcher().view();
  assert.equal(view.total, 4);
  assert.deepEqual(view.counts, { all: 4, fav: 0 });
  assert.deepEqual(view.rows.map(game => game.id), ['kof98h', 'mslug3', 'sonicwi3', 'samsh5sp']);
  assert.equal(view.selected.id, 'kof98h');
  assert.equal(view.selected.year, '1998');
  assert.equal(view.selected.maker, 'Maker');
  assert.equal(view.selected.romMb, 12);
  assert.equal(view.selected.image, 'hero_kof98.jpg');
  assert.equal(view.mode, 'list');
});

test('a catalog entry without an image is not installed and never appears', () => {
  const instance = launcher();
  instance.select('garou');
  assert.notEqual(instance.view().selected.id, 'garou');
  instance.setTab('fav');
  assert.deepEqual(ids(instance), []);
  instance.setTab('all');
  assert.equal(ids(instance).includes('kof98'), false);
});

test('up and down wrap the selection around the whole list', () => {
  const instance = launcher();
  instance.move(-1);
  assert.equal(instance.view().selected.id, 'samsh5sp');
  instance.move(1);
  assert.equal(instance.view().selected.id, 'kof98h');
});

test('L and R move by eight rows, like the launcher, and clamp at the ends', () => {
  const instance = createLauncher(many, manyInstalled);
  assert.deepEqual(ids(instance), ['set0', 'set1', 'set2', 'set3', 'set4', 'set5', 'set6', 'set7']);
  instance.movePage(1);
  assert.equal(instance.view().selected.id, 'set8');
  assert.deepEqual(ids(instance), ['set8', 'set9', 'set10', 'set11']);
  instance.movePage(1);
  assert.equal(instance.view().selected.id, 'set11');
  instance.movePage(-1);
  assert.equal(instance.view().selected.id, 'set3');
  instance.movePage(-1);
  assert.equal(instance.view().selected.id, 'set0');
});

test('the real four-game list clamps L and R to the first and last game', () => {
  const instance = launcher();
  instance.movePage(1);
  assert.equal(instance.view().selected.id, 'samsh5sp');
  instance.movePage(1);
  assert.equal(instance.view().selected.id, 'samsh5sp');
  instance.movePage(-1);
  assert.equal(instance.view().selected.id, 'kof98h');
});

test('All and Fav tabs list their rows and keep the selected game', () => {
  const instance = launcher();
  assert.equal(instance.view().tab, 'all');
  instance.select('mslug3');
  instance.toggleFavorite();
  instance.select('samsh5sp');
  instance.toggleFavorite();
  instance.select('mslug3');
  instance.setTab('fav');
  assert.equal(instance.view().tab, 'fav');
  assert.equal(instance.view().total, 2);
  assert.deepEqual(instance.view().counts, { all: 4, fav: 2 });
  assert.deepEqual(ids(instance), ['mslug3', 'samsh5sp']);
  assert.equal(instance.view().selected.id, 'mslug3');
  instance.setTab('all');
  assert.equal(instance.view().selected.id, 'mslug3');
});

test('favorites filter immediately, stay across tabs, and reset', () => {
  const instance = launcher();
  instance.select('sonicwi3');
  instance.toggleFavorite();
  assert.equal(instance.view().selected.favorite, true);
  assert.equal(instance.view().counts.fav, 1);
  instance.setTab('fav');
  assert.deepEqual(ids(instance), ['sonicwi3']);
  instance.toggleFavorite();
  assert.equal(instance.view().counts.fav, 0);
  assert.equal(instance.view().selected, null);
  assert.deepEqual(ids(instance), []);
  instance.setTab('all');
  instance.select('mslug3');
  instance.toggleFavorite();
  instance.reset();
  assert.equal(instance.view().tab, 'all');
  assert.equal(instance.view().selected.id, 'kof98h');
  assert.equal(instance.view().selected.favorite, false);
  assert.equal(instance.view().counts.fav, 0);
  assert.equal(instance.view().mode, 'list');
});

test('an empty Fav tab has no selection and cannot play', () => {
  const instance = launcher();
  instance.setTab('fav');
  assert.equal(instance.view().total, 0);
  assert.deepEqual(instance.view().rows, []);
  assert.equal(instance.view().selected, null);
  instance.move(1);
  instance.movePage(1);
  instance.play();
  assert.equal(instance.view().selected, null);
  assert.equal(instance.view().mode, 'list');
});

test('play enters the game screen and keeps the selection across the return', () => {
  const instance = launcher();
  instance.select('mslug3');
  instance.play();
  assert.equal(instance.view().mode, 'play');
  assert.equal(instance.view().selected.id, 'mslug3');
  assert.equal(instance.view().ingame.playing, true);
  instance.exit();
  assert.equal(instance.view().mode, 'list');
  assert.equal(instance.view().selected.id, 'mslug3');
  assert.equal(instance.view().ingame.playing, false);
});

test('the in-game text state starts like a fresh launch', () => {
  const instance = launcher();
  instance.press('turbo');
  assert.equal(instance.view().ingame.turbo, 'Turbo: off');
  instance.play();
  const ingame = instance.view().ingame;
  assert.equal(ingame.turbo, 'Turbo: off');
  assert.equal(ingame.system, 'System: MVS');
  assert.equal(ingame.service, 'Service');
  assert.equal(ingame.slot, 'Slot 1');
  assert.equal(ingame.load, 'Load');
  assert.equal(ingame.status, 'Loaded in 4.4s');
});

test('turbo cycles off, A, B, X, Y and off again', () => {
  const instance = launcher();
  instance.play();
  const labels = ['Turbo: A', 'Turbo: B', 'Turbo: X', 'Turbo: Y', 'Turbo: off'];
  for (const label of labels) {
    instance.press('turbo');
    assert.equal(instance.view().ingame.turbo, label);
  }
});

test('System asks again, then switches the BIOS and restarts', () => {
  const instance = launcher();
  instance.play();
  instance.press('system');
  assert.equal(instance.view().ingame.system, 'Tap again: AES');
  instance.press('system');
  assert.equal(instance.view().ingame.system, 'System: AES');
  assert.equal(instance.view().ingame.service, 'MVS only');
  assert.equal(instance.view().ingame.status, 'Restarted');
});

test('Slot cycles 1, 2, 3', () => {
  const instance = launcher();
  instance.play();
  assert.equal(instance.view().ingame.slot, 'Slot 1');
  instance.press('slot');
  assert.equal(instance.view().ingame.slot, 'Slot 2');
  instance.press('slot');
  assert.equal(instance.view().ingame.slot, 'Slot 3');
  instance.press('slot');
  assert.equal(instance.view().ingame.slot, 'Slot 1');
});

test('Save and Load report the slot, and Load asks again first', () => {
  const instance = launcher();
  instance.play();
  instance.press('save');
  assert.equal(instance.view().ingame.status, 'Saved to slot 1');
  instance.press('slot');
  assert.equal(instance.view().ingame.status, 'Saved to slot 1');
  instance.press('load');
  assert.equal(instance.view().ingame.load, 'Tap again');
  assert.equal(instance.view().ingame.status, 'Saved to slot 1');
  instance.press('load');
  assert.equal(instance.view().ingame.load, 'Load');
  assert.equal(instance.view().ingame.status, 'Loaded slot 2');
});

test('a pending Tap again is dropped by another button', () => {
  const instance = launcher();
  instance.play();
  instance.press('load');
  instance.press('save');
  assert.equal(instance.view().ingame.load, 'Load');
  assert.equal(instance.view().ingame.status, 'Saved to slot 1');
});

test('Reset and Snapshot use the launcher status lines', () => {
  const instance = launcher();
  instance.play();
  instance.press('reset');
  assert.equal(instance.view().ingame.status, 'Restarted');
  instance.press('snapshot');
  assert.equal(instance.view().ingame.status, 'Snapshot saved for the game list');
});

test('the screens that cannot run in a browser say so', () => {
  const instance = launcher();
  instance.play();
  for (const [action, text] of [
    ['keys', 'Key config works on a real 3DS'],
    ['diagnostics', 'Diagnostics work on a real 3DS'],
    ['service', 'The service menu opens on a real 3DS'],
  ]) {
    instance.press(action);
    assert.equal(instance.view().ingame.status, text);
  }
  assert.equal(instance.view().selected.id, 'kof98h');
});

test('the launcher and the in-game menu are English only', () => {
  const instance = launcher();
  instance.select('sonicwi3');
  const game = instance.view().selected;
  assert.equal(game.statusLabel, 'Unsupported');
  assert.equal(game.note, 'unsupported · memory');
  assert.match(instance.view().messages.preview, /3DS/);
  instance.setTab('fav');
  assert.equal(instance.view().messages.empty, 'No favorites yet.');
});

test('an empty catalog still renders a usable launcher', () => {
  const view = createLauncher({ games: [] }).view();
  assert.equal(view.total, 0);
  assert.deepEqual(view.counts, { all: 0, fav: 0 });
  assert.deepEqual(view.rows, []);
  assert.equal(view.selected, null);
});

test('every installed set maps to a real catalog set and hero image', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('./games.js', import.meta.url), 'utf8');
  const db = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
  const sets = new Set(db.games.map(([set]) => set));
  for (const [set, image] of Object.entries(LAUNCHER_PREVIEWS)) {
    assert.ok(sets.has(set), `unknown catalog set: ${set}`);
    assert.ok(fs.existsSync(new URL(`./media/${image}`, import.meta.url)), `missing image: ${image}`);
    assert.match(image, /^hero_.+\.jpg$/);
  }
  assert.equal(Object.keys(LAUNCHER_PREVIEWS).length, 4);
});
