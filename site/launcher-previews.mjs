// The installed games of the launcher demo (#361): a catalog set is installed only when it has a
// real 3DS screenshot in site/media. The launcher lists these four games and shows the image only
// when a game starts; every other catalog entry stays in the game explorer below.
// The page keeps a static <img data-preview-set> per entry for preload and the site gate.
export const LAUNCHER_PREVIEWS = Object.freeze({
  kof98h: 'hero_kof98.jpg',
  mslug3: 'hero_mslug3.jpg',
  sonicwi3: 'hero_sonicwi3.jpg',
  samsh5sp: 'hero_samsho5.jpg',
});
