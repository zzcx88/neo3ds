// RomPack.Write port (RomPack.cs:21-95): full romfs/game assembly.
import { GameDb, Region, regionName } from './gamedb.js';
import { BiosSet } from './zipset.js';
import { buildRegions, writeSprites } from './rompack.js';
import { apply, fixBankType, isPvc } from './protection.js';
import { patchFor } from './patches.js';

export async function writeGameFiles(game, rom, biosZip, zstd, opts = {}) {
  const { region = Region.Europe, startMvs = null, log = () => {}, onProgress = null } = opts;
  const out = new Map(); // name -> Uint8Array
  const bios = biosZip instanceof BiosSet ? biosZip : await BiosSet.open(biosZip);

  const regions = await buildRegions(game, rom);
  const need = (n) => {
    const r = regions.get(n);
    if (!r) throw new Error(`${game.name}: no ${n} region.`);
    return r;
  };

  // 68k program: big-endian -> dump's little-endian words (in place: Protection works on LE words)
  const program = need('maincpu');
  for (let i = 0; i + 1 < program.length; i += 2) {
    const t = program[i]; program[i] = program[i + 1]; program[i + 1] = t;
  }
  if (game.cart !== 'rom') log('  Decrypting...');
  const sma = apply(game.cart, regions);
  patchFor(game.cart)?.(program);
  out.set('p.bin', program.slice());
  out.set('s.bin', need('fixed').slice());
  if (sma) out.set('sma.bin', encodeSma(sma));
  const bankType = fixBankType(game.cart);
  if (bankType !== 0) out.set('fixbank.bin', new Uint8Array([bankType]));
  if (isPvc(game.cart)) out.set('pvc.bin', new Uint8Array([1]));

  // m1: reloaded copy (RomPack.cs:50-64)
  let m1 = regions.get('m1') ?? null;
  if (!m1) {
    const audio = need('audiocpu');
    const ops = game.regions.find((r) => r.name === 'audiocpu').ops;
    const reload = ops.find((o) => o.kind === 'reload');
    let start = reload?.a ?? 0, size = reload?.b ?? ops.find((o) => o.kind === 'load').b;
    if (reload == null && ops.some((o) => o.kind === 'copy' && o.b === 0x10000)) {
      start = 0x10000;
      size = Math.max(...ops.map((o) => o.kind === 'load' || o.kind === 'cont' ? o.a + o.b : o.kind === 'copy' ? o.b + o.c : 0)) - start;
    }
    m1 = audio.slice(start, Math.min(start + size, audio.length));
  }
  out.set('m1.bin', m1);
  out.set('v.bin', need('ymsnd:adpcma'));
  const adpcmb = regions.get('ymsnd:adpcmb');
  if (adpcmb) out.set('vb.bin', adpcmb);

  // BIOS selection (RomPack.cs:73-89)
  const aes = GameDb.aesBios(region).find((b) => bios.has(b)) ?? null;
  const mvs = GameDb.mvsBios(region).find((b) => bios.has(b)) ?? null;
  if (aes == null && mvs == null) bios.firstPresent(GameDb.BIOS);
  for (const b of [aes, mvs]) {
    if (b == null) continue;
    log(`  ${GameDb.isAesBios(b) ? 'AES' : 'MVS'} BIOS: ${b.name} (${regionName(GameDb.regionOf(b), false)})` +
      (GameDb.regionOf(b) !== region ? ` - no ${regionName(region, false)} BIOS, used instead` : ''));
  }
  const mvsFirst = mvs != null && (aes == null || (startMvs ?? GameDb.needsMvsBios(game)));
  out.set('biosmode.bin', new Uint8Array([mvsFirst ? 1 : 0]));
  log(mvsFirst ? '  System: MVS (arcade)' : '  System: AES (home)');
  if (aes) out.set('bios_aes.bin', bios.read(aes));
  if (mvs) {
    out.set('bios_mvs.bin', bios.read(mvs));
    out.set('sfix.bin', bios.read(GameDb.BIOS_FIX));
  }
  out.set('lo.bin', bios.read(GameDb.ZOOM_TABLE));

  log('  Converting and compressing graphics...');
  const gfx = need('sprites').slice(); // writeSprites converts in place
  const spr = await writeSprites(gfx, zstd, onProgress);
  out.set('c.pak', spr.pak);
  out.set('c.idx', spr.idx);

  let total = 0;
  for (const v of out.values()) total += v.length;
  return { files: out, stats: { tiles: spr.tiles, raw: spr.raw, packed: spr.packed, total } };
}

function encodeSma(sma) {
  // sma.bin for loader.c: "NSMA", bank addr, 6 bits, pad, 2 rng addrs, 64 offsets
  const buf = new Uint8Array(4 + 4 + 6 + 2 + 8 + 256);
  const dv = new DataView(buf.buffer);
  buf.set([0x4E, 0x53, 0x4D, 0x41], 0);
  dv.setInt32(4, sma.bankAddr, true);
  sma.bits.forEach((b, i) => { buf[8 + i] = b; });
  dv.setInt32(16, sma.rngAddr1, true);
  dv.setInt32(20, sma.rngAddr2, true);
  sma.offsets.forEach((o, i) => dv.setInt32(24 + i * 4, o, true));
  return buf;
}

// .neo3ds pack for the launcher (CiaBuilder.cs:208-255): romfs/game files +
// romset.txt behind a TOC. Names sorted ordinal (byte order).
export function buildPack(gameFiles, romName) {
  const enc = new TextEncoder();
  const entries = [...gameFiles.entries()].map(([n, d]) => [n, d]);
  entries.push(['romset.txt', enc.encode(romName)]);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let total = 16 + entries.length * 32;
  for (const [, d] of entries) total += d.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x4E, 0x45, 0x4F, 0x33, 0x44, 0x53, 0x50, 0x4B], 0); // NEO3DSPK
  dv.setUint32(8, 1, true);
  dv.setUint32(12, entries.length, true);
  let off = 16 + entries.length * 32;
  entries.forEach(([n, d], i) => {
    const nb = enc.encode(n);
    if (nb.length > 23) throw new Error(`${n}: name too long`);
    out.set(nb, 16 + i * 32);
    dv.setUint32(16 + i * 32 + 24, off, true);
    dv.setUint32(16 + i * 32 + 28, d.length, true);
    out.set(d, off);
    off += d.length;
  });
  return out;
}
