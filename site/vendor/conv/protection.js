// Protection port (converter/Neo3dsConverter.Core/Protection.cs).
// MAME cart decryption, region buffers mutated in place. maincpu words are
// little-endian (dump byte order) at this stage — same contract as C#.
import * as T from './cmc-tables.js';

export function bitSwap(value, bits) {
  let r = 0;
  for (const b of bits) r = (r << 1) | ((value >> b) & 1);
  return r >>> 0;
}

export function word(p, i) { return p[2 * i] | (p[2 * i + 1] << 8); }
export function setWord(p, i, w) { p[2 * i] = w & 0xFF; p[2 * i + 1] = (w >> 8) & 0xFF; }

// --- CMC42/50 ---

function cmcDecrypt(buf, i0, i1, c0, c1, table0hi, table0lo, table1, a07, b, invert) {
  const tmp = table1[(b & 0xFF) ^ a07[(b >> 8) & 0xFF]];
  const xor0 = (table0hi[(b >> 8) & 0xFF] & 0xFE) | (tmp & 0x01);
  const xor1 = (tmp & 0xFE) | (table0lo[(b >> 8) & 0xFF] & 0x01);
  if (invert !== 0) { buf[i0] = c1 ^ xor0; buf[i1] = c0 ^ xor1; }
  else { buf[i0] = c0 ^ xor0; buf[i1] = c1 ^ xor1; }
}

export function gfxDecrypt(rom, extraXor, cmc50) {
  const t03 = cmc50 ? T.Kof2000Type0T03 : T.Kof99Type0T03;
  const t12 = cmc50 ? T.Kof2000Type0T12 : T.Kof99Type0T12;
  const u03 = cmc50 ? T.Kof2000Type1T03 : T.Kof99Type1T03;
  const u12 = cmc50 ? T.Kof2000Type1T12 : T.Kof99Type1T12;
  const a815x1 = cmc50 ? T.Kof2000Address815Xor1 : T.Kof99Address815Xor1;
  const a815x2 = cmc50 ? T.Kof2000Address815Xor2 : T.Kof99Address815Xor2;
  const a1623x1 = cmc50 ? T.Kof2000Address1623Xor1 : T.Kof99Address1623Xor1;
  const a1623x2 = cmc50 ? T.Kof2000Address1623Xor2 : T.Kof99Address1623Xor2;
  const a07 = cmc50 ? T.Kof2000Address07Xor : T.Kof99Address07Xor;

  const words = Math.floor(rom.length / 4);
  const buf = new Uint8Array(rom.length);
  for (let rpos = 0; rpos < words; rpos++) {
    cmcDecrypt(buf, 4 * rpos, 4 * rpos + 3, rom[4 * rpos], rom[4 * rpos + 3], t03, t12, u03, a07, rpos, (rpos >> 8) & 1);
    cmcDecrypt(buf, 4 * rpos + 1, 4 * rpos + 2, rom[4 * rpos + 1], rom[4 * rpos + 2], t12, t03, u12, a07, rpos,
      ((rpos >> 16) ^ a1623x2[(rpos >> 8) & 0xFF]) & 1);
  }
  for (let rpos = 0; rpos < words; rpos++) {
    let baser = rpos ^ extraXor;
    baser ^= a815x1[(baser >> 16) & 0xFF] << 8;
    baser ^= a815x2[baser & 0xFF] << 8;
    baser ^= a1623x1[baser & 0xFF] << 16;
    baser ^= a1623x2[(baser >> 8) & 0xFF] << 16;
    baser ^= a07[(baser >> 8) & 0xFF];
    if (rom.length === 0x3000000) baser = rpos < 0x2000000 / 4 ? baser & (0x2000000 / 4 - 1) : 0x2000000 / 4 + (baser & (0x1000000 / 4 - 1));
    else if (rom.length === 0x6000000) baser = rpos < 0x4000000 / 4 ? baser & (0x4000000 / 4 - 1) : 0x4000000 / 4 + (baser & (0x1000000 / 4 - 1));
    else baser &= words - 1;
    rom[4 * rpos] = buf[4 * baser];
    rom[4 * rpos + 1] = buf[4 * baser + 1];
    rom[4 * rpos + 2] = buf[4 * baser + 2];
    rom[4 * rpos + 3] = buf[4 * baser + 3];
  }
}

export function sfixDecrypt(rom, fix) {
  const src = rom.length - fix.length;
  for (let i = 0; i < fix.length; i++)
    fix[i] = rom[src + (i & ~0x1F) + ((i & 7) << 2) + ((~i & 8) >> 2) + ((i & 0x10) >> 4)];
}

