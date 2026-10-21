// 68k program patches (GameDb.Patches, GameDb.cs:111-130).
// Program image keeps the dump's byte order: 16-bit words little-endian.
import { word, setWord } from './protection.js';

const NOP = 0x4E71;

function mslugX(p) {
  for (let i = 0; i + 8 <= p.length; i += 2) {
    if (word(p, i / 2) === 0x0243 && word(p, i / 2 + 1) === 0x0001 && word(p, i / 2 + 2) === 0x6600) {
      setWord(p, i / 2 + 2, NOP);
      setWord(p, i / 2 + 3, NOP);
    }
  }
  for (const a of [0x3BDC, 0x3BDE, 0x3BE0, 0x3C0C, 0x3C0E, 0x3C10, 0x3C36, 0x3C38]) setWord(p, a / 2, NOP);
}

export function patchFor(cart) {
  if (cart === 'rom_mslugx') return mslugX;
  return null;
}
