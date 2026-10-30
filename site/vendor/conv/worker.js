// MVP conversion worker (#33, extended #34, batch list #74, art override #75):
// zip files -> CIA / .neo3ds / launcher.
// Message in: {id, files: File[], region, system, mode: 'cia'|'pack'|'launcher',
//   lang?: 'ko'|'en', art?: {icon: File|null, banner: File|null}, batch: [{name, art?}]?}
//   or the non-converting preflight: {id, type:'preflight', files: File[], lang?}
//   `lang` picks the romset/BIOS/image failure reasons and preflight row text (#79).
// Messages out: {id, type:'progress', step, frac, detail, batch?} | {id, type:'done', cia, stats}
//   | {id, type:'batch-one', batch, bin, stats} | {id, type:'batch-error', index, name, message}
//   | {id, type:'batch-done', count, ok, failed, secs}
//   | {id, type:'preflight-progress', done, total, name} | {id, type:'preflight', rows, bios}
//   | {id, type:'error', message}
// Cancellation: the page calls worker.terminate() directly.
import { GameDb, Region } from './gamedb.js';
import { RomSet, BiosSet } from './zipset.js';
import { pickGame, titleId, uniqueId, productCode } from './job.js';
import { writeGameFiles, buildPack } from './pack.js';
import { iconPng, bannerPng, silentWav } from './art.js';
import { preflight, biosMissing } from './preflight.js';
import { readBiosProfile } from './biosinfo.js';
import { L } from './lang.js';
import { loadZstd } from './zstd-adapter.js';

// Build products are gitignored: load them only when something is actually
// built (#74), so preflight answers in a checkout without a WASM build.
const initMakerom = async () => (await import('../makerom.js')).default();
const initBannertool = async () => (await import('../bannertool.js')).default();
const converterVersion = async () => (await import('./version.js')).CONVERTER_VERSION;

self.onmessage = async (e) => {
  const msg = e.data;
  const { id, files, region, system, mode = 'cia', batch = null, art = null, lang = 'en' } = msg;
  const post = (m) => self.postMessage({ id, ...m });
  try {
    const db = await GameDb.load('../neogeo_games.json');
    if (msg.type === 'preflight') {
      // #81: the recognition bar follows the same zip-by-zip loop as the judgment.
      // #202: the BIOS profile is index-only and independent of the game rows.
      const [rows, bios] = await Promise.all([
        preflight(db, RomSet, files, {
          lang,
          onProgress: (done, total, name) => post({ type: 'preflight-progress', done, total, name }),
        }),
        readBiosProfile(files),
      ]);
      post({ type: 'preflight', rows, bios });
      return;
    }
    const t0 = performance.now();
    if (mode === 'launcher') return await buildLauncher(post, t0);
    if (batch) return await buildBatch(db, files, batch, { region, system, mode, lang }, post, t0);
    const one = await buildOneCapture(db, files, null, { region, system, mode, art, lang }, post);
    post({ type: 'done', cia: one.bin, stats: { ...one.stats, memMB: memMB(), secs: ((performance.now() - t0) / 1000).toFixed(1) } });
  } catch (err) {
    post({ type: 'error', message: String(err?.message ?? err), code: reasonCode(err) });
  }
};

// #175: analytics gets a stable reason code; the message stays localized text.
function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function reasonCode(err) {
  if (typeof err?.code === 'string') return err.code;
  const message = String(err?.message ?? err);
  // Browsers word this differently per engine; both mean the run ran out of memory.
  if (/out of memory|allocation failed|cannot enlarge memory/i.test(message)) return 'oom';
  return 'unknown';
}

function memMB() {
  return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null;
}

function smdh(s, max) { return s.replaceAll('"', "'").slice(0, max); }

function makeRun() {
  return (mod, args) => {
    try { mod.callMain(args); }
    catch (e) { if (e.code !== 0 && e.status !== 0) throw fail('wasm', `exit ${e.code ?? e.status}: ${args.join(' ')}`); }
  };
}

async function prepArt(bt, icon, banner) {
  bt.FS.mkdirTree('/work');
  bt.FS.writeFile('/work/icon.png', icon);
  bt.FS.writeFile('/work/banner.png', banner);
  bt.FS.writeFile('/work/banner.wav', silentWav());
}

async function fetchTools(mr) {
  for (const f of ['neo3ds.rsf', 'engine.elf']) {
    const r = await fetch('../' + f);
    if (!r.ok) throw fail('wasm', `vendor/${f}: ${r.status}`);
    mr.FS.writeFile('/work/' + f, new Uint8Array(await r.arrayBuffer()));
  }
}