const M1_PERM = [
  [15, 14, 10, 7, 1, 2, 3, 8, 0, 12, 11, 13, 6, 9, 5, 4],
  [7, 1, 8, 11, 15, 9, 2, 3, 5, 13, 4, 14, 10, 0, 6, 12],
  [8, 6, 14, 3, 10, 7, 15, 1, 4, 0, 2, 5, 13, 11, 12, 9],
  [2, 8, 15, 9, 3, 4, 11, 7, 13, 6, 0, 10, 1, 12, 14, 5],
  [1, 13, 6, 15, 14, 3, 8, 10, 9, 4, 7, 12, 5, 2, 0, 11],
  [11, 15, 3, 4, 7, 0, 9, 2, 6, 14, 12, 1, 8, 5, 10, 13],
  [10, 5, 13, 8, 6, 15, 1, 14, 11, 9, 3, 0, 12, 7, 4, 2],
  [9, 3, 7, 0, 2, 12, 4, 11, 14, 10, 5, 8, 15, 13, 1, 6],
];

function m1AddressScramble(address, key) {
  const block = (address >> 16) & 7;
  let aux = address & 0xFFFF;
  aux ^= bitSwap(key, [12, 0, 2, 4, 8, 15, 7, 13, 10, 1, 3, 6, 11, 9, 14, 5]);
  const p = [];
  for (let i = 0; i < 16; i++) p.push(M1_PERM[block][15 - i]);
  aux = bitSwap(aux, p);
  aux ^= T.M1Address07Xor[(aux >> 8) & 0xFF];
  aux ^= T.M1Address815Xor[aux & 0xFF] << 8;
  aux = bitSwap(aux, [7, 15, 14, 6, 5, 13, 12, 4, 11, 3, 10, 2, 9, 1, 8, 0]);
  return ((block << 16) | aux) >>> 0;
}

export function m1Decrypt(crypt) {
  const size = 0x80000;
  let key = 0;
  for (let i = 0; i < 0x10000; i++) key += crypt[i];
  key &= 0xFFFF;
  const rom = new Uint8Array(size);
  for (let i = 0; i < size; i++) rom[i] = crypt[m1AddressScramble(i, key)];
  return rom;
}

// --- SMA ---

function smaDataSwap(p, bits) {
  for (let i = 0; i < 0x800000 / 2; i++) {
    const a = 0x100000 / 2 + i;
    setWord(p, a, bitSwap(word(p, a), bits));
  }
}

function smaBankedSwap(p, length, block, bits) {
  const buffer = new Uint8Array(block);
  for (let i = 0; i < length; i += block) {
    const at = 0x100000 + i;
    buffer.set(p.subarray(at, at + block));
    for (let j = 0; j < block / 2; j++) {
      const src = bitSwap(j, bits);
      p[at + 2 * j] = buffer[2 * src];
      p[at + 2 * j + 1] = buffer[2 * src + 1];
    }
  }
}

function smaRelocateFixed(p, from, bits) {
  for (let i = 0; i < 0x0C0000 / 2; i++)
    setWord(p, i, word(p, Math.floor(from / 2) + bitSwap(i, bits)));
}

