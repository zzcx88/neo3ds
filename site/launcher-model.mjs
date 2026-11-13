const copy = {
  en: {
    status: ['Buildable', 'Verified on hardware', 'Unsupported'],
    demo: 'Demo: this is the full catalog. The real launcher shows only games installed on your 3DS.',
    launch: 'On a real 3DS, A or START launches the selected installed game.',
    qr: 'On a real 3DS, Y or QR opens the transfer flow; this demo does not transfer files.',
    empty: 'No favorites yet.',
  },
  ko: {
    status: ['변환 가능', '실기 확인', '변환 불가'],
    demo: '체험용 전체 목록입니다. 실제 런처에는 3DS에 설치한 게임만 표시됩니다.',
    launch: '실제 3DS에서는 A 또는 START로 선택한 설치 게임을 실행합니다.',
    qr: '실제 3DS에서는 Y 또는 QR로 전송 기능을 엽니다. 이 체험에서는 전송하지 않습니다.',
    empty: '즐겨찾기가 없습니다.',
  },
};

const catalogGame = ([set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb]) =>
  ({ id: set, set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb, image: null });

// Pass window.NEO3DS_DB from the page. Each instance represents a fresh session.
// Pass the curated demo list as the second argument (site/demo-games.mjs) to show only those
// entries; omit it to browse the full catalog, as tests and other callers do.
export function createLauncher(catalog, demoGames = null) {
  const full = catalog.games.map(catalogGame);
  const games = demoGames
    ? demoGames.map(entry => {
      const row = full.find(game => game.set === entry.set);
      // An entry whose set left the catalog is dropped rather than rendered without status data.
      return row && { ...row, ...entry, id: entry.id };
    }).filter(Boolean)
    : full;
  let index = 0;
  let tab = 'all';
  let playingId = null;
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
    const size = Math.min(8, list.length);
    const start = Math.max(0, Math.min(index - (size - 1), list.length - size));
    const playing = games.find(game => game.id === playingId) ?? null;
    return { tab, total: list.length, rows: list.slice(start, start + size).map(game => display(game, language)),
      selected: display(list[index], language) ?? null, playing: display(playing, language),
      messages: { demo: text.demo, launch: text.launch, qr: text.qr, empty: text.empty } };
  };
  return {
    view,
    move(direction) {
      if (playingId) return;
      const length = visible().length;
      if (length) index = (index + Math.sign(direction) + length) % length;
    },
    select(id) {
      if (playingId) return;
      const next = visible().findIndex(game => game.id === id);
      if (next !== -1) index = next;
    },
    setTab(next) {
      if (playingId || (next !== 'all' && next !== 'fav')) return;
      const selected = visible()[index]?.id;
      tab = next;
      index = Math.max(0, visible().findIndex(game => game.id === selected));
    },
    toggleFavorite() {
      if (playingId) return;
      const game = visible()[index];
      if (!game) return;
      if (favorites.has(game.id)) favorites.delete(game.id);
      else favorites.add(game.id);
      index = Math.max(0, Math.min(index, visible().length - 1));
    },
    start(language = 'en') {
      if (!playingId) playingId = visible()[index]?.id ?? null;
      return view(language);
    },
    back(language = 'en') {
      playingId = null;
      return view(language);
    },
    reset() { favorites.clear(); tab = 'all'; index = 0; playingId = null; },
  };
}
