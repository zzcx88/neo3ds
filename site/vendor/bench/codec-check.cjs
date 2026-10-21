// Phase 0: decode every native c.pak block, re-encode at 19, decode again, compare.
// Usage: npm i zstd-codec && KEEP=<NEO3DS_KEEP dir> node codec-check.cjs
const { ZstdCodec } = require('zstd-codec');
const fs = require('node:fs');
const keep = process.env.KEEP || process.argv[2];
if (!keep) { console.error('usage: KEEP=<keepDir> node codec-check.cjs'); process.exit(2); }
ZstdCodec.run(zstd => {
  const s = new zstd.Simple();
  const idx = fs.readFileSync(keep + '/romfs/game/c.idx');
  const pak = fs.readFileSync(keep + '/romfs/game/c.pak');
  const blocks = idx.readUInt32LE(16);
  // 1. decode all native blocks
  const t0 = Date.now();
  let ok = 0, packed = 0;
  for (let i = 0; i < blocks; i++) {
    const a = idx.readUInt32LE(20 + i * 4), b = idx.readUInt32LE(20 + (i + 1) * 4);
    const dec = s.decompress(new Uint8Array(pak.subarray(a, b)));
    if (dec.length !== 4096) { console.log('BAD len at', i); process.exit(1); }
    ok++;
  }
  const tDec = Date.now();
  // 2. re-encode all at 19, decode again, compare
  let ok2 = 0;
  for (let i = 0; i < blocks; i++) {
    const a = idx.readUInt32LE(20 + i * 4), b = idx.readUInt32LE(20 + (i + 1) * 4);
    const dec = s.decompress(new Uint8Array(pak.subarray(a, b)));
    const re = s.compress(dec, 19);
    packed += re.length;
    const dec2 = s.decompress(new Uint8Array(re));
    if (Buffer.compare(Buffer.from(dec), Buffer.from(dec2)) === 0) ok2++;
  }
  const tEnc = Date.now();
  console.log(JSON.stringify({
    blocks, decodeOk: ok, roundtripOk: ok2,
    nativeMB: +(pak.length / 1048576).toFixed(1), reencodeMB: +(packed / 1048576).toFixed(1),
    decodeMs: tDec - t0, reencodeMs: tEnc - tDec,
    rssMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
  }));
});