const SMA_PROG = {
  sma_kof99: (p) => {
    smaDataSwap(p, [13, 7, 3, 0, 9, 4, 5, 6, 1, 12, 8, 14, 10, 11, 2, 15]);
    smaBankedSwap(p, 0x600000, 0x800, [6, 2, 4, 9, 8, 3, 1, 7, 0, 5]);
    smaRelocateFixed(p, 0x700000, [18, 11, 6, 14, 17, 16, 5, 8, 10, 12, 0, 4, 3, 2, 7, 9, 15, 13, 1]);
  },
  sma_garou: (p) => {
    smaDataSwap(p, [13, 12, 14, 10, 8, 2, 3, 1, 5, 9, 11, 4, 15, 0, 6, 7]);
    smaRelocateFixed(p, 0x710000, [18, 4, 5, 16, 14, 7, 9, 6, 13, 17, 15, 3, 1, 2, 12, 11, 8, 10, 0]);
    smaBankedSwap(p, 0x800000, 0x8000, [9, 4, 8, 3, 13, 6, 2, 7, 0, 12, 1, 11, 10, 5]);
  },
  sma_garouh: (p) => {
    smaDataSwap(p, [14, 5, 1, 11, 7, 4, 10, 15, 3, 12, 8, 13, 0, 2, 9, 6]);
    smaRelocateFixed(p, 0x7F8000, [18, 5, 16, 11, 2, 6, 7, 17, 3, 12, 8, 14, 4, 0, 9, 1, 10, 15, 13]);
    smaBankedSwap(p, 0x800000, 0x8000, [12, 8, 1, 7, 11, 3, 13, 10, 6, 9, 5, 4, 0, 2]);
  },
  sma_mslug3: (p) => {
    smaDataSwap(p, [4, 11, 14, 3, 1, 13, 0, 7, 2, 8, 12, 15, 10, 9, 5, 6]);
    smaRelocateFixed(p, 0x5D0000, [18, 15, 2, 1, 13, 3, 0, 9, 6, 16, 4, 11, 5, 7, 12, 17, 14, 10, 8]);
    smaBankedSwap(p, 0x800000, 0x10000, [2, 11, 0, 14, 6, 4, 13, 8, 9, 3, 10, 7, 5, 12, 1]);
  },
  sma_mslug3a: (p) => {
    smaDataSwap(p, [2, 11, 12, 14, 9, 3, 1, 4, 13, 7, 6, 8, 10, 15, 0, 5]);
    smaRelocateFixed(p, 0x5D0000, [18, 1, 16, 14, 7, 17, 5, 8, 4, 15, 6, 3, 2, 0, 13, 10, 12, 9, 11]);
    smaBankedSwap(p, 0x800000, 0x10000, [12, 0, 11, 3, 4, 13, 6, 8, 14, 7, 5, 2, 10, 9, 1]);
  },
  sma_kof2k: (p) => {
    smaDataSwap(p, [12, 8, 11, 3, 15, 14, 7, 0, 10, 13, 6, 5, 9, 2, 1, 4]);
    smaBankedSwap(p, 0x63A000, 0x800, [4, 1, 3, 8, 6, 2, 7, 0, 9, 5]);
    smaRelocateFixed(p, 0x73A000, [18, 8, 4, 15, 13, 3, 14, 16, 2, 6, 17, 7, 12, 10, 0, 5, 11, 1, 9]);
  },
};

function pad64(o) { const a = new Array(64).fill(0); o.forEach((v, i) => { a[i] = v; }); return a; }

