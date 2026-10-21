import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Seam B (draft): romfs byte harness.
// Phase 0: validates a DESKTOP romfs (NEO3DS_KEEP dir) — structure + decodability.
// Phase 1: same checks run against WEB output, then byte-compare uncompressed files.
// Checks (per #31 comment: relaxed criteria):
//   1. uncompressed files present + non-empty (p/s/m1/v/bios/sfix/lo/title/version)
//   2. every c.pak block decodes to exactly 4096 bytes (zstd-codec)
//   3. c.idx structure: magic/version/tiles/blocks, monotonic offsets, usage table size
// Usage: node romfs-check.mjs <keepDir>
const keep = process.argv[2];
if (!keep) { console.error('usage: node romfs-check.mjs <keepDir>'); process.exit(2); }
const game = join(keep, 'romfs/game');

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail++;
};

// 1. uncompressed files
const plain = ['p.bin', 's.bin', 'm1.bin', 'v.bin', 'bios_aes.bin', 'bios_mvs.bin',
  'sfix.bin', 'lo.bin', 'biosmode.bin', 'title.txt', 'version.txt'];
for (const f of plain) {
  const p = join(game, f);
  check(`plain/${f}`, existsSync(p) && readFileSync(p).length > 0);
}
check('plain/meta.txt', existsSync(join(keep, 'romfs/meta.txt')));

// 3. c.idx structure (before c.pak so offsets are trusted)
const idx = readFileSync(join(game, 'c.idx'));
const u32 = (o) => idx.readUInt32LE(o);
check('idx/magic', idx.subarray(0, 4).toString() === 'NEOC');
check('idx/version', u32(4) === 2, `codec=${u32(4)}`);
const tiles = u32(8), bs = u32(12), blocks = u32(16);
check('idx/geometry', bs === 4096 && tiles * 128 === blocks * bs, `tiles=${tiles} blocks=${blocks}`);
let mono = true;
for (let i = 0; i < blocks; i++) if (u32(20 + i * 4) > u32(20 + (i + 1) * 4)) { mono = false; break; }
check('idx/offsets-monotonic', mono, `${blocks + 1} entries`);
const usageWords = Math.ceil(tiles / 16);
check('idx/size', idx.length === 20 + (blocks + 1) * 4 + usageWords * 4, `${idx.length} bytes`);

// 2. c.pak blocks decode to 4096 (zstd-codec, same lib the web build will use)
const { ZstdCodec } = await import('zstd-codec').catch(() => ({}));
if (!ZstdCodec) {
  check('pak/decode-all', false, 'zstd-codec not installed (npm i zstd-codec)');
} else {
  await new Promise((resolve) => ZstdCodec.run((zstd) => {
    const s = new zstd.Simple();
    const pak = readFileSync(join(game, 'c.pak'));
    check('pak/total-size', u32(20 + blocks * 4) === pak.length, `${pak.length} bytes`);
    const t0 = Date.now();
    let bad = -1;
    for (let i = 0; i < blocks; i++) {
      const dec = s.decompress(new Uint8Array(pak.subarray(u32(20 + i * 4), u32(20 + (i + 1) * 4))));
      if (dec.length !== 4096) { bad = i; break; }
    }
    check('pak/decode-all', bad === -1, bad === -1 ? `${blocks} blocks in ${Date.now() - t0}ms` : `block ${bad}`);
    resolve();
  }));
}
process.exit(fail ? 1 : 0);
