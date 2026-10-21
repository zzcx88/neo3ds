// RomPack port (converter/Neo3dsConverter.Core/RomPack.cs).
// Region building + tile conversion + sprite packing. Protection.Apply is a
// no-op hook here: kof98h/nam1975 are cart "rom" (Phase 2 ports the 6 schemes).
import { GameDb, Region, regionName } from './gamedb.js';
import { BiosSet } from './zipset.js';

export const SPRITE_BLOCK_SIZE = 4096;
export const SPRITE_CODEC_ZSTD = 2;
export const ZSTD_LEVEL = 19;

export function place(buf, flag, data, st, offset, size) {
  size = Math.min(size, data.length - st.pos);
  switch (flag) {
    case '':
      buf.set(data.subarray(st.pos, st.pos + size), offset);
      break;
    case '16b':
      for (let i = 0; i < size; i++) buf[offset + 2 * i] = data[st.pos + i];
      break;
    case '32b':
      for (let i = 0; i < size; i++) buf[offset + 4 * i] = data[st.pos + i];
      break;
    case '16ws':
      for (let i = 0; i < size; i++) buf[(offset + i) ^ 1] = data[st.pos + i];
      break;
    case '32ws':
      for (let i = 0; i < size; i++) buf[offset + (i >> 1) * 4 + ((i & 1) ^ 1)] = data[st.pos + i];
      break;
    default:
      throw new Error('unknown load flag ' + flag);
  }
  st.pos += size;
}

export async function buildRegions(game, rom) {
  const built = new Map();
  for (const region of game.regions) {
    const buf = new Uint8Array(region.size);
    let data = new Uint8Array(0), flag = '';
    const st = { pos: 0 };
    for (const op of region.ops) {
      switch (op.kind) {
        case 'load':
          data = await rom.read(op.file, op.crc, game.name);
          flag = op.flag;
          st.pos = 0;
          place(buf, flag, data, st, op.a, op.b);
          break;
        case 'cont':
          place(buf, flag, data, st, op.a, op.b);
          break;
        case 'reload':
          st.pos = 0;
          place(buf, flag, data, st, op.a, op.b);
          break;
        case 'ignore':
          st.pos += op.a;
          break;
        case 'fill':
          buf.fill(op.c & 0xFF, op.a, op.a + Math.min(op.b, buf.length - op.a));
          break;
        case 'copy': {
          const src = op.src === region.name ? buf : built.get(op.src);
          buf.set(src.subarray(op.a, op.a + op.c), op.b);
          break;
        }
      }
    }
    built.set(region.name, buf);
  }
  return built;
}

// gngeo convert_roms_tile port (RomPack.cs:239). Returns true if fully transparent.
export function convertTile(g, tileno) {
  const b = tileno << 7;
  const swap = g.slice(b, b + 128);
  let usedPens = 0, o = b;
  for (let y = 0; y < 16; y++) {
    for (const half of [64, 0]) {
      let dw = 0;
      const r = half + (y << 2);
      for (let x = 0; x < 8; x++) {
        const pen = (((swap[r + 3] >> x) & 1) << 3 | ((swap[r + 1] >> x) & 1) << 2 |
          ((swap[r + 2] >> x) & 1) << 1 | ((swap[r] >> x) & 1));
        dw |= pen << ((7 - x) << 2);
        usedPens |= 1 << pen;
      }
      g[o++] = dw & 0xFF; g[o++] = (dw >> 8) & 0xFF; g[o++] = (dw >> 16) & 0xFF; g[o++] = (dw >> 24) & 0xFF;
    }
  }
  return (usedPens & ~1) === 0;
}

// Packs converted gfx into c.pak blocks + c.idx. zstd: {compress(u8, level) -> u8} (node: zstd-codec, browser: zstd.wasm).
export async function writeSprites(gfx, zstd, onProgress = null) {
  const tiles = Math.floor(gfx.length / 128);
  const usage = new Uint32Array(Math.ceil(tiles / 16));
  for (let t = 0; t < tiles; t++) {
    if (convertTile(gfx, t)) usage[t >> 4] |= 1 << ((t & 15) * 2);
    if (onProgress && (t & 0xFFFF) === 0) onProgress(t / tiles * 0.3);
  }
  const blocks = Math.floor(gfx.length / SPRITE_BLOCK_SIZE);
  const packed = [];
  let packedLen = 0;
  for (let i = 0; i < blocks; i++) {
    const out = await zstd.compress(gfx.subarray(i * SPRITE_BLOCK_SIZE, (i + 1) * SPRITE_BLOCK_SIZE), ZSTD_LEVEL);
    packed.push(out);
    packedLen += out.length;
    if (onProgress && (i & 0x3FF) === 0) onProgress(0.3 + (i / blocks) * 0.7);
  }
  const pak = new Uint8Array(packedLen);
  const idx = new DataView(new ArrayBuffer(20 + (blocks + 1) * 4 + usage.length * 4));
  idx.setUint8(0, 0x4E); idx.setUint8(1, 0x45); idx.setUint8(2, 0x4F); idx.setUint8(3, 0x43);
  idx.setUint32(4, SPRITE_CODEC_ZSTD, true);
  idx.setUint32(8, tiles, true);
  idx.setUint32(12, SPRITE_BLOCK_SIZE, true);
  idx.setUint32(16, blocks, true);
  let off = 0;
  idx.setUint32(20, 0, true);
  for (let i = 0; i < blocks; i++) {
    pak.set(packed[i], off);
    off += packed[i].length;
    idx.setUint32(20 + (i + 1) * 4, off, true);
  }
  for (let i = 0; i < usage.length; i++) idx.setUint32(20 + (blocks + 1) * 4 + i * 4, usage[i], true);
  if (onProgress) onProgress(1);
  return { pak, idx: new Uint8Array(idx.buffer), tiles, raw: gfx.length, packed: packedLen };
}