export const SMA_CONFIGS = {
  sma_kof99: {
    bankAddr: 0x2FFFF0, bits: [5, 12, 10, 8, 6, 14], rngAddr1: 0x2FFFF8, rngAddr2: 0x2FFFFA,
    offsets: pad64([0x000000, 0x100000, 0x200000, 0x300000, 0x3CC000, 0x4CC000, 0x3F2000, 0x4F2000,
      0x407800, 0x507800, 0x40D000, 0x50D000, 0x417800, 0x517800, 0x420800, 0x520800,
      0x424800, 0x524800, 0x429000, 0x529000, 0x42E800, 0x52E800, 0x431800, 0x531800,
      0x54D000, 0x551000, 0x567000, 0x592800, 0x588800, 0x581800, 0x599800, 0x594800, 0x598000]),
  },
  sma_garou: {
    bankAddr: 0x2FFFC0, bits: [12, 14, 6, 7, 9, 5], rngAddr1: 0x2FFFCC, rngAddr2: 0x2FFFF0,
    offsets: pad64([0x000000, 0x100000, 0x200000, 0x300000, 0x280000, 0x380000, 0x2D0000, 0x3D0000,
      0x2F0000, 0x3F0000, 0x400000, 0x500000, 0x420000, 0x520000, 0x440000, 0x540000,
      0x498000, 0x598000, 0x4A0000, 0x5A0000, 0x4A8000, 0x5A8000, 0x4B0000, 0x5B0000,
      0x4B8000, 0x5B8000, 0x4C0000, 0x5C0000, 0x4C8000, 0x5C8000, 0x4D0000, 0x5D0000,
      0x458000, 0x558000, 0x460000, 0x560000, 0x468000, 0x568000, 0x470000, 0x570000,
      0x478000, 0x578000, 0x480000, 0x580000, 0x488000, 0x588000, 0x490000, 0x590000,
      0x5D0000, 0x5D8000, 0x5E0000, 0x5E8000, 0x5F0000, 0x5F8000, 0x600000]),
  },
  sma_garouh: {
    bankAddr: 0x2FFFC0, bits: [13, 11, 2, 14, 8, 4], rngAddr1: 0x2FFFCC, rngAddr2: 0x2FFFF0,
    offsets: pad64([0x000000, 0x100000, 0x200000, 0x300000, 0x280000, 0x380000, 0x2D0000, 0x3D0000,
      0x2C8000, 0x3C8000, 0x400000, 0x500000, 0x420000, 0x520000, 0x440000, 0x540000,
      0x598000, 0x698000, 0x5A0000, 0x6A0000, 0x5A8000, 0x6A8000, 0x5B0000, 0x6B0000,
      0x5B8000, 0x6B8000, 0x5C0000, 0x6C0000, 0x5C8000, 0x6C8000, 0x5D0000, 0x6D0000,
      0x458000, 0x558000, 0x460000, 0x560000, 0x468000, 0x568000, 0x470000, 0x570000,
      0x478000, 0x578000, 0x480000, 0x580000, 0x488000, 0x588000, 0x490000, 0x590000,
      0x5D8000, 0x6D8000, 0x5E0000, 0x6E0000, 0x5E8000, 0x6E8000, 0x6E8000]),
  },
  sma_mslug3: {
    bankAddr: 0x2FFFE4, bits: [9, 3, 6, 15, 12, 14], rngAddr1: 0, rngAddr2: 0,
    offsets: pad64([0x000000, 0x020000, 0x040000, 0x060000, 0x070000, 0x090000, 0x0B0000, 0x0D0000,
      0x0E0000, 0x0F0000, 0x120000, 0x130000, 0x140000, 0x150000, 0x180000, 0x190000,
      0x1A0000, 0x1B0000, 0x1E0000, 0x1F0000, 0x200000, 0x210000, 0x240000, 0x250000,
      0x260000, 0x270000, 0x2A0000, 0x2B0000, 0x2C0000, 0x2D0000, 0x300000, 0x310000,
      0x320000, 0x330000, 0x360000, 0x370000, 0x380000, 0x390000, 0x3C0000, 0x3D0000,
      0x400000, 0x410000, 0x440000, 0x450000, 0x460000, 0x470000, 0x4A0000, 0x4B0000, 0x4C0000]),
  },
  sma_mslug3a: {
    bankAddr: 0x2FFFE4, bits: [11, 12, 6, 1, 3, 15], rngAddr1: 0, rngAddr2: 0,
    offsets: pad64([0x000000, 0x030000, 0x040000, 0x070000, 0x080000, 0x0A0000, 0x0C0000, 0x0E0000,
      0x0F0000, 0x100000, 0x130000, 0x140000, 0x150000, 0x160000, 0x190000, 0x1A0000,
      0x1B0000, 0x1C0000, 0x1F0000, 0x200000, 0x210000, 0x220000, 0x250000, 0x260000,
      0x270000, 0x280000, 0x2B0000, 0x2C0000, 0x2D0000, 0x2E0000, 0x310000, 0x320000,
      0x330000, 0x340000, 0x370000, 0x380000, 0x390000, 0x3A0000, 0x3D0000, 0x3E0000,
      0x400000, 0x410000, 0x440000, 0x450000, 0x460000, 0x470000, 0x4A0000, 0x4B0000, 0x4C0000]),
  },
  sma_kof2k: {
    bankAddr: 0x2FFFEC, bits: [5, 10, 3, 7, 14, 15], rngAddr1: 0x2FFFD8, rngAddr2: 0x2FFFDA,
    offsets: pad64([0x000000, 0x100000, 0x200000, 0x300000, 0x3F7800, 0x4F7800, 0x3FF800, 0x4FF800,
      0x407800, 0x507800, 0x40F800, 0x50F800, 0x416800, 0x516800, 0x41D800, 0x51D800,
      0x424000, 0x524000, 0x523800, 0x623800, 0x526000, 0x626000, 0x528000, 0x628000,
      0x52A000, 0x62A000, 0x52B800, 0x62B800, 0x52D000, 0x62D000, 0x52E800, 0x62E800,
      0x618000, 0x619000, 0x61A000, 0x61A800]),
  },
};

// --- PCM2 ---

export function pcm2Decrypt(ym, value) {
  const words = Math.floor(value / 2), half = Math.floor(value / 4);
  const buffer = new Uint8Array(value);
  for (let i = 0; i + value <= ym.length; i += value) {
    buffer.set(ym.subarray(i, i + value));
    for (let j = 0; j < words; j++) {
      ym[i + 2 * j] = buffer[2 * (j ^ half)];
      ym[i + 2 * j + 1] = buffer[2 * (j ^ half) + 1];
    }
  }
}

