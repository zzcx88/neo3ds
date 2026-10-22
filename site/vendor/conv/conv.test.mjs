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

// ── #74 batch list/status model (pure, DOM-free) ──────────────────────────
// The page shows the recognized-games list before converting, then tracks
// each row through pending → running → done/failed. Blocked rows never run,
// and one failure must not stop the others.
const TWO_READY_ONE_BLOCKED = () => ([
  { name: 'nam1975.zip', title: 'NAM-1975', rom: 'nam1975', ok: true, problem: null },
  { name: 'notagame.zip', title: null, rom: null, ok: false, problem: "'notagame' is not a MAME Neo Geo romset name." },
  { name: 'mslug.zip', title: 'Metal Slug', rom: 'mslug', ok: true, problem: null },
]);

await t('batch/create-lists-ready-and-blocked', async () => {
  const { createBatch, STATUS } = await import('./batch.js');
  const b = createBatch(TWO_READY_ONE_BLOCKED());
  if (b.length !== 3) throw new Error('rows ' + b.length);
  if (b[0].status !== STATUS.PENDING || b[1].status !== STATUS.BLOCKED || b[2].status !== STATUS.PENDING)
    throw new Error('statuses ' + b.map((r) => r.status));
  if (b[1].problem == null || b[0].title !== 'NAM-1975' || b[0].name !== 'nam1975.zip')
    throw new Error('row fields lost');
});

await t('batch/summary-counts-ready-blocked', async () => {
  const { createBatch, summary } = await import('./batch.js');
  const s = summary(createBatch(TWO_READY_ONE_BLOCKED()));
  const want = { total: 3, ready: 2, blocked: 1, done: 0, failed: 0, running: 0, finished: 0 };
  if (JSON.stringify(s) !== JSON.stringify(want)) throw new Error(JSON.stringify(s));
});

await t('batch/blocked-never-runs', async () => {
  const { createBatch, markRunning, markFailed, markDone, summary, STATUS } = await import('./batch.js');
  const b = createBatch(TWO_READY_ONE_BLOCKED());
  markRunning(b, 1);
  markFailed(b, 1, 'must not run');
  markDone(b, 1, { name: 'nope' });
  if (b[1].status !== STATUS.BLOCKED) throw new Error('blocked row changed to ' + b[1].status);
  if (b[1].detail !== '') throw new Error('blocked row got detail');
  const s = summary(b);
  if (s.running !== 0 || s.done !== 0 || s.failed !== 0) throw new Error(JSON.stringify(s));
});

await t('batch/running-progress-done', async () => {
  const { createBatch, markRunning, progress, markDone, summary, STATUS } = await import('./batch.js');
  const b = createBatch(TWO_READY_ONE_BLOCKED());
  markRunning(b, 0);
  progress(b, 0, 'romfs', 'compressing 42%');
  if (b[0].status !== STATUS.RUNNING) throw new Error('not running');
  if (b[0].step !== 'romfs' || b[0].detail !== 'compressing 42%') throw new Error('progress not stored');
  if (summary(b).running !== 1) throw new Error('running count');
  markDone(b, 0, { name: 'nam1975-web.cia', mb: 12.3 });
  const s = summary(b);
  if (b[0].status !== STATUS.DONE || b[0].result.name !== 'nam1975-web.cia') throw new Error('not done');
  if (s.done !== 1 || s.running !== 0 || s.finished !== 1) throw new Error(JSON.stringify(s));
});

await t('batch/failure-is-isolated', async () => {
  const { createBatch, markRunning, progress, markDone, markFailed, summary, STATUS } = await import('./batch.js');
  const b = createBatch([
    { name: 'a.zip', title: 'A', ok: true, problem: null },
    { name: 'b.zip', title: 'B', ok: true, problem: null },
    { name: 'c.zip', title: 'C', ok: true, problem: null },
  ]);
  markRunning(b, 0); progress(b, 0, 'load', 'reading zips');
  markFailed(b, 0, 'ROM files are missing (201-p1.p1)');
  if (b[0].status !== STATUS.FAILED || b[0].detail === '') throw new Error('failure not recorded');
  markRunning(b, 1); markDone(b, 1, { name: 'b-web.cia', mb: 9 });
  markRunning(b, 2); markDone(b, 2, { name: 'c-web.cia', mb: 9 });
  const s = summary(b);
  const want = { total: 3, ready: 3, blocked: 0, done: 2, failed: 1, running: 0, finished: 3 };
  if (JSON.stringify(s) !== JSON.stringify(want)) throw new Error(JSON.stringify(s));
  if (b[0].detail !== 'ROM files are missing (201-p1.p1)') throw new Error('failure reason lost');
  if (b[1].result.name !== 'b-web.cia' || b[2].result.name !== 'c-web.cia') throw new Error('other results lost');
});

