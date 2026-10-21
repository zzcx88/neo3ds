import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Seam A (red): module equivalence vs C# behavior. Each test below must fail
// until the corresponding conv/ module lands.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// ROM zips are git-excluded: skip ROM-dependent tests when absent (CI).
// Gate on the files actually opened below (kof98h.zip + parent kof98.zip),
// so a merged set (parent only) skips instead of failing with ENOENT.
const HAS_ROMS = (() => { try { readFileSync(join(ROOT, 'roms/kof98h.zip')); readFileSync(join(ROOT, 'roms/kof98.zip')); return true; } catch { return false; } })();
if (!HAS_ROMS) console.log('SKIP rom-dependent tests (need roms/kof98h.zip + roms/kof98.zip)');
let fail = 0;
let skipped = 0;
const t = async (name, fn, needsRoms = false) => {
  if (needsRoms && !HAS_ROMS) { skipped++; console.log(`SKIP ${name}`); return; }
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name} — ${String(e.message || e).slice(0, 120)}`); }
};

// GameDb: kof98h lookup + title + cart
await t('gamedb/find-kof98h', async () => {
  const { GameDb } = await import('./gamedb.js');
  const db = await GameDb.load(join(ROOT, 'converter/assets/neogeo_games.json'));
  const g = db.find('kof98h');
  if (!g || g.cart !== 'rom' || g.parent !== 'kof98') throw new Error('bad record');
  if (db.title(g) !== "The King of Fighters '98 - The Slugfest") throw new Error('bad title: ' + db.title(g));
  if (db.unsupported(g) !== null) throw new Error('kof98h should be supported');
});

// Crc32(romname) -> UniqueId/TitleId (CiaBuilder.cs:87-100)
await t('job/title-id', async () => {
  const { titleId } = await import('./job.js');
  if (titleId('kof98h') !== '000400000C9DF700') throw new Error('got ' + titleId('kof98h'));
});
await t('zipset/split-crc', async () => {
  const { RomSet } = await import('./zipset.js');
  const rom = await RomSet.open([
    join(ROOT, 'roms/kof98h.zip'), join(ROOT, 'roms/kof98.zip'),
  ]);
  const p1 = await rom.read('242-pn1.p1', 0x61ac868a, 'kof98h');
  if (p1.length !== 1048576) throw new Error('p1 len ' + p1.length);
}, true);

// BuildRegions: kof98h sprites 64MB via 16b interleave
await t('rompack/regions', async () => {
  const { GameDb } = await import('./gamedb.js');
  const { RomSet } = await import('./zipset.js');
  const { buildRegions } = await import('./rompack.js');
  const db = await GameDb.load(join(ROOT, 'converter/assets/neogeo_games.json'));
  const rom = await RomSet.open([join(ROOT, 'roms/kof98h.zip'), join(ROOT, 'roms/kof98.zip')]);
  const r = await buildRegions(db.find('kof98h'), rom);
  if (r.get('sprites').length !== 67108864) throw new Error('sprites len');
}, true);

// Art: icon 48x48 + banner 256x128 PNG (node: canvas stub via pure-JS PNG writer)
await t('art/png-spec', async () => {
  const { iconPng, bannerPng } = await import('./art.js');
  const ic = await iconPng("The King of Fighters '98");
  const bn = await bannerPng("The King of Fighters '98");
  const dim = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (JSON.stringify(dim(ic)) !== '[48,48]') throw new Error('icon dim');
  if (JSON.stringify(dim(bn)) !== '[256,128]') throw new Error('banner dim');
});

process.exit(fail ? 1 : 0);
