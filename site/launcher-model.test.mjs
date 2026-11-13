import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncher } from './launcher-model.mjs';

const catalog = { games: Array.from({ length: 10 }, (_, i) =>
  [`set${i}`, `Game ${i}`, '1999', 'Maker', 12, '', i % 3, '메모', 'Note', 8]) };

test('the launcher initially shows eight catalog games and selects the first', () => {
  const view = createLauncher(catalog).view();
  assert.equal(view.total, 10);
  assert.equal(view.rows.length, 8);
  assert.equal(view.selected.title, 'Game 0');
  assert.equal(view.rows[7].title, 'Game 7');
});

test('moving selection wraps and keeps the selected game on screen', () => {
  const launcher = createLauncher(catalog);
  launcher.move(-1);
  assert.equal(launcher.view().selected.title, 'Game 9');
  assert.ok(launcher.view().rows.some(row => row.title === 'Game 9'));
  launcher.move(1);
  assert.equal(launcher.view().selected.title, 'Game 0');
});

test('favorites filter immediately, remain in memory, and reset', () => {
  const launcher = createLauncher(catalog);
  launcher.select('set8');
  launcher.toggleFavorite();
  launcher.setTab('fav');
  assert.deepEqual(launcher.view().rows.map(row => row.title), ['Game 8']);
  launcher.toggleFavorite();
  assert.equal(launcher.view().selected, null);
  assert.deepEqual(launcher.view().rows, []);
  launcher.setTab('all');
  launcher.toggleFavorite();
  assert.equal(createLauncher(catalog).view().selected.favorite, false);
  launcher.reset();
  assert.equal(launcher.view().tab, 'all');
  assert.equal(launcher.view().selected.title, 'Game 0');
  assert.equal(launcher.view().selected.favorite, false);
});

test('catalog details and compatibility labels are available in both languages', () => {
  const launcher = createLauncher(catalog);
  assert.equal(launcher.view('en').selected.statusLabel, 'Buildable');
  launcher.select('set1');
  assert.equal(launcher.view('ko').selected.statusLabel, '실기 확인');
  assert.equal(launcher.view('en').selected.statusLabel, 'Verified on hardware');
  launcher.select('set2');
  const game = launcher.view('ko').selected;
  assert.equal(game.statusLabel, '변환 불가');
  assert.equal(game.note, '메모');
  assert.equal(game.romMb, 12);
  assert.equal(launcher.view('en').selected.note, 'Note');
});

test('demo explains installed games, launch, and QR without performing them', () => {
  const { messages } = createLauncher({ games: [] }).view('en');
  assert.match(messages.demo, /demo/i);
  assert.match(messages.demo, /installed/i);
  assert.match(messages.launch, /real/i);
  assert.match(messages.qr, /transfer/i);
  assert.equal(createLauncher({ games: [] }).view().selected, null);
});
