import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Seam B: web romfs vs desktop romfs (KEEP dir).
// Compares: uncompressed bytes identical + c.pak block-decode identical + c.idx structure.
// Usage: node romfs-diff.mjs <keepDir>  (web side built from roms/ via conv/ modules)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const keep = process.argv[2];
if (!keep) { console.error('usage: node romfs-diff.mjs <keepDir>'); process.exit(2); }

const { GameDb } = await import('./gamedb.js');
const { RomSet, BiosSet } = await import('./zipset.js');
const { writeGameFiles } = await import('./pack.js');
const { createRequire } = await import('node:module');
const { ZstdCodec } = createRequire(import.meta.url)('zstd-codec');
const zstd = await new Promise((r) => ZstdCodec.run(r));
const SZ = new zstd.Simple();
const Z = { compress: (u8, lv) => SZ.compress(u8, lv), decompress: (u8) => SZ.decompress(u8) };

const meta = Object.fromEntries(readFileSync(join(keep, 'romfs/meta.txt'), 'utf8').trim().split('\n').map((l) => l.split(/: (.+)/)));
const set = meta['set'];
const db = await GameDb.load(join(ROOT, 'converter/assets/neogeo_games.json'));
const game = db.find(set);
const rom = await RomSet.open(
  [set + '.zip', game.parent ? game.parent + '.zip' : null]
    .filter(Boolean).map((z) => join(ROOT, 'roms', z)),
);
const { files, stats } = await writeGameFiles(game, rom, await BiosSet.open(join(ROOT, 'roms/neogeo.zip')), Z, {
  log: () => {},
});
console.log(`web built: ${stats.tiles} tiles, ${stats.total} bytes total`);

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail++;
};

// 1. uncompressed bytes identical
for (const f of ['p.bin', 's.bin', 'm1.bin', 'v.bin', 'bios_aes.bin', 'bios_mvs.bin',
  'sfix.bin', 'lo.bin', 'biosmode.bin']) {
  const a = files.get(f), b = readFileSync(join(keep, 'romfs/game', f));
  check(`bytes/${f}`, a && Buffer.compare(Buffer.from(a), b) === 0, a ? `${a.length} bytes` : 'missing');
}

// 2. c.pak: decode every block on both sides, compare bytes
const wPak = files.get('c.pak'), wIdx = files.get('c.idx');
const nPak = readFileSync(join(keep, 'romfs/game/c.pak'));
const nIdx = readFileSync(join(keep, 'romfs/game/c.idx'));
const wdv = new DataView(wPak.buffer, wPak.byteOffset, wPak.length);
const wBlocks = new DataView(wIdx.buffer, wIdx.byteOffset, wIdx.length).getUint32(16, true);
let badBlock = -1;
for (let i = 0; i < wBlocks; i++) {
  const iv = new DataView(wIdx.buffer, wIdx.byteOffset, wIdx.length);
  const nv = new DataView(nIdx.buffer, nIdx.byteOffset, nIdx.length);
  const wd = Z.decompress(new Uint8Array(wPak.subarray(iv.getUint32(20 + i * 4, true), iv.getUint32(20 + (i + 1) * 4, true))));
  const nd = Z.decompress(new Uint8Array(nPak.subarray(nv.getUint32(20 + i * 4, true), nv.getUint32(20 + (i + 1) * 4, true))));
  if (Buffer.compare(Buffer.from(wd), Buffer.from(nd)) !== 0) { badBlock = i; break; }
}
check('pak/decode-identical', badBlock === -1, badBlock === -1 ? `${wBlocks} blocks` : `block ${badBlock}`);

// 3. c.idx structure identical (except offsets, which depend on compressor)
const wv = new DataView(wIdx.buffer, wIdx.byteOffset, wIdx.length);
const nv = new DataView(nIdx.buffer, nIdx.byteOffset, nIdx.length);
check('idx/header', [4, 8, 12, 16].every((o) => wv.getUint32(o, true) === nv.getUint32(o, true)));
const usageOff = 20 + (wBlocks + 1) * 4;
const wUse = Buffer.from(wIdx.subarray(usageOff)), nUse = Buffer.from(nIdx.subarray(usageOff));
check('idx/usage', Buffer.compare(wUse, nUse) === 0, `${wUse.length} bytes`);
process.exit(fail ? 1 : 0);
