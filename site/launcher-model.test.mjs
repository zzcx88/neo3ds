import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLauncher } from './launcher-model.mjs';
import { DEMO_GAMES } from './demo-games.mjs';

// Same row shape as site/games.js: [set, title, year, maker, ROM MB, decrypt, status, note ko, note en, sprite MB].
const row = (set, title, status, noteKo = '', noteEn = '') =>
  [set, title, '1998', 'Maker', 12, '', status, noteKo, noteEn, 8];

const catalog = { games: [
  row('kof98h', "The King of Fighters '98 - The Slugfest", 1, '실기 확인 · 풀 스피드', 'verified · full speed'),
  row('mslug3', 'Metal Slug 3', 1, '실기 확인 · 풀 스피드', 'verified · full speed'),
  row('sonicwi3', 'Aero Fighters 3', 2, '변환 불가 · 메모리', 'unsupported · memory'),
  row('samsh5sp', 'Samurai Shodown V Special', 0, '변환 가능', 'buildable'),
  row('garou', 'Garou - Mark of the Wolves', 0, '', ''),
] };

const demo = () => createLauncher(catalog, DEMO_GAMES);
const ids = launcher => launcher.view().rows.map(game => game.id);

test('the demo list joins five curated entries with catalog status and ROM data', () => {
  const view = demo().view('ko');
  assert.equal(view.total, 5);
  assert.deepEqual(view.rows.map(game => game.title),
    ["KOF '98", "KOF '98 (Max Res)", 'Metal Slug 3', 'Aero Fighters 3', 'Samurai Shodown V Special']);
  assert.deepEqual(view.rows.map(game => game.image),
    ['hero_kof98.jpg', 'hero_maxres.jpg', 'hero_mslug3.jpg', 'hero_sonicwi3.jpg', 'hero_samsho5.jpg']);
  assert.equal(view.selected.id, 'kof98h');
  assert.equal(view.selected.year, '1998');
  assert.equal(view.selected.maker, 'Maker');
  assert.equal(view.selected.romMb, 12);
  assert.equal(view.selected.statusLabel, '실기 확인');
  assert.equal(view.selected.note, '실기 확인 · 풀 스피드');
  // The five-entry demo never leaks the rest of the catalog.
  assert.ok(!ids(demo()).includes('garou'));
});

test('KOF Max Res shares the catalog set but has its own demo id and selection', () => {
  const launcher = demo();
  const maxres = launcher.view().rows[1];
  assert.equal(maxres.set, 'kof98h');
  assert.equal(maxres.id, 'kof98h-maxres');
  assert.equal(maxres.note, 'verified · full speed');
  launcher.select('kof98h-maxres');
  assert.equal(launcher.view().selected.title, "KOF '98 (Max Res)");
  launcher.toggleFavorite();
  launcher.select('kof98h');
  assert.equal(launcher.view().selected.favorite, false);
  launcher.setTab('fav');
  assert.deepEqual(ids(launcher), ['kof98h-maxres']);
  assert.equal(launcher.view().selected.title, "KOF '98 (Max Res)");
});

test('All and Fav tabs list the curated rows', () => {
  const launcher = demo();
  assert.equal(launcher.view().tab, 'all');
  assert.equal(launcher.view().total, 5);
  launcher.setTab('fav');
  assert.equal(launcher.view().tab, 'fav');
  assert.equal(launcher.view().total, 0);
  assert.equal(launcher.view().selected, null);
  launcher.setTab('all');
  launcher.select('mslug3');
  launcher.toggleFavorite();
  launcher.setTab('fav');
  assert.deepEqual(ids(launcher), ['mslug3']);
});

test('moving the selection wraps and keeps the selected game on screen', () => {
  const launcher = demo();
  launcher.move(-1);
  assert.equal(launcher.view().selected.title, 'Samurai Shodown V Special');
  assert.ok(launcher.view().rows.some(game => game.title === 'Samurai Shodown V Special'));
  launcher.move(1);
  assert.equal(launcher.view().selected.title, "KOF '98");
});

test('first and last jump within the current tab and do nothing while playing', () => {
  const launcher = demo();
  launcher.last();
  assert.equal(launcher.view().selected.id, 'samsh5sp');
  launcher.first();
  assert.equal(launcher.view().selected.id, 'kof98h');
  launcher.select('mslug3');
  launcher.toggleFavorite();
  launcher.setTab('fav');
  launcher.last();
  assert.equal(launcher.view().selected.id, 'mslug3');
  launcher.start();
  launcher.first();
  launcher.last();
  assert.equal(launcher.view().selected.id, 'mslug3');
});

