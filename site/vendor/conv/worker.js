// MVP conversion worker (#33, extended #34, batch list #74): zip files -> CIA / .neo3ds / launcher.
// Message in: {id, files: File[], region, system, mode: 'cia'|'pack'|'launcher', batch: [{name}]?}
//   or the non-converting preflight: {id, type:'preflight', files: File[]}
// Messages out: {id, type:'progress', step, frac, detail, batch?} | {id, type:'done', cia, stats}
//   | {id, type:'batch-one', batch, bin, stats} | {id, type:'batch-error', index, name, message}
//   | {id, type:'batch-done', count, ok, failed, secs}
//   | {id, type:'preflight', bios, rows} | {id, type:'error', message}
// Cancellation: the page calls worker.terminate() directly.
import { GameDb, Region } from './gamedb.js';
import { RomSet, BiosSet } from './zipset.js';
import { pickGame, titleId, uniqueId, productCode } from './job.js';
import { writeGameFiles, buildPack } from './pack.js';
import { iconPng, bannerPng, silentWav } from './art.js';
import { loadZstd } from './zstd-adapter.js';
import { CONVERTER_VERSION } from './version.js';

// WASM tools are loaded only when something is actually built (#74): preflight
// must answer without the gitignored WASM build products.
const initMakerom = async () => (await import('../makerom.js')).default();
const initBannertool = async () => (await import('../bannertool.js')).default();

const BIOS_MISSING = 'neogeo.zip (BIOS) not found. Drop it together with the game zip.';

self.onmessage = async (e) => {
  const msg = e.data;
  const { id, files, region, system, mode = 'cia', batch = null } = msg;
  const post = (m) => self.postMessage({ id, ...m });
  try {
    const db = await GameDb.load('../neogeo_games.json');
    if (msg.type === 'preflight') {
      post({ type: 'preflight', ...(await preflight(db, files)) });
      return;
    }
    const t0 = performance.now();
    if (mode === 'launcher') return await buildLauncher(post, t0);
    if (batch) return await buildBatch(db, files, batch, { region, system, mode }, post, t0);
    const one = await buildOneCapture(db, files, null, { region, system, mode }, post);
    post({ type: 'done', cia: one.bin, stats: { ...one.stats, memMB: memMB(), secs: ((performance.now() - t0) / 1000).toFixed(1) } });
  } catch (err) {
    post({ type: 'error', message: String(err?.message ?? err) });
  }
};

// Same judgment as conversion (pickGame + neogeo.zip) but nothing is built.
// Each row keeps the exact problem string buildOneCapture would throw.
async function preflight(db, files) {
  const bios = files.some((f) => f.name.toLowerCase() === 'neogeo.zip');
  const rows = [];
  for (const f of files) {
    if (f.name.toLowerCase() === 'neogeo.zip') continue;
    const zipName = f.name.replace(/\.zip$/i, '').toLowerCase();
    const row = { name: f.name, ok: false, title: null, rom: null, problem: null };
    const known = db.find(zipName);
    try {
      const { game, problem } = await pickGame(db, RomSet, files, zipName);
      const label = game ?? known;
      if (label) {
        row.title = db.title(label);
        row.rom = label.name;
      }
      if (!game) row.problem = problem;
      else if (!bios) row.problem = BIOS_MISSING;
      else row.ok = true;
    } catch (err) {
      if (known) {
        row.title = db.title(known);
        row.rom = known.name;
      }
      row.problem = String(err?.message ?? err);
    }
    rows.push(row);
  }
  return { bios, rows };
}

function memMB() {
  return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null;
}

function smdh(s, max) { return s.replaceAll('"', "'").slice(0, max); }