await t('batch/cancel-returns-running-row-to-pending', async () => {
  const { createBatch, markRunning, markPending, summary, STATUS } = await import('./batch.js');
  const b = createBatch([{ name: 'a.zip', title: 'A', ok: true, problem: null }]);
  markRunning(b, 0);
  markPending(b, 0);
  if (b[0].status !== STATUS.PENDING) throw new Error('status ' + b[0].status);
  const s = summary(b);
  if (s.running !== 0 || s.failed !== 0 || s.done !== 0) throw new Error(JSON.stringify(s));
  markRunning(b, 0);
  if (b[0].status !== STATUS.RUNNING) throw new Error('cannot restart after cancel');
});

// ── #74 preflight judgment against real romsets (skipped when roms/ absent) ──
// The list's "convertible / why not" rules must be the same ones conversion
// uses, so these drive the real GameDb/pickGame path with real zip files.
const romFile = (name) => ({
  name,
  arrayBuffer: async () => {
    const d = readFileSync(join(ROOT, 'roms', name));
    return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
  },
});
const fakeZip = (name) => ({ name, arrayBuffer: async () => new ArrayBuffer(0) });
const preflightFixture = async () => {
  const { GameDb } = await import('./gamedb.js');
  const { RomSet } = await import('./zipset.js');
  const mod = await import('./preflight.js');
  return { db: await GameDb.load(join(ROOT, 'converter/assets/neogeo_games.json')), RomSet, ...mod };
};

await t('preflight/ready-blocked-reasons', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [
    romFile('nam1975.zip'), romFile('kof98h.zip'), fakeZip('notagame.zip'), romFile('neogeo.zip'),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  if (rows.length !== 3) throw new Error('rows ' + rows.length);
  if (!by['nam1975.zip'].ok) throw new Error('nam1975 blocked: ' + by['nam1975.zip'].problem);
  if (by['kof98h.zip'].ok || !/missing/i.test(by['kof98h.zip'].problem))
    throw new Error('kof98h should miss its parent chips: ' + JSON.stringify(by['kof98h.zip']));
  if (by['notagame.zip'].ok || !/not a MAME Neo Geo romset/.test(by['notagame.zip'].problem))
    throw new Error('unknown zip reason: ' + JSON.stringify(by['notagame.zip']));
}, true);

await t('preflight/missing-bios-blocks-ready-game', async () => {
  const { db, RomSet, preflight, BIOS_MISSING } = await preflightFixture();
  const rows = await preflight(db, RomSet, [romFile('nam1975.zip')]);
  if (rows[0].ok !== false || rows[0].problem !== BIOS_MISSING) throw new Error(JSON.stringify(rows[0]));
}, true);

await t('preflight/clone-with-parent-zip-is-ready', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [romFile('kof98h.zip'), romFile('kof98.zip'), romFile('neogeo.zip')]);
  const k = rows.find((r) => r.name === 'kof98h.zip');
  if (!k?.ok) throw new Error('kof98h with parent should be ready: ' + JSON.stringify(rows));
}, true);

// ── #75 custom art cover crop (Art.cs Fit: scale to fill, crop evenly) ─────
// Fixed whole-pixel examples, no half-way rounding ties: dw/dh are the
// rounded scaled size and dx/dy centre the overflow (negative = cropped).
const sameRect = (got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${g} != ${w}`);
};

await t('art/coverRect-landscape', async () => {
  const { coverRect } = await import('./art.js');
  sameRect(coverRect(300, 100, 48, 48), { dx: -48, dy: 0, dw: 144, dh: 48 });
});

await t('art/coverRect-portrait', async () => {
  const { coverRect } = await import('./art.js');
  sameRect(coverRect(100, 300, 48, 48), { dx: 0, dy: -48, dw: 48, dh: 144 });
});

await t('art/coverRect-exact-size', async () => {
  const { coverRect } = await import('./art.js');
  sameRect(coverRect(48, 48, 48, 48), { dx: 0, dy: 0, dw: 48, dh: 48 });
  sameRect(coverRect(256, 128, 256, 128), { dx: 0, dy: 0, dw: 256, dh: 128 });
});

await t('art/coverRect-banner', async () => {
  const { coverRect } = await import('./art.js');
  sameRect(coverRect(800, 450, 256, 128), { dx: 0, dy: -8, dw: 256, dh: 144 });
});

// No canvas in Node: a custom picture must fail with a clear browser-only
// message instead of silently drawing the automatic art.
await t('art/image-needs-browser-canvas', async () => {
  const { iconPng } = await import('./art.js');
  let message = '';
  try { await iconPng('NAM-1975', { width: 10, height: 10 }); } catch (e) { message = String(e.message); }
  if (!/browser-only/.test(message)) throw new Error('expected browser-only error, got ' + JSON.stringify(message));
});

process.exit(fail ? 1 : 0);
