import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncher } from './launcher-model.mjs';
import { LAUNCHER_PREVIEWS } from './launcher-previews.mjs';

// Same row shape as site/games.js: [set, title, year, maker, ROM MB, decrypt, status, note ko, note en, sprite MB].
const row = (set, title, status, noteKo = '', noteEn = '') =>
  [set, title, '1998', 'Maker', 12, '', status, noteKo, noteEn, 8];

// Sixteen catalog sets: two full eight-row pages, with a known first and last (#378).
const catalog = { games: [
  row('kof98h', "The King of Fighters '98 - The Slugfest", 1, '실기 확인 · 풀 스피드', 'verified · full speed'),
  row('kof98', 'The King of Fighters 98 (MVS)', 0, '변환 가능 · 보호 칩', 'buildable · protection chip'),
  row('mslug3', 'Metal Slug 3', 1, '실기 확인 · 풀 스피드', 'verified · full speed'),
  row('sonicwi3', 'Aero Fighters 3', 2, '변환 불가 · 메모리', 'unsupported · memory'),
  row('samsh5sp', 'Samurai Shodown V Special', 0, '변환 가능', 'buildable'),
  ...Array.from({ length: 10 }, (_, i) => row(`set${i}`, `Filler ${i}`, 0)),
  row('garou', 'Garou - Mark of the Wolves', 0, '', ''),
] };

const PAGE_ONE = ['kof98h', 'kof98', 'mslug3', 'sonicwi3', 'samsh5sp', 'set0', 'set1', 'set2'];
const PAGE_TWO = ['set3', 'set4', 'set5', 'set6', 'set7', 'set8', 'set9', 'garou'];
const launcher = () => createLauncher(catalog);
const ids = instance => instance.view().rows.map(game => game.id);

test('the full catalog is the list; there is no curated demo subset', () => {
  const view = launcher().view('ko');
  assert.equal(view.total, 16);
  assert.deepEqual(view.counts, { all: 16, fav: 0 });
  assert.equal(view.selected.id, 'kof98h');
  assert.equal(view.selected.year, '1998');
  assert.equal(view.selected.maker, 'Maker');
  assert.equal(view.selected.romMb, 12);
  assert.equal(view.selected.statusLabel, '실기 확인');
  assert.equal(view.selected.note, '실기 확인 · 풀 스피드');
});

test('each page holds eight rows and moving past the edge turns the page', () => {
  const instance = launcher();
  assert.deepEqual(ids(instance), PAGE_ONE);
  for (let step = 0; step < 7; step++) instance.move(1);
  assert.equal(instance.view().selected.id, 'set2');
  assert.deepEqual(ids(instance), PAGE_ONE);
  instance.move(1);
  assert.equal(instance.view().selected.id, 'set3');
  assert.deepEqual(ids(instance), PAGE_TWO);
  instance.move(1);
  assert.equal(instance.view().selected.id, 'set4');
  assert.deepEqual(ids(instance), PAGE_TWO);
  instance.last();
  assert.equal(instance.view().selected.id, 'garou');
  assert.deepEqual(ids(instance), PAGE_TWO);
});

test('moving the selection wraps around the whole catalog', () => {
  const instance = launcher();
  instance.move(-1);
  assert.equal(instance.view().selected.id, 'garou');
  assert.deepEqual(ids(instance), PAGE_TWO);
  instance.move(1);
  assert.equal(instance.view().selected.id, 'kof98h');
  assert.deepEqual(ids(instance), PAGE_ONE);
});

test('first and last jump within the current tab', () => {
  const instance = launcher();
  instance.last();
  assert.equal(instance.view().selected.id, 'garou');
  assert.equal(instance.view().counts.all, 16);
  instance.first();
  assert.equal(instance.view().selected.id, 'kof98h');
  instance.select('mslug3');
  instance.toggleFavorite();
  instance.setTab('fav');
  instance.last();
  assert.equal(instance.view().selected.id, 'mslug3');
  instance.first();
  assert.equal(instance.view().selected.id, 'mslug3');
});

test('All and Fav tabs list their rows and keep the selected game', () => {
  const instance = launcher();
  assert.equal(instance.view().tab, 'all');
  instance.select('mslug3');
  instance.toggleFavorite();
  instance.select('garou');
  instance.toggleFavorite();
  instance.select('mslug3');
  instance.setTab('fav');
  assert.equal(instance.view().tab, 'fav');
  assert.equal(instance.view().total, 2);
  assert.deepEqual(instance.view().counts, { all: 16, fav: 2 });
  assert.deepEqual(ids(instance), ['mslug3', 'garou']);
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
});

test('an empty Fav tab has no selection and cannot move', () => {
  const instance = launcher();
  instance.setTab('fav');
  assert.equal(instance.view().total, 0);
  assert.equal(instance.view().rows.length, 0);
  assert.equal(instance.view().selected, null);
  instance.move(1);
  instance.last();
  instance.toggleFavorite();
  assert.equal(instance.view().selected, null);
});

test('only the five preview sets get an image; everyone else gets a title card', () => {
  const instance = launcher();
  const image = id => {
    instance.select(id);
    return instance.view().selected.image;
  };
  assert.equal(image('kof98h'), 'hero_kof98.jpg');
  assert.equal(image('kof98'), 'hero_maxres.jpg');
  assert.equal(image('mslug3'), 'hero_mslug3.jpg');
  assert.equal(image('sonicwi3'), 'hero_sonicwi3.jpg');
  assert.equal(image('samsh5sp'), 'hero_samsho5.jpg');
  assert.equal(image('garou'), null);
});

test('status labels and notes follow the page language', () => {
  const instance = launcher();
  instance.select('sonicwi3');
  const ko = instance.view('ko').selected;
  assert.equal(ko.statusLabel, '변환 불가');
  assert.equal(ko.note, '변환 불가 · 메모리');
  const en = instance.view('en').selected;
  assert.equal(en.statusLabel, 'Unsupported');
  assert.equal(en.note, 'unsupported · memory');
  instance.select('samsh5sp');
  assert.equal(instance.view('en').selected.statusLabel, 'Buildable');
  assert.equal(instance.view('ko').selected.statusLabel, '변환 가능');
});

test('the model has no play mode: the list is always live', () => {
  const instance = launcher();
  assert.equal(instance.start, undefined);
  assert.equal(instance.back, undefined);
  const view = instance.view();
  assert.equal(view.playing, undefined);
  assert.equal(view.messages.preview, undefined);
  assert.equal(view.messages.returned, undefined);
  assert.equal(view.messages.empty, 'No favorites yet.');
  assert.match(view.messages.launch, /3DS/);
  assert.match(instance.view('ko').messages.launch, /3DS/);
});

test('an empty catalog still renders a usable launcher', () => {
  const view = createLauncher({ games: [] }).view();
  assert.equal(view.total, 0);
  assert.deepEqual(view.counts, { all: 0, fav: 0 });
  assert.deepEqual(view.rows, []);
  assert.equal(view.selected, null);
});

test('every preview set maps to a real catalog set and hero image', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('./games.js', import.meta.url), 'utf8');
  const db = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
  const sets = new Set(db.games.map(([set]) => set));
  for (const [set, image] of Object.entries(LAUNCHER_PREVIEWS)) {
    assert.ok(sets.has(set), `unknown catalog set: ${set}`);
    assert.ok(fs.existsSync(new URL(`./media/${image}`, import.meta.url)), `missing image: ${image}`);
    assert.match(image, /^hero_.+\.jpg$/);
  }
  assert.equal(Object.keys(LAUNCHER_PREVIEWS).length, 5);
});