const PCM2_ADDRS = [
  [0x000000, 0x0A5000], [0xFFCE20, 0x001000], [0xFE2CF6, 0x04E001], [0xFFAC28, 0x0C2000],
  [0xFEB2C0, 0x000A000], [0xFF14EA, 0x0A7001], [0xFFB440, 0x002000],
];
const PCM2_XOR = [
  [0xF9, 0xE0, 0x5D, 0xF3, 0xEA, 0x92, 0xBE, 0xEF], [0xC4, 0x83, 0xA8, 0x5F, 0x21, 0x27, 0x64, 0xAF],
  [0xC3, 0xFD, 0x81, 0xAC, 0x6D, 0xE7, 0xBF, 0x9E], [0xC3, 0xFD, 0x81, 0xAC, 0x6D, 0xE7, 0xBF, 0x9E],
  [0xCB, 0x29, 0x7D, 0x43, 0xD2, 0x3A, 0xC2, 0xB4], [0x4B, 0xA4, 0x63, 0x46, 0xF0, 0x91, 0xEA, 0x62],
  [0x4B, 0xA4, 0x63, 0x46, 0xF0, 0x91, 0xEA, 0x62],
];

export function pcm2Swap(ym, value) {
  const buf = ym.slice(0, 0x1000000);
  for (let i = 0; i < 0x1000000; i++) {
    let j = bitSwap(i, [23, 22, 21, 20, 19, 18, 17, 0, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 16]);
    j ^= PCM2_ADDRS[value][1];
    const d = (i + PCM2_ADDRS[value][0]) & 0xFFFFFF;
    ym[j] = buf[d] ^ PCM2_XOR[value][j & 7];
  }
}

// --- KOF2002 ---

function kof2002Blocks(p, start, length, sec) {
  const dst = p.slice(start, start + length);
  for (let i = 0; i < sec.length; i++) p.set(dst.subarray(sec[i], sec[i] + 0x80000), start + i * 0x80000);
}

export const KOF2002_PROG = {
  program: (p) => kof2002Blocks(p, 0x100000, 0x400000,
    [0x100000, 0x280000, 0x300000, 0x180000, 0x000000, 0x380000, 0x200000, 0x080000]),
  samsho5: (p) => kof2002Blocks(p, 0, 0x800000,
    [0x000000, 0x080000, 0x700000, 0x680000, 0x500000, 0x180000, 0x200000, 0x480000,
      0x300000, 0x780000, 0x600000, 0x280000, 0x100000, 0x580000, 0x400000, 0x380000]),
  samsh5sp: (p) => kof2002Blocks(p, 0, 0x800000,
    [0x000000, 0x080000, 0x500000, 0x480000, 0x600000, 0x580000, 0x700000, 0x280000,
      0x100000, 0x680000, 0x400000, 0x780000, 0x200000, 0x380000, 0x300000, 0x180000]),
};

// --- PVC ---

function pvcXorWords(rom, xor1, xor2) {
  if (xor1) for (let i = 0; i < 0x100000; i++) rom[i] ^= xor1[i % 0x20];
  for (let i = 0x100000; i < 0x800000; i++) rom[i] ^= xor2[i % 0x20];
}

function pvcSwapBits(rom, bits) {
  for (let i = 0x100000; i < 0x800000; i += 4) {
    const w = bitSwap(rom[i + 1] | (rom[i + 2] << 8), bits);
    rom[i + 1] = w & 0xFF;
    rom[i + 2] = (w >> 8) & 0xFF;
  }
}

const swap8 = (v, bits) => bitSwap(v, bits);

function pvcShuffle8M(rom, lowBits, xorMid, midBits) {
  let buf = rom.slice(0, 0x800000);
  for (let i = 0; i < 0x10; i++) {
    const ofst = (i & 0xF0) + swap8(i & 0x0F, lowBits);
    rom.set(buf.subarray(ofst * 0x10000, ofst * 0x10000 + 0x10000), i * 0x10000);
  }
  for (let i = 0x100000; i < 0x800000; i += 0x100) {
    const ofst = (i & 0xF000FF) + ((i & 0x000F00) ^ xorMid) + (swap8((i & 0x0FF000) >> 12, midBits) << 12);
    rom.set(buf.subarray(ofst, ofst + 0x100), i);
  }
  buf = rom.slice(0, 0x800000);
  rom.set(buf.subarray(0x700000, 0x800000), 0x100000);
  rom.set(buf.subarray(0x100000, 0x700000), 0x200000);
}

