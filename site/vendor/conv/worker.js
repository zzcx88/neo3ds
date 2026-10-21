// MVP conversion worker (#33): zip files -> CIA, fully in-browser.
// Message in: {id, files: File[], region, system}
// Messages out: {id, type:'progress', step, frac, detail} | {id, type:'done', cia, stats} | {id, type:'error', message}
// Cancellation: {id, type:'cancel'} (checked between stages; in-flight zstd blocks run to completion).
import { GameDb, Region } from './gamedb.js';
import { RomSet, BiosSet } from './zipset.js';
import { pickGame, titleId, uniqueId, productCode } from './job.js';
import { writeGameFiles } from './pack.js';
import { iconPng, bannerPng, silentWav } from './art.js';
import { loadZstd } from './zstd-adapter.js';
import { CONVERTER_VERSION } from './version.js';
import initMakerom from '../makerom.js';
import initBannertool from '../bannertool.js';
// Cancellation: the page calls worker.terminate() directly (immediate, no
// cooperative checkpoints — a zstd block runs to completion otherwise).
self.onmessage = async (e) => {
  const msg = e.data;
  const { id, files, region, system } = msg;
  const post = (m) => self.postMessage({ id, ...m });
  try {
    const t0 = performance.now();
    post({ type: 'progress', step: 'load', frac: 0, detail: 'reading zips' });

    const db = await GameDb.load('../neogeo_games.json');
    const gameFile = files.find((f) => f.name.toLowerCase() !== 'neogeo.zip');
    if (!gameFile) throw new Error('Drop a game zip together with neogeo.zip.');
    const zipName = gameFile.name.replace(/\.zip$/i, '').toLowerCase();
    const { game, problem, romset } = await pickGame(db, RomSet, files, zipName);
    if (!game) throw new Error(problem);

    const biosFile = files.find((f) => f.name.toLowerCase() === 'neogeo.zip');
    if (!biosFile) throw new Error('neogeo.zip (BIOS) not found. Drop it together with the game zip.');
    const tid = titleId(zipName), uid = uniqueId(zipName);

    const Z = await loadZstd('../zstd.js');

    post({ type: 'progress', step: 'romfs', frac: 0.05, detail: `romset ${game.name}` });
    const romfs = new Map();
    const { files: gameFiles, stats } = await writeGameFiles(game, romset, await BiosSet.open(biosFile), Z, {
      region: Region[region] ?? Region.Europe,
      startMvs: system === 'aes' ? false : system === 'mvs' ? true : null,
      log: (s) => post({ type: 'progress', step: 'romfs', frac: 0.05, detail: s.trim() }),
      onProgress: (f) => post({ type: 'progress', step: 'romfs', frac: 0.05 + f * 0.55, detail: `compressing ${(f * 100).toFixed(0)}%` }),
    });
    // title.txt / version.txt / meta.txt (CiaBuilder.cs:299-312)
    const enc = new TextEncoder();
    const ver = CONVERTER_VERSION;
    gameFiles.set('title.txt', enc.encode(db.title(game)));
    gameFiles.set('version.txt', enc.encode(ver));
    for (const [n, d] of gameFiles) romfs.set('game/' + n, d);
    romfs.set('meta.txt', enc.encode(`title: ${db.title(game)}\nrom: ${zipName}\nset: ${game.name}\ntitle id: ${tid}\nconverter: ${ver}.0-web\n`));
    // Release stage buffers ASAP (Phase 1: stepwise release)
    gameFiles.clear();
    post({ type: 'progress', step: 'art', frac: 0.62, detail: 'icon + banner' });

    const title = db.title(game);
    const [icon, banner] = await Promise.all([iconPng(title), bannerPng(title)]);
    const wav = silentWav();
    const bt = await initBannertool();
    bt.FS.mkdirTree('/work');
    bt.FS.writeFile('/work/icon.png', icon);
    bt.FS.writeFile('/work/banner.png', banner);
    bt.FS.writeFile('/work/banner.wav', wav);
    const smdh = (s, max) => s.replaceAll('"', "'").slice(0, max);
    const run = (mod, args) => {
      try { mod.callMain(args); }
      catch (e) { if (e.code !== 0 && e.status !== 0) throw new Error(`exit ${e.code ?? e.status}: ${args.join(' ')}`); }
    };
    run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
    run(bt, ['makesmdh', '-s', smdh(title, 64), '-l', smdh(title + ' (neo3ds)', 128),
      '-p', smdh(game.maker ?? 'SNK', 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
    post({ type: 'progress', step: 'cia', frac: 0.7, detail: `Title ID ${tid}` });

    const mr = await initMakerom();
    mr.FS.mkdirTree('/work/romfs');
    for (const [rel, buf] of romfs) {
      const dir = '/work/romfs/' + rel.split('/').slice(0, -1).join('/');
      if (dir !== '/work/romfs/') mr.FS.mkdirTree(dir);
      mr.FS.writeFile('/work/romfs/' + rel, buf);
    }
    romfs.clear();
    mr.FS.writeFile('/work/icon.icn', bt.FS.readFile('/work/icon.icn'));
    mr.FS.writeFile('/work/banner.bnr', bt.FS.readFile('/work/banner.bnr'));
    for (const f of ['neo3ds.rsf', 'engine.elf']) {
      const r = await fetch('../' + f);
      if (!r.ok) throw new Error(`vendor/${f}: ${r.status}`);
      mr.FS.writeFile('/work/' + f, new Uint8Array(await r.arrayBuffer()));
    }
    run(mr, ['-f', 'cia', '-o', '/work/out.cia', '-target', 't', '-exefslogo',
      '-rsf', '/work/neo3ds.rsf', '-elf', '/work/engine.elf',
      '-icon', '/work/icon.icn', '-banner', '/work/banner.bnr',
      '-DAPP_TITLE=neo3ds', `-DAPP_PRODUCT_CODE=${productCode(zipName)}`,
      `-DAPP_UNIQUE_ID=0x${uid.toString(16).toUpperCase().padStart(5, '0')}`,
      '-DAPP_ROMFS=/work/romfs']);
    const cia = mr.FS.readFile('/work/out.cia').slice();
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const memMB = performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null;
    post({
      type: 'done', cia, stats: {
        rom: zipName, title, titleId: tid, tiles: stats.tiles,
        spriteRawMB: +(stats.raw / 1048576).toFixed(1),
        spritePackedMB: +(stats.packed / 1048576).toFixed(1),
        totalMB: +(stats.total / 1048576).toFixed(1),
        ciaMB: +(cia.length / 1048576).toFixed(1),
        memMB, secs,
      },
    });
  } catch (err) {
    post({ type: 'error', message: String(err?.message ?? err) });
  }
};
