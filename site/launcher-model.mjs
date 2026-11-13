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

// Pass window.NEO3DS_DB from the page. Each instance represents a fresh session.
export function createLauncher(catalog) {
  const games = catalog.games.map(([set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb]) =>
    ({ set, title, year, maker, romMb, decrypt, status, noteKo, noteEn, spriteMb }));
  let index = 0;
  let tab = 'all';
  const favorites = new Set();
  const visible = () => tab === 'all' ? games : games.filter(game => favorites.has(game.set));
  return {
    view(language = 'en') {
      const list = visible();
      const text = copy[language] ?? copy.en;
      const display = game => game && ({ ...game, favorite: favorites.has(game.set),
        statusLabel: text.status[game.status] ?? '', note: language === 'ko' ? game.noteKo : game.noteEn });
      const start = Math.max(0, index - 7);
      return { tab, total: list.length, rows: list.slice(start, start + 8).map(display),
        selected: display(list[index]) ?? null, messages: { demo: text.demo, launch: text.launch, qr: text.qr, empty: text.empty } };
    },
    move(direction) {
      const length = visible().length;
      if (length) index = (index + Math.sign(direction) + length) % length;
    },
    select(set) {
      const next = visible().findIndex(game => game.set === set);
      if (next !== -1) index = next;
    },
    setTab(next) {
      if (next !== 'all' && next !== 'fav') return;
      const selected = visible()[index]?.set;
      tab = next;
      index = Math.max(0, visible().findIndex(game => game.set === selected));
    },
    toggleFavorite() {
      const game = visible()[index];
      if (!game) return;
      if (favorites.has(game.set)) favorites.delete(game.set);
      else favorites.add(game.set);
      index = Math.max(0, Math.min(index, visible().length - 1));
    },
    reset() { favorites.clear(); tab = 'all'; index = 0; },
  };
}