function pvcShuffle9M(rom, lowBits, xorMid, midBits) {
  const buf = new Uint8Array(0x900000);
  for (let i = 0; i < 0x10; i++) {
    const ofst = (i & 0xF0) + swap8(i & 0x0F, lowBits);
    buf.set(rom.subarray(ofst * 0x10000, ofst * 0x10000 + 0x10000), i * 0x10000);
  }
  for (let i = 0x100000; i < 0x900000; i += 0x100) {
    const ofst = (i & 0xF000FF) + ((i & 0x000F00) ^ xorMid) + (swap8((i & 0x0FF000) >> 12, midBits) << 12);
    buf.set(rom.subarray(ofst, ofst + 0x100), i);
  }
  rom.set(buf.subarray(0, 0x100000), 0);
  rom.set(buf.subarray(0x800000, 0x900000), 0x100000);
  rom.set(buf.subarray(0x100000, 0x800000), 0x200000);
}

function pvcXorTail(rom) {
  for (let i = 0; i < 0x100000; i++) rom[0x800000 + i] ^= rom[0x100002 | i];
}

const PVC_XOR_A = [0xC2, 0x4B, 0x74, 0xFD, 0x0B, 0x34, 0xEB, 0xD7, 0x10, 0x6D, 0xF9, 0xCE, 0x5D, 0xD5, 0x61, 0x29, 0xF5, 0xBE, 0x0D, 0x82, 0x72, 0x45, 0x0F, 0x24, 0xB3, 0x34, 0x1B, 0x99, 0xEA, 0x09, 0xF3, 0x03];
const PVC_XOR_B = [0x3B, 0x6A, 0xF7, 0xB7, 0xE8, 0xA9, 0x20, 0x99, 0x9F, 0x39, 0x34, 0x0C, 0xC3, 0x9A, 0xA5, 0xC8, 0xB8, 0x18, 0xCE, 0x56, 0x94, 0x44, 0xE3, 0x7A, 0xF7, 0xDD, 0x42, 0xF0, 0x18, 0x60, 0x92, 0x9F];

export const PVC_PROG = {
  mslug5: (rom) => {
    pvcXorWords(rom, PVC_XOR_A, [0x36, 0x09, 0xB0, 0x64, 0x95, 0x0F, 0x90, 0x42, 0x6E, 0x0F, 0x30, 0xF6, 0xE5, 0x08, 0x30, 0x64, 0x08, 0x04, 0x00, 0x2F, 0x72, 0x09, 0xA0, 0x13, 0xC9, 0x0B, 0xA0, 0x3E, 0xC2, 0x00, 0x40, 0x2B]);
    pvcSwapBits(rom, [15, 14, 13, 12, 10, 11, 8, 9, 6, 7, 4, 5, 3, 2, 1, 0]);
    pvcShuffle8M(rom, [7, 6, 5, 4, 1, 0, 3, 2], 0x0700, [5, 4, 7, 6, 1, 0, 3, 2]);
  },
  svc: (rom) => {
    pvcXorWords(rom, PVC_XOR_B, [0x69, 0x0B, 0x60, 0xD6, 0x4F, 0x01, 0x40, 0x1A, 0x9F, 0x0B, 0xF0, 0x75, 0x58, 0x0E, 0x60, 0xB4, 0x14, 0x04, 0x20, 0xE4, 0xB9, 0x0D, 0x10, 0x89, 0xEB, 0x07, 0x30, 0x90, 0x50, 0x0E, 0x20, 0x26]);
    pvcSwapBits(rom, [15, 14, 13, 12, 10, 11, 8, 9, 6, 7, 4, 5, 3, 2, 1, 0]);
    pvcShuffle8M(rom, [7, 6, 5, 4, 2, 3, 0, 1], 0x0A00, [4, 5, 6, 7, 1, 0, 3, 2]);
  },
  kof2003: (rom) => {
    pvcXorTail(rom);
    pvcXorWords(rom, PVC_XOR_B, [0x2F, 0x02, 0x60, 0xBB, 0x77, 0x01, 0x30, 0x08, 0xD8, 0x01, 0xA0, 0xDF, 0x37, 0x0A, 0xF0, 0x65, 0x28, 0x03, 0xD0, 0x23, 0xD3, 0x03, 0x70, 0x42, 0xBB, 0x06, 0xF0, 0x28, 0xBA, 0x0F, 0xF0, 0x7A]);
    pvcSwapBits(rom, [15, 14, 13, 12, 5, 4, 7, 6, 9, 8, 11, 10, 3, 2, 1, 0]);
    pvcShuffle9M(rom, [7, 6, 5, 4, 0, 1, 2, 3], 0x0800, [4, 5, 6, 7, 1, 0, 3, 2]);
  },
  kof2003h: (rom) => {
    pvcXorTail(rom);
    pvcXorWords(rom, PVC_XOR_A, [0x2B, 0x09, 0xD0, 0x7F, 0x51, 0x0B, 0x10, 0x4C, 0x5B, 0x07, 0x70, 0x9D, 0x3E, 0x0B, 0xB0, 0xB6, 0x54, 0x09, 0xE0, 0xCC, 0x3D, 0x0D, 0x80, 0x99, 0x87, 0x03, 0x90, 0x82, 0xFE, 0x04, 0x20, 0x18]);
    pvcSwapBits(rom, [15, 14, 13, 12, 10, 11, 8, 9, 6, 7, 4, 5, 3, 2, 1, 0]);
    pvcShuffle9M(rom, [7, 6, 5, 4, 1, 0, 3, 2], 0x0400, [6, 7, 4, 5, 0, 1, 2, 3]);
  },
};

