// CRC32 (IEEE 802.3) shared by the zip index reader and the ZIP writer (#387).
// The bitwise loop in job.js ran at ~65 MB/s; bundling a whole romset (~7.5 GB)
// re-reads every byte, so this table version (slicing-by-4, ~1 GB/s) keeps the
// "download all" path from dominating the conversion time.
//
// Both functions are pure and incremental: `crc32Update(prev, chunk)` may be
// called with consecutive chunks, starting from 0, and returns the same value
// as one call over the concatenated bytes.

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

// Four independent lookups per word: T1..T3 are TABLE shifted one byte further.
const SLICE = [TABLE];
for (let s = 1; s < 4; s++) {
  const prev = SLICE[s - 1];
  const next = new Uint32Array(256);
  for (let n = 0; n < 256; n++) next[n] = (prev[n] >>> 8) ^ TABLE[prev[n] & 0xFF];
  SLICE.push(next);
}

export function crc32Update(prev = 0, bytes = new Uint8Array(0)) {
  let c = (prev ^ 0xFFFFFFFF) >>> 0;
  const n = bytes.length - (bytes.length % 4);
  for (let i = 0; i < n; i += 4) {
    const x = (c ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24))) >>> 0;
    c = SLICE[3][x & 0xFF] ^ SLICE[2][(x >>> 8) & 0xFF] ^ SLICE[1][(x >>> 16) & 0xFF] ^ SLICE[0][x >>> 24];
  }
  for (let i = n; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function crc32Bytes(bytes) {
  return crc32Update(0, bytes);
}