async function runMakerom(mr, bt, romfs, product, uid) {
  mr.FS.mkdirTree('/work/romfs');
  for (const [rel, buf] of romfs) {
    const dir = '/work/romfs/' + rel.split('/').slice(0, -1).join('/');
    if (dir !== '/work/romfs/') mr.FS.mkdirTree(dir);
    mr.FS.writeFile('/work/romfs/' + rel, buf);
  }
  mr.FS.writeFile('/work/icon.icn', bt.FS.readFile('/work/icon.icn'));
  mr.FS.writeFile('/work/banner.bnr', bt.FS.readFile('/work/banner.bnr'));
  await fetchTools(mr);
  const run = makeRun();
  run(mr, ['-f', 'cia', '-o', '/work/out.cia', '-target', 't', '-exefslogo',
    '-rsf', '/work/neo3ds.rsf', '-elf', '/work/engine.elf',
    '-icon', '/work/icon.icn', '-banner', '/work/banner.bnr',
    '-DAPP_TITLE=neo3ds', `-DAPP_PRODUCT_CODE=${product}`,
    `-DAPP_UNIQUE_ID=0x${uid.toString(16).toUpperCase().padStart(5, '0')}`,
    '-DAPP_ROMFS=/work/romfs']);
  return mr.FS.readFile('/work/out.cia').slice();
}

