import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ZstdCodec } = require('zstd-codec');

// Phase 0 bench: tile convert + zstd-19 on kof98h sprites (64MB).
// Mirrors RomPack.Place("16b") + ConvertTile + WriteSprites (block 4KB).
// Pinned to the 4 KB/level-19 config that #123 replaced: the numbers here are the baseline,
// not what the converter ships now (16 KB/level 12, see RomPack.cs).
// Usage: npm i adm-zip zstd-codec && node tile-zstd.mjs [romset] (roms/*.zip needed, git-excluded)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SET = process.argv[2] || 'kof98h';
const db = JSON.parse(readFileSync(join(ROOT, 'converter/assets/neogeo_games.json'), 'utf8'));
const g = db.find(x => x.name === SET);
if (!g) { console.error(`romset ${SET} not in DB`); process.exit(2); }
const zips = ['roms/' + SET + '.zip'];
if (g.parent) zips.push('roms/' + g.parent + '.zip');
zips.push('roms/neogeo.zip');
const ZA = zips.map(z => new AdmZip(join(ROOT, z)));
const find = (name) => { for (const z of ZA) { const e = z.getEntry(name); if (e) return z.readFile(e); } throw new Error('missing ' + name); };
const sprites = g.regions.sprites;
const zstd = await new Promise((resolve) => ZstdCodec.run(resolve));
const SZ = new zstd.Simple();

const t0 = Date.now();
// Place 16b
const gfx = Buffer.alloc(sprites.size);
for (const [op, flag, name, crc, offset, size] of sprites.ops) {
  const data = find(name);
  let pos = 0;
  for (let i = 0; i < size; i++) gfx[offset + 2 * i] = data[pos + i];
}
const tPlace = Date.now();
// ConvertTile (gngeo port)
const swap = Buffer.alloc(128);
let tiles = gfx.length / 128;
const usage = new Uint32Array(Math.ceil(tiles / 16));
for (let t = 0; t < tiles; t++) {
  const b = t << 7;
  gfx.copy(swap, 0, b, b + 128);
  let usedPens = 0, o = b;
  for (let y = 0; y < 16; y++) {
    for (const half of [64, 0]) {
      let dw = 0;
      const r = half + (y << 2);
      for (let x = 0; x < 8; x++) {
        const pen = (((swap[r + 3] >> x) & 1) << 3 | ((swap[r + 1] >> x) & 1) << 2 | ((swap[r + 2] >> x) & 1) << 1 | ((swap[r] >> x) & 1));
        dw |= pen << ((7 - x) << 2);
        usedPens |= 1 << pen;
      }
      gfx[o++] = dw & 0xFF; gfx[o++] = (dw >> 8) & 0xFF; gfx[o++] = (dw >> 16) & 0xFF; gfx[o++] = (dw >> 24) & 0xFF;
    }
  }
  if ((usedPens & ~1) === 0) usage[t >> 4] |= 1 << ((t & 15) * 2);
}
const tTile = Date.now();
// zstd-19, 4KB blocks
const BS = 4096, blocks = gfx.length / BS;
let packed = 0;
const mem0 = process.memoryUsage().heapUsed;
for (let i = 0; i < blocks; i++) {
  const out = SZ.compress(new Uint8Array(gfx.subarray(i * BS, (i + 1) * BS)), 19);
  packed += out.length;
}
const tZstd = Date.now();
const mem1 = process.memoryUsage().heapUsed;
console.log(JSON.stringify({
  tiles, rawMB: +(gfx.length / 1048576).toFixed(1), packedMB: +(packed / 1048576).toFixed(1),
  placeMs: tPlace - t0, tileMs: tTile - tPlace, zstdMs: tZstd - tTile,
  heapDeltaMB: +((mem1 - mem0) / 1048576).toFixed(1),
  rssMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
}));
