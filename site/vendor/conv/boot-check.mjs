import { readFileSync, writeFileSync } from 'node:fs';

// Boot-check helper: build a CXI from conv/ romfs (same pipeline as the browser CIA)
// so Azahar can boot it directly. Not shipped; validation only.
const { GameDb } = await import('./gamedb.js');
const { RomSet, BiosSet } = await import('./zipset.js');
const { writeGameFiles } = await import('./pack.js');
const { loadZstd } = await import('./zstd-adapter.js');
const { CONVERTER_VERSION } = await import('./version.js');
const initMakerom = (await import('../makerom.js')).default;

const Z = await loadZstd(new URL('../zstd.js', import.meta.url).href);
const db = await GameDb.load('converter/assets/neogeo_games.json');
const game = db.find('kof98h');
const rom = await RomSet.open(['roms/kof98h.zip', 'roms/kof98.zip']);
const { files } = await writeGameFiles(game, rom, await BiosSet.open('roms/neogeo.zip'), Z, { log: () => {} });
files.set('title.txt', Buffer.from(db.title(game)));
files.set('version.txt', Buffer.from(CONVERTER_VERSION));

const KEEP = process.env.KEEP;
const mod = await initMakerom();
mod.FS.mkdirTree('/work/romfs/game');
for (const [n, d] of files) mod.FS.writeFile('/work/romfs/game/' + n, d);
mod.FS.writeFile('/work/romfs/meta.txt', `title: ${db.title(game)}\nrom: kof98h\nset: kof98h\ntitle id: 000400000C9DF700\nconverter: 1.1.0-web\n`);
mod.FS.writeFile('/work/icon.icn', readFileSync(KEEP + '/icon.icn'));
mod.FS.writeFile('/work/banner.bnr', readFileSync(KEEP + '/banner.bnr'));
mod.FS.writeFile('/work/neo3ds.rsf', readFileSync('site/vendor/neo3ds.rsf'));
mod.FS.writeFile('/work/engine.elf', readFileSync('site/vendor/engine.elf'));
try {
  mod.callMain(['-f', 'cxi', '-o', '/work/out.cxi', '-target', 't', '-exefslogo',
    '-rsf', '/work/neo3ds.rsf', '-elf', '/work/engine.elf',
    '-icon', '/work/icon.icn', '-banner', '/work/banner.bnr',
    '-DAPP_TITLE=neo3ds', '-DAPP_PRODUCT_CODE=NEO3DS-KOF98H', '-DAPP_UNIQUE_ID=0xC9DF7',
    '-DAPP_ROMFS=/work/romfs']);
} catch (e) { if (e.code !== 0 && e.status !== 0) throw e; }
writeFileSync('out/mvp-kof98h.cxi', Buffer.from(mod.FS.readFile('/work/out.cxi')));
console.log('CXI written');