function makeRun() {
  return (mod, args) => {
    try { mod.callMain(args); }
    catch (e) { if (e.code !== 0 && e.status !== 0) throw new Error(`exit ${e.code ?? e.status}: ${args.join(' ')}`); }
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
    if (!r.ok) throw new Error(`vendor/${f}: ${r.status}`);
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
  post({ type: 'progress', step: 'art', frac: 0.1, detail: 'launcher icon + banner' });
  const [icon, banner] = await Promise.all([iconPng('neo3ds'), bannerPng('neo3ds')]);
  const bt = await initBannertool();
  await prepArt(bt, icon, banner);
  const run = makeRun();
  run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
  run(bt, ['makesmdh', '-s', smdh('neo3ds', 64), '-l', smdh('neo3ds - Neo Geo games on the SD card', 128),
    '-p', smdh('neo3ds', 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
  post({ type: 'progress', step: 'cia', frac: 0.5, detail: 'Title ID 000400000BFF0000' });
  const enc = new TextEncoder();
  const cia = await runMakerom(await initMakerom(), bt,
    new Map([['launcher.txt', enc.encode(`neo3ds launcher ${CONVERTER_VERSION}\n`)]]),
    'NEO3DS-LAUNCHER', 0xBFF00);
  post({
    type: 'done', cia, stats: {
      rom: 'launcher', title: 'neo3ds', titleId: '000400000BFF0000', tiles: 0,
      spriteRawMB: 0, spritePackedMB: 0, totalMB: 0, ciaMB: +(cia.length / 1048576).toFixed(1),
      memMB: memMB(), secs: ((performance.now() - t0) / 1000).toFixed(1),
    },
  });
}

async function buildBatch(db, files, zips, opts, post, t0) {
  // Stream one result at a time: the page adds a download link per game,
  // so N games never sit in RAM + postMessage all at once. A failed game is
  // reported and the loop continues (#74).
  let ok = 0, failed = 0;
  for (let i = 0; i < zips.length; i++) {
    post({ type: 'progress', step: 'load', frac: i / zips.length, detail: `game ${i + 1}/${zips.length}: ${zips[i].name}`, batch: i });
    try {
      const one = await buildOneCapture(db, files, zips[i].name, opts, (m) => post({ ...m, batch: i }));
      post({ type: 'batch-one', batch: i, bin: one.bin, stats: one.stats });
      ok++;
    } catch (err) {
      failed++;
      post({ type: 'batch-error', index: i, name: zips[i].name, message: String(err?.message ?? err) });
    }
  }
  post({ type: 'batch-done', count: zips.length, ok, failed, secs: ((performance.now() - t0) / 1000).toFixed(1) });
}

async function buildOneCapture(db, files, forceZip, opts, post) {
  const { region, system, mode } = opts;
  post({ type: 'progress', step: 'load', frac: 0, detail: 'reading zips' });
  const gameFile = forceZip
    ? files.find((f) => f.name.toLowerCase() === forceZip.toLowerCase())
    : files.find((f) => f.name.toLowerCase() !== 'neogeo.zip');
  if (!gameFile) throw new Error('Drop a game zip together with neogeo.zip.');
  const zipName = gameFile.name.replace(/\.zip$/i, '').toLowerCase();
  const { game, problem, romset } = await pickGame(db, RomSet, files, zipName);
  if (!game) throw new Error(problem);
  const biosFile = files.find((f) => f.name.toLowerCase() === 'neogeo.zip');
  if (!biosFile) throw new Error('neogeo.zip (BIOS) not found. Drop it together with the game zip.');
  const tid = titleId(zipName), uid = uniqueId(zipName);

  const Z = await loadZstd('../zstd.js');
  post({ type: 'progress', step: 'romfs', frac: 0.05, detail: `romset ${game.name}` });
  const { files: gameFiles, stats } = await writeGameFiles(game, romset, await BiosSet.open(biosFile), Z, {
    region: Region[region] ?? Region.Europe,
    startMvs: system === 'aes' ? false : system === 'mvs' ? true : null,
    log: (s) => post({ type: 'progress', step: 'romfs', frac: 0.05, detail: s.trim() }),
    onProgress: (f) => post({ type: 'progress', step: 'romfs', frac: 0.05 + f * 0.55, detail: `compressing ${(f * 100).toFixed(0)}%` }),
  });
  const enc = new TextEncoder();
  const ver = CONVERTER_VERSION;
  const title = db.title(game);
  gameFiles.set('title.txt', enc.encode(title));
  gameFiles.set('version.txt', enc.encode(ver));

  if (mode === 'pack') {
    post({ type: 'progress', step: 'cia', frac: 0.9, detail: `${zipName}.neo3ds` });
    const bin = buildPack(gameFiles, zipName);
    gameFiles.clear();
    return { zipName, bin, stats: packStats(zipName, title, tid, stats, bin) };
  }

  const romfs = new Map();
  for (const [n, d] of gameFiles) romfs.set('game/' + n, d);
  romfs.set('meta.txt', enc.encode(`title: ${title}\nrom: ${zipName}\nset: ${game.name}\ntitle id: ${tid}\nconverter: ${ver}.0-web\n`));
  gameFiles.clear();
  post({ type: 'progress', step: 'art', frac: 0.62, detail: 'icon + banner' });

  const [icon, banner] = await Promise.all([iconPng(title), bannerPng(title)]);
  const bt = await initBannertool();
  await prepArt(bt, icon, banner);
  const run = makeRun();
  run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
  run(bt, ['makesmdh', '-s', smdh(title, 64), '-l', smdh(title + ' (neo3ds)', 128),
    '-p', smdh(game.maker ?? 'SNK', 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
  post({ type: 'progress', step: 'cia', frac: 0.7, detail: `Title ID ${tid}` });

  const cia = await runMakerom(await initMakerom(), bt, romfs, productCode(zipName), uid);
  romfs.clear();
  return { zipName, bin: cia, stats: packStats(zipName, title, tid, stats, cia) };
}

function packStats(zipName, title, tid, stats, bin) {
  return {
    rom: zipName, title, titleId: tid, tiles: stats.tiles,
    spriteRawMB: +(stats.raw / 1048576).toFixed(1),
    spritePackedMB: +(stats.packed / 1048576).toFixed(1),
    totalMB: +(stats.total / 1048576).toFixed(1),
    ciaMB: +(bin.length / 1048576).toFixed(1),
  };
}