// --- Bootleg ---

export function svcplusProgram(rom) {
  const sec = [0x00, 0x03, 0x02, 0x05, 0x04, 0x01];
  const dst = rom.slice();
  for (let i = 0; i < rom.length / 2; i++) {
    let ofst = bitSwap(i & 0xFFFFF, [0x17, 0x16, 0x15, 0x14, 0x13, 0x00, 0x01, 0x02,
      0x0F, 0x0E, 0x0D, 0x0C, 0x0B, 0x0A, 0x09, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x10, 0x11, 0x12]);
    ofst ^= 0x0F0007;
    ofst += i & 0xFF00000;
    rom[2 * i] = dst[2 * ofst];
    rom[2 * i + 1] = dst[2 * ofst + 1];
  }
  dst.set(rom);
  for (let i = 0; i < sec.length; i++) rom.set(dst.subarray(sec[i] * 0x100000, sec[i] * 0x100000 + 0x100000), i * 0x100000);
}

export function svcbootSprites(spr) {
  const idxTbl = [0, 1, 0, 1, 2, 3, 2, 3, 3, 4, 3, 4, 4, 5, 4, 5];
  const swap4 = [[3, 0, 1, 2], [2, 3, 0, 1], [1, 2, 3, 0], [0, 1, 2, 3], [3, 2, 1, 0], [3, 0, 2, 1]];
  const dst = spr.slice();
  for (let i = 0; i < spr.length / 0x80; i++) {
    const idx = idxTbl[(i & 0xF00) >> 8];
    let ofst = bitSwap(i & 0xFF, [7, 6, 5, 4, swap4[idx][3], swap4[idx][2], swap4[idx][1], swap4[idx][0]]);
    ofst += i & 0xFFFFF00;
    spr.set(dst.subarray(ofst * 0x80, ofst * 0x80 + 0x80), i * 0x80);
  }
}

export function swapFixHalves(fix) {
  const buf = new Uint8Array(8);
  for (let i = 0; i + 16 <= fix.length; i += 16) {
    buf.set(fix.subarray(i, i + 8));
    fix.set(fix.subarray(i + 8, i + 16), i);
    fix.set(buf, i + 8);
  }
}

// --- Apply dispatch (Protection.cs:39-90) ---

export function supported(cart) {
  if (cart === 'rom' || cart === 'rom_mslugx') return true;
  if (cart.startsWith('cmc42_') || cart === 'cmc50_kof2001' || cart === 'cmc50_kof2000n') return true;
  if (cart.startsWith('sma_') || cart.startsWith('pcm2_') || cart.startsWith('k2k2_')) return true;
  if (['pvc_mslug5', 'pvc_svc', 'pvc_kf2k3', 'pvc_kf2k3h'].includes(cart)) return true;
  if (cart === 'boot_svcplus') return true;
  return false;
}

export function fixBankType(cart) {
  // Order matters: the explicit lists below win over the prefix fallback (mirrors C# switch order).
  if (['cmc50_kof2000n', 'sma_kof2k', 'k2k2_matrim', 'pvc_svc', 'pvc_kf2k3', 'pvc_kf2k3h'].includes(cart)) return 2;
  if (['pcm2_ms4p', 'k2k2_kof2k2', 'k2k2_kf2k2p'].includes(cart)) return 0;
  if (cart.startsWith('cmc42_') || cart.startsWith('cmc50_') || cart.startsWith('sma_') ||
    cart.startsWith('pcm2_') || cart.startsWith('k2k2_') || cart.startsWith('pvc_')) return 1;
  return 0;
}

export function isPvc(cart) { return cart.startsWith('pvc_'); }