test('favorites filter immediately, stay across tabs, and reset', () => {
  const launcher = demo();
  launcher.select('sonicwi3');
  launcher.toggleFavorite();
  assert.equal(launcher.view().selected.favorite, true);
  launcher.setTab('fav');
  assert.deepEqual(ids(launcher), ['sonicwi3']);
  launcher.setTab('all');
  assert.equal(launcher.view().total, 5);
  launcher.toggleFavorite();
  assert.equal(launcher.view().selected.favorite, false);
  launcher.select('mslug3');
  launcher.toggleFavorite();
  launcher.reset();
  assert.equal(launcher.view().tab, 'all');
  assert.equal(launcher.view().selected.id, 'kof98h');
  assert.equal(launcher.view().selected.favorite, false);
  assert.equal(launcher.view().playing, null);
});

test('start opens the selected game and back restores the launcher selection', () => {
  const launcher = demo();
  launcher.select('sonicwi3');
  launcher.toggleFavorite();
  const started = launcher.start();
  assert.equal(started.playing.id, 'sonicwi3');
  assert.equal(started.playing.title, 'Aero Fighters 3');
  assert.equal(started.playing.image, 'hero_sonicwi3.jpg');
  assert.equal(started.selected.id, 'sonicwi3');
  const returned = launcher.back();
  assert.equal(returned.playing, null);
  assert.equal(returned.tab, 'all');
  assert.equal(returned.selected.id, 'sonicwi3');
  assert.equal(returned.selected.favorite, true);
});

test('while playing, move, tab, favorite, select, and start change nothing', () => {
  const launcher = demo();
  launcher.select('mslug3');
  launcher.start();
  const before = launcher.view();
  launcher.move(1);
  launcher.move(-1);
  launcher.setTab('fav');
  launcher.toggleFavorite();
  launcher.select('kof98h');
  launcher.start();
  const during = launcher.view();
  assert.deepEqual(during.playing, before.playing);
  assert.equal(during.tab, 'all');
  assert.equal(during.selected.id, 'mslug3');
  assert.equal(during.selected.favorite, false);
  assert.deepEqual(during.rows.map(game => game.id), before.rows.map(game => game.id));
});

test('an empty Fav tab cannot start a game', () => {
  const launcher = demo();
  launcher.setTab('fav');
  assert.equal(launcher.view().selected, null);
  assert.equal(launcher.start().playing, null);
  launcher.back();
  assert.equal(launcher.view().tab, 'fav');
});

test('status labels and notes follow the page language', () => {
  const launcher = demo();
  launcher.select('sonicwi3');
  const ko = launcher.view('ko').selected;
  assert.equal(ko.statusLabel, '변환 불가');
  assert.equal(ko.note, '변환 불가 · 메모리');
  const en = launcher.view('en').selected;
  assert.equal(en.statusLabel, 'Unsupported');
  assert.equal(en.note, 'unsupported · memory');
  launcher.select('samsh5sp');
  assert.equal(launcher.view('en').selected.statusLabel, 'Buildable');
  assert.equal(launcher.view('ko').selected.statusLabel, '변환 가능');
});

test('the demo copy describes the five previews and the preview/back announcements', () => {
  const { messages } = demo().view('en');
  assert.match(messages.demo, /five/i);
  assert.match(messages.demo, /installed/i);
  assert.doesNotMatch(messages.demo, /full catalog/i);
  assert.equal(messages.qr, undefined);
  assert.equal(messages.preview, 'Preview');
  assert.equal(messages.returned, 'Back to the launcher.');
  const ko = demo().view('ko').messages;
  assert.match(ko.demo, /다섯/);
  assert.equal(ko.preview, '미리보기');
  assert.equal(createLauncher({ games: [] }).view().selected, null);
});

test('every curated entry maps to a real catalog set and hero image', () => {
  const source = fs.readFileSync(new URL('./games.js', import.meta.url), 'utf8');
  const db = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
  const sets = new Set(db.games.map(([set]) => set));
  for (const entry of DEMO_GAMES) {
    assert.ok(sets.has(entry.set), `unknown catalog set: ${entry.set}`);
    assert.ok(fs.existsSync(new URL(`./media/${entry.image}`, import.meta.url)), `missing image: ${entry.image}`);
  }
  assert.equal(new Set(DEMO_GAMES.map(entry => entry.id)).size, DEMO_GAMES.length);
});

test('the full catalog remains the fallback when no demo list is passed', () => {
  const full = { games: Array.from({ length: 10 }, (_, i) => row(`set${i}`, `Game ${i}`, i % 3)) };
  const view = createLauncher(full).view();
  assert.equal(view.total, 10);
  assert.equal(view.rows.length, 8);
  assert.equal(view.selected.title, 'Game 0');
  assert.equal(view.selected.id, 'set0');
  assert.equal(view.selected.image, null);
  assert.equal(createLauncher(full).view().playing, null);
});