async function buildLauncher(post, t0) {
  // CiaBuilder.cs:262 — no game in romfs, shows .neo3ds list from SD.
  post({ type: 'progress', step: 'art', frac: 0.75, detail: 'launcher icon + banner' });
  const [icon, banner] = await Promise.all([iconPng('neo3ds'), bannerPng('neo3ds')]);
  const bt = await initBannertool();
  await prepArt(bt, icon, banner);
  const run = makeRun();
  run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
  run(bt, ['makesmdh', '-s', smdh('neo3ds', 64), '-l', smdh('neo3ds - Neo Geo games on the SD card', 128),
    '-p', smdh('neo3ds', 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
  post({ type: 'progress', step: 'cia', frac: 0.9, detail: 'Title ID 000400000BFF0000' });
  const enc = new TextEncoder();
  const ver = await converterVersion();
  const cia = await runMakerom(await initMakerom(), bt,
    new Map([['launcher.txt', enc.encode(`neo3ds launcher ${ver}\n`)]]),
    'NEO3DS-LAUNCHER', 0xBFF00);
  post({
    type: 'done', cia, stats: {
      rom: 'launcher', title: 'neo3ds', titleId: '000400000BFF0000', set: null, tiles: 0,
      spriteRawMB: 0, spritePackedMB: 0, totalMB: 0, ciaMB: +(cia.length / 1048576).toFixed(1),
      memMB: memMB(), secs: ((performance.now() - t0) / 1000).toFixed(1),
    },
  });
}

async function buildBatch(db, files, zips, opts, post, t0) {
  // Stream one result at a time: the page adds a download link per game,
  // so N games never sit in RAM + postMessage all at once. A failed game is
  // reported and the loop continues (#74). #76 can put art on each entry.
  let ok = 0, failed = 0;
  for (let i = 0; i < zips.length; i++) {
    // #81: frac is per game (the page adds the completed-game count); it must
    // not be i/zips.length or the overall bar would count this game twice.
    post({ type: 'progress', step: 'load', frac: 0.05, detail: `game ${i + 1}/${zips.length}: ${zips[i].name}`, batch: i });
    try {
      const one = await buildOneCapture(db, files, zips[i].name, { ...opts, art: zips[i].art ?? null }, (m) => post({ ...m, batch: i }));
      post({ type: 'batch-one', batch: i, bin: one.bin, stats: one.stats });
      ok++;
    } catch (err) {
      failed++;
      post({ type: 'batch-error', index: i, name: zips[i].name, message: String(err?.message ?? err), code: reasonCode(err) });
    }
  }
  post({ type: 'batch-done', count: zips.length, ok, failed, secs: ((performance.now() - t0) / 1000).toFixed(1) });
}

// User pictures arrive as File objects; decode in the worker so the same bytes
// feed bannertool. No override keeps the exact automatic path below.
async function decodeArt(file, lang) {
  if (!file) return null;
  if (typeof createImageBitmap !== 'function')
    throw fail('image', L(lang, '이미지를 읽을 수 없습니다: 이 브라우저에는 createImageBitmap이 없습니다.',
      'Cannot decode image: browser has no createImageBitmap.'));
  try {
    return await createImageBitmap(file);
  } catch {
    throw fail('image', L(lang, `이미지를 읽을 수 없습니다: ${file.name}`, `Cannot decode image: ${file.name}`));
  }
}

async function buildOneCapture(db, files, forceZip, opts, post) {
  const { region, system, mode, art = null, lang = 'en' } = opts;
  // #81: fracs are normalized to this game's 0..1 timeline (see progress.js).
  post({ type: 'progress', step: 'load', frac: 0.05, detail: 'reading zips' });
  const gameFile = forceZip
    ? files.find((f) => f.name.toLowerCase() === forceZip.toLowerCase())
    : files.find((f) => f.name.toLowerCase() !== 'neogeo.zip');
  if (!gameFile) throw fail('nofile', L(lang, '게임 zip과 neogeo.zip을 함께 올려 주세요.', 'Drop a game zip together with neogeo.zip.'));
  const zipName = gameFile.name.replace(/\.zip$/i, '').toLowerCase();
  // A zip whose index cannot be read fails at the same point as pickGame's
  // own verdicts, so both carry a code (#175).
  let picked;
  try { picked = await pickGame(db, RomSet, files, zipName, { lang }); }
  catch (err) { throw fail('zip', String(err?.message ?? err)); }
  const { game, problem, romset, code } = picked;
  if (!game) throw fail(code ?? 'unknown', problem);
  const biosFile = files.find((f) => f.name.toLowerCase() === 'neogeo.zip');
  if (!biosFile) throw fail('bios', biosMissing(lang));
  const tid = titleId(zipName), uid = uniqueId(zipName);

  const Z = await loadZstd('../zstd.js');
  post({ type: 'progress', step: 'romfs', frac: 0.1, detail: `romset ${game.name}` });
  const { files: gameFiles, stats } = await writeGameFiles(game, romset, await BiosSet.open(biosFile), Z, {
    region: Region[region] ?? Region.Europe,
    startMvs: system === 'aes' ? false : system === 'mvs' ? true : null,
    log: (s) => post({ type: 'progress', step: 'romfs', frac: 0.1, detail: s.trim() }),
    onProgress: (f) => post({ type: 'progress', step: 'romfs', frac: 0.1 + f * 0.55, detail: `compressing ${(f * 100).toFixed(0)}%` }),
  });
  const enc = new TextEncoder();
  const ver = await converterVersion();
  const title = db.title(game);
  gameFiles.set('title.txt', enc.encode(title));
  gameFiles.set('version.txt', enc.encode(ver));

  if (mode === 'pack') {
    post({ type: 'progress', step: 'cia', frac: 0.9, detail: `${zipName}.neo3ds` });
    const bin = buildPack(gameFiles, zipName);
    gameFiles.clear();
    return { zipName, bin, stats: packStats(zipName, title, tid, game.name, stats, bin) };
  }

  const romfs = new Map();
  for (const [n, d] of gameFiles) romfs.set('game/' + n, d);
  romfs.set('meta.txt', enc.encode(`title: ${title}\nrom: ${zipName}\nset: ${game.name}\ntitle id: ${tid}\nconverter: ${ver}.0-web\n`));
  gameFiles.clear();
  post({ type: 'progress', step: 'art', frac: 0.7, detail: 'icon + banner' });

  const iconImage = await decodeArt(art?.icon, lang);
  const bannerImage = await decodeArt(art?.banner, lang);
  let icon, banner;
  try {
    [icon, banner] = await Promise.all([iconPng(title, iconImage), bannerPng(title, bannerImage)]);
  } finally {
    iconImage?.close?.();
    bannerImage?.close?.();
  }
  const bt = await initBannertool();
  await prepArt(bt, icon, banner);
  const run = makeRun();
  run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
  run(bt, ['makesmdh', '-s', smdh(title, 64), '-l', smdh(title + ' (neo3ds)', 128),
    '-p', smdh(game.maker ?? 'SNK', 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
  post({ type: 'progress', step: 'cia', frac: 0.85, detail: `Title ID ${tid}` });

  const cia = await runMakerom(await initMakerom(), bt, romfs, productCode(zipName), uid);
  romfs.clear();
  return { zipName, bin: cia, stats: packStats(zipName, title, tid, game.name, stats, cia) };
}

// #125: `rom` is the user's zip base name (download only); `set` is the public
// catalog's romset name, the only game identifier the page may send.
function packStats(zipName, title, tid, set, stats, bin) {
  return {
    rom: zipName, title, titleId: tid, set, tiles: stats.tiles,
    spriteRawMB: +(stats.raw / 1048576).toFixed(1),
    spritePackedMB: +(stats.packed / 1048576).toFixed(1),
    totalMB: +(stats.total / 1048576).toFixed(1),
    ciaMB: +(bin.length / 1048576).toFixed(1),
  };
}
