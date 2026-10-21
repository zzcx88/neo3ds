// RomPack.Write port (RomPack.cs:21-95): full romfs/game assembly.
// Protection/Patch hooks included; both are null for cart "rom" (Phase 1 scope).
import { GameDb, Region, regionName } from './gamedb.js';
import { BiosSet } from './zipset.js';
import { buildRegions, writeSprites } from './rompack.js';

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

  // 68k program: big-endian -> dump's little-endian words
  const program = need('maincpu').slice();
  for (let i = 0; i + 1 < program.length; i += 2) {
    const t = program[i]; program[i] = program[i + 1]; program[i + 1] = t;
  }
  // Protection.Apply(game.cart, regions): null for "rom" (Phase 2 ports schemes)
  if (game.cart !== 'rom') throw new Error(`cart ${game.cart} needs Phase-2 Protection port`);
  out.set('p.bin', program);
  out.set('s.bin', need('fixed'));

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
  if (aes) out.set('bios_aes.bin', bios.read(aes));
  if (mvs) {
    out.set('bios_mvs.bin', bios.read(mvs));
    out.set('sfix.bin', bios.read(GameDb.BIOS_FIX));
  }
  const mvsFirst = mvs != null && (aes == null || (startMvs ?? GameDb.needsMvsBios(game)));
  out.set('biosmode.bin', new Uint8Array([mvsFirst ? 1 : 0]));
  log(mvsFirst ? '  System: MVS (arcade)' : '  System: AES (home)');
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