export function apply(cart, r) {
  const spr = r.get('sprites');
  const fix = () => sfixDecrypt(spr, r.get('fixed'));
  const m1 = () => r.set('m1', m1Decrypt(r.get('audiocrypt')));
  const cmc42 = (key) => { gfxDecrypt(spr, key, false); fix(); };
  const cmc50 = (key, doFix = true) => { m1(); gfxDecrypt(spr, key, true); if (doFix) fix(); };

  switch (cart) {
    case 'cmc42_kof99k': cmc42(0x00); break;
    case 'cmc42_mslug3h': cmc42(0xAD); break;
    case 'cmc42_zupapa': cmc42(0xBD); break;
    case 'cmc42_ganryu': cmc42(0x07); break;
    case 'cmc42_s1945p': cmc42(0x05); break;
    case 'cmc42_preisle2': cmc42(0x9F); break;
    case 'cmc42_bangbead': cmc42(0xF8); break;
    case 'cmc42_nitd': cmc42(0xFF); break;
    case 'cmc42_sengoku3': cmc42(0xFE); break;
    case 'cmc50_kof2001': cmc50(0x1E); break;
    case 'cmc50_kof2000n': cmc50(0x00); break;
    case 'sma_kof99': SMA_PROG.sma_kof99(r.get('maincpu')); cmc42(0x00); return SMA_CONFIGS.sma_kof99;
    case 'sma_garou': SMA_PROG.sma_garou(r.get('maincpu')); cmc42(0x06); return SMA_CONFIGS.sma_garou;
    case 'sma_garouh': SMA_PROG.sma_garouh(r.get('maincpu')); cmc42(0x06); return SMA_CONFIGS.sma_garouh;
    case 'sma_mslug3': SMA_PROG.sma_mslug3(r.get('maincpu')); cmc42(0xAD); return SMA_CONFIGS.sma_mslug3;
    case 'sma_mslug3a': SMA_PROG.sma_mslug3a(r.get('maincpu')); cmc42(0xAD); return SMA_CONFIGS.sma_mslug3a;
    case 'sma_kof2k': SMA_PROG.sma_kof2k(r.get('maincpu')); cmc50(0x00); return SMA_CONFIGS.sma_kof2k;
    case 'pcm2_mslug4': cmc50(0x31); pcm2Decrypt(r.get('ymsnd:adpcma'), 8); break;
    case 'pcm2_ms4p': cmc50(0x31, false); pcm2Decrypt(r.get('ymsnd:adpcma'), 8); break;
    case 'pcm2_rotd': cmc50(0x3F); pcm2Decrypt(r.get('ymsnd:adpcma'), 16); break;
    case 'pcm2_pnyaa': cmc50(0x2E); pcm2Decrypt(r.get('ymsnd:adpcma'), 4); break;
    case 'k2k2_kof2k2': KOF2002_PROG.program(r.get('maincpu')); cmc50(0xEC); pcm2Swap(r.get('ymsnd:adpcma'), 0); break;
    case 'k2k2_kf2k2p': KOF2002_PROG.program(r.get('maincpu')); cmc50(0xEC, false); pcm2Swap(r.get('ymsnd:adpcma'), 0); break;
    case 'k2k2_matrim': KOF2002_PROG.program(r.get('maincpu')); cmc50(0x6A); pcm2Swap(r.get('ymsnd:adpcma'), 1); break;
    case 'k2k2_samsh5': KOF2002_PROG.samsho5(r.get('maincpu')); cmc50(0x0F); pcm2Swap(r.get('ymsnd:adpcma'), 4); break;
    case 'k2k2_sams5s': KOF2002_PROG.samsh5sp(r.get('maincpu')); cmc50(0x0D); pcm2Swap(r.get('ymsnd:adpcma'), 6); break;
    case 'pvc_mslug5': PVC_PROG.mslug5(r.get('maincpu')); pcm2Swap(r.get('ymsnd:adpcma'), 2); cmc50(0x19); break;
    case 'pvc_svc': PVC_PROG.svc(r.get('maincpu')); pcm2Swap(r.get('ymsnd:adpcma'), 3); cmc50(0x57); break;
    case 'pvc_kf2k3': PVC_PROG.kof2003(r.get('maincpu')); pcm2Swap(r.get('ymsnd:adpcma'), 5); cmc50(0x9D); break;
    case 'pvc_kf2k3h': PVC_PROG.kof2003h(r.get('maincpu')); pcm2Swap(r.get('ymsnd:adpcma'), 5); cmc50(0x9D); break;
    case 'boot_svcplus':
      svcplusProgram(r.get('maincpu'));
      svcbootSprites(spr);
      swapFixHalves(r.get('fixed'));
      setWord(r.get('maincpu'), Math.floor(0x0F8016 / 2), 0x33C1);
      break;
  }
  return null;
}
