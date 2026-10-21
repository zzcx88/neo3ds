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

// 1. uncompressed bytes identical (incl. Phase-2 scheme files: presence + bytes)
for (const f of ['p.bin', 's.bin', 'm1.bin', 'v.bin', 'bios_aes.bin', 'bios_mvs.bin',
  'sfix.bin', 'lo.bin', 'biosmode.bin', 'sma.bin', 'fixbank.bin', 'pvc.bin', 'vb.bin']) {
  const a = files.get(f);
  let b = null;
  try { b = readFileSync(join(keep, 'romfs/game', f)); } catch { /* absent on desktop side */ }
  if (a == null && b == null) continue; // both absent: not applicable to this cart
  check(`bytes/${f}`, a && b && Buffer.compare(Buffer.from(a), b) === 0,
    a ? `${a.length} bytes` : 'missing on web');
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

// 4. .neo3ds pack: TOC names identical + all entries identical except c.pak
// (c.pak bytes are compressor-dependent; its blocks were decoded-compared in §2).
const { buildPack } = await import('./pack.js');
const { execFileSync } = await import('node:child_process');
try {
  execFileSync('dotnet', [join(ROOT, 'converter/Neo3dsConverter.Cli/bin/Release/net10.0/neo3ds-converter.dll'),
    join(ROOT, 'roms', meta['rom'] + '.zip'), '/tmp', '--pack'], { stdio: 'pipe' });
  const nPack = readFileSync(join('/tmp', meta['rom'] + '.neo3ds'));
  const wFiles = new Map(files);
  wFiles.set('title.txt', Buffer.from(meta['title']));
  wFiles.set('version.txt', Buffer.from(meta['converter'].split('.').slice(0, 3).join('.')));
  const wPack = Buffer.from(buildPack(wFiles, meta['rom']));
  const readToc = (p) => {
    const out = [];
    for (let i = 0; i < p.readUInt32LE(12); i++)
      out.push(p.subarray(16 + i * 32, 16 + i * 32 + 24).toString().replace(/\0+$/, ''));
    return out;
  };
  const wToc = readToc(wPack), nToc = readToc(nPack);
  check('pack/toc-names', JSON.stringify(wToc) === JSON.stringify(nToc), `${wToc.length} entries`);
  const getData = (p, name) => {
    const i = readToc(p).indexOf(name);
    return p.subarray(p.readUInt32LE(16 + i * 32 + 24), p.readUInt32LE(16 + i * 32 + 24) + p.readUInt32LE(16 + i * 32 + 28));
  };
  let badEntry = null;
  for (const name of wToc) {
    if (name === 'c.pak' || name === 'c.idx') continue; // compressor-dependent (§2 covers content)
    if (Buffer.compare(getData(wPack, name), getData(nPack, name)) !== 0) { badEntry = name; break; }
  }
  check('pack/entries', badEntry === null, badEntry ?? `${wToc.length - 2} identical`);
} catch (e) {
  check('pack/toc-names', false, String(e.message).slice(0, 100));
  check('pack/entries', false, '');
}
process.exit(fail ? 1 : 0);
