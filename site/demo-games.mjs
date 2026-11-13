// The five games the intro page demos (#369): every entry has a hero screenshot in site/media/.
//
// `set` is the row in site/games.js that supplies status, notes, and ROM data. `id` is the demo
// identity used for selection and favorites: KOF '98 and KOF '98 (Max Res) are two screenshots of
// the same catalog set, so a shared `set` would make the two rows inseparable.
export const DEMO_GAMES = Object.freeze([
  Object.freeze({ id: 'kof98h', set: 'kof98h', title: "KOF '98", image: 'hero_kof98.jpg' }),
  Object.freeze({ id: 'kof98h-maxres', set: 'kof98h', title: "KOF '98 (Max Res)", image: 'hero_maxres.jpg' }),
  Object.freeze({ id: 'mslug3', set: 'mslug3', title: 'Metal Slug 3', image: 'hero_mslug3.jpg' }),
  Object.freeze({ id: 'sonicwi3', set: 'sonicwi3', title: 'Aero Fighters 3', image: 'hero_sonicwi3.jpg' }),
  Object.freeze({ id: 'samsh5sp', set: 'samsh5sp', title: 'Samurai Shodown V Special', image: 'hero_samsho5.jpg' }),
]);
