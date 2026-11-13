import { LAUNCHER_PREVIEWS } from './launcher-previews.mjs';

// The launcher UI is English only, like the real one (#361): the page language never changes it.
const STATUS = ['Buildable', 'Verified on hardware', 'Unsupported'];
const PAGE_SIZE = 8;
const TURBO = ['off', 'A', 'B', 'X', 'Y'];
const SLOTS = 3;

const catalogGame = ([set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb],
  image) =>
  ({ id: set, set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb, image });

// Pass window.NEO3DS_DB from the page. `installed` maps a catalog set to its screenshot: only those
// games are installed, so only those are listed (#361). The default is the four real screenshots.
export function createLauncher(catalog, installed = LAUNCHER_PREVIEWS) {
  const games = catalog.games
    .filter(row => Object.hasOwn(installed, row[0]))
    .map(row => catalogGame(row, installed[row[0]]));
  let index = 0;
  let tab = 'all';
  let mode = 'list';
  const favorites = new Set();
  const inGame = () => ({
    turbo: 0, system: 'MVS', slot: 1, status: 'Loaded in 4.4s', confirm: null,
  });
  let state = inGame();
  const visible = () => tab === 'all' ? games : games.filter(game => favorites.has(game.id));
  const display = (game) => {
    if (!game) return null;
    return { ...game, favorite: favorites.has(game.id),
      statusLabel: STATUS[game.status] ?? '', note: game.noteEn };
  };
  const labels = () => ({
    turbo: `Turbo: ${TURBO[state.turbo]}`,
    system: state.confirm === 'system'
      ? `Tap again: ${state.system === 'MVS' ? 'AES' : 'MVS'}`
      : `System: ${state.system}`,
    service: state.system === 'MVS' ? 'Service' : 'MVS only',
    slot: `Slot ${state.slot}`,
    load: state.confirm === 'load' ? 'Tap again' : 'Load',
  });
  const view = () => {
    const list = visible();
    const page = Math.floor(index / PAGE_SIZE);
    return {
      mode,
      tab,
      total: list.length,
      counts: { all: games.length, fav: favorites.size },
      page,
      rows: list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map(display),
      selected: display(list[index]) ?? null,
      ingame: { ...labels(), status: state.status, playing: mode === 'play' },
      messages: {
        empty: 'No favorites yet.',
        preview: 'Preview: the game itself runs on a 3DS.',
      },
    };
  };
  const status = (text) => { state.status = text; state.confirm = null; };
  return {
    view,
    move(direction) {
      const length = visible().length;
      if (length) index = (index + Math.sign(direction) + length) % length;
    },
    // L and R page by one screen (eight rows), as in the launcher (launcher.c pick_row ± ROWS).
    movePage(direction) {
      const length = visible().length;
      if (length) index = Math.max(0, Math.min(index + Math.sign(direction) * PAGE_SIZE, length - 1));
    },
    first() {
      index = 0;
    },
    last() {
      const length = visible().length;
      if (length) index = length - 1;
    },
    select(id) {
      const next = visible().findIndex(game => game.id === id);
      if (next !== -1) index = next;
    },
    setTab(next) {
      if (next !== 'all' && next !== 'fav') return;
      const selected = visible()[index]?.id;
      tab = next;
      index = Math.max(0, visible().findIndex(game => game.id === selected));
    },
    toggleFavorite() {
      const game = visible()[index];
      if (!game) return;
      if (favorites.has(game.id)) favorites.delete(game.id);
      else favorites.add(game.id);
      index = Math.max(0, Math.min(index, visible().length - 1));
    },
    // A/START or a second tap on the selected row: the game start screen (#361).
    play() {
      if (!visible()[index]) return;
      mode = 'play';
      state = inGame();
    },
    exit() {
      mode = 'list';
      state.confirm = null;
    },
    // The in-game menu's touch buttons. The demo keeps the text state of the real GUI; the screens
    // that cannot run in a browser say so in the status line.
    press(action) {
      if (mode !== 'play') return;
      if (action === 'turbo') state.turbo = (state.turbo + 1) % TURBO.length;
      else if (action === 'slot') state.slot = state.slot % SLOTS + 1;
      else if (action === 'system') {
        if (state.confirm === 'system') {
          state.system = state.system === 'MVS' ? 'AES' : 'MVS';
          status('Restarted');
        } else state.confirm = 'system';
      } else if (action === 'save') status(`Saved to slot ${state.slot}`);
      else if (action === 'load') {
        if (state.confirm === 'load') status(`Loaded slot ${state.slot}`);
        else state.confirm = 'load';
      } else if (action === 'reset') status('Restarted');
      else if (action === 'snapshot') status('Snapshot saved for the game list');
      else if (action === 'keys') status('Key config works on a real 3DS');
      else if (action === 'diagnostics') status('Diagnostics work on a real 3DS');
      else if (action === 'service') status('The service menu opens on a real 3DS');
      else return;
      // Anything but the button that asked "Tap again" drops that pending question.
      if (action !== 'system' && action !== 'load') state.confirm = null;
    },
    reset() {
      favorites.clear();
      tab = 'all';
      index = 0;
      mode = 'list';
      state = inGame();
    },
  };
}
