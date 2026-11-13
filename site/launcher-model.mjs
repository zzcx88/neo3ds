import { LAUNCHER_PREVIEWS } from './launcher-previews.mjs';

const copy = {
  en: {
    status: ['Buildable', 'Verified on hardware', 'Unsupported'],
    launch: 'Actual play happens on a 3DS. This page previews the launcher list.',
    empty: 'No favorites yet.',
  },
  ko: {
    status: ['변환 가능', '실기 확인', '변환 불가'],
    launch: '실제 실행은 3DS에서 이뤄집니다. 이 화면은 런처 목록만 보여줍니다.',
    empty: '즐겨찾기가 없습니다.',
  },
};

const PAGE_SIZE = 8;

const catalogGame = ([set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb]) =>
  ({ id: set, set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb,
    image: LAUNCHER_PREVIEWS[set] ?? null });

// Pass window.NEO3DS_DB from the page. The list is always the full catalog; #378 removed the
// curated five-game demo and the play/preview mode, so selecting a game only changes the top screen.
export function createLauncher(catalog) {
  const games = catalog.games.map(catalogGame);
  let index = 0;
  let tab = 'all';
  const favorites = new Set();
  const visible = () => tab === 'all' ? games : games.filter(game => favorites.has(game.id));
  const display = (game, language) => {
    if (!game) return null;
    const text = copy[language] ?? copy.en;
    return { ...game, favorite: favorites.has(game.id),
      statusLabel: text.status[game.status] ?? '', note: language === 'ko' ? game.noteKo : game.noteEn };
  };
  const view = (language = 'en') => {
    const text = copy[language] ?? copy.en;
    const list = visible();
    const page = Math.floor(index / PAGE_SIZE);
    return { tab, total: list.length, counts: { all: games.length, fav: favorites.size },
      page, rows: list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
        .map(game => display(game, language)),
      selected: display(list[index], language) ?? null,
      messages: { empty: text.empty, launch: text.launch } };
  };
  return {
    view,
    move(direction) {
      const length = visible().length;
      if (length) index = (index + Math.sign(direction) + length) % length;
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
    reset() { favorites.clear(); tab = 'all'; index = 0; },
  };
}
