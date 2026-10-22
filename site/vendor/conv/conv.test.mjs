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

// #79: blocked reasons follow the page language, so the KO page does not show
// the worker's English sentence; the reason names the MAME-only input rule.
await t('preflight/korean-unknown-romset-reason', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [fakeZip('notagame.zip')], { lang: 'ko' });
  if (rows[0].ok || !/MAME/.test(rows[0].problem) || !/롬셋/.test(rows[0].problem))
    throw new Error('expected a Korean MAME romset reason: ' + JSON.stringify(rows[0]));
});

await t('preflight/korean-unsupported-cart-reason', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [fakeZip('fatfury2.zip')], { lang: 'ko' });
  if (rows[0].ok || !/보호 칩/.test(rows[0].problem))
    throw new Error('expected a Korean unsupported-cart reason: ' + JSON.stringify(rows[0]));
});

await t('preflight/missing-bios-blocks-ready-game', async () => {
  const { db, RomSet, preflight, BIOS_MISSING } = await preflightFixture();
  const rows = await preflight(db, RomSet, [romFile('nam1975.zip')]);
  if (rows[0].ok !== false || rows[0].problem !== BIOS_MISSING) throw new Error(JSON.stringify(rows[0]));
}, true);

await t('preflight/korean-missing-bios-reason', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [romFile('nam1975.zip')], { lang: 'ko' });
  if (rows[0].ok !== false || !/neogeo\.zip/.test(rows[0].problem) || !/바이오스/.test(rows[0].problem))
    throw new Error('expected a Korean missing-BIOS reason: ' + JSON.stringify(rows[0]));
}, true);

await t('preflight/korean-missing-chips-reason', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [romFile('kof98h.zip')], { lang: 'ko' });
  // Missing chips is a parent-zip / revision problem, not a "wrong format" one:
  // keep the C# CiaBuilder wording and do not append the MAME-only sentence.
  if (rows[0].ok !== false || !/롬 파일이 빠졌습니다/.test(rows[0].problem) || /MAME/.test(rows[0].problem))
    throw new Error('expected a Korean missing-chips reason: ' + JSON.stringify(rows[0]));
}, true);

await t('preflight/korean-corrupt-zip-reason', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [fakeZip('nam1975.zip')], { lang: 'ko' });
  if (rows[0].ok || !/읽지 못했습니다/.test(rows[0].problem))
    throw new Error('expected a Korean unreadable-zip reason: ' + JSON.stringify(rows[0]));
});

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

// ── #76 icon/banner choices per batch row (pure, DOM-free) ────────────────
// A batch row starts automatic. The page can set an icon and/or banner File
// on one row without touching the others; status transitions and blocked rows
// must leave that choice alone. The conversion message is built from
// artPayload(): null means "keep the automatic picture".
const artFile = (name) => ({ name });

await t('batch/art-starts-empty', async () => {
  const { createBatch, hasArt, artLabel } = await import('./batch.js');
  const b = createBatch(TWO_READY_ONE_BLOCKED());
  for (const row of b) {
    if (JSON.stringify(row.art) !== '{"icon":null,"banner":null}') throw new Error('art ' + JSON.stringify(row.art));
    if (hasArt(row) || artLabel(row) !== '') throw new Error('row should start automatic');
  }
});

await t('batch/art-per-row-independent', async () => {
  const { createBatch, setArt, clearArt, hasArt } = await import('./batch.js');
  const b = createBatch([
    { name: 'nam1975.zip', title: 'NAM-1975', ok: true, problem: null },
    { name: 'kof98.zip', title: "The King of Fighters '98", ok: true, problem: null },
    { name: 'mslug.zip', title: 'Metal Slug', ok: true, problem: null },
  ]);
  const aIcon = artFile('a-icon.png'), bBanner = artFile('b-banner.png');
  setArt(b, 0, { icon: aIcon, banner: null });
  setArt(b, 1, { icon: null, banner: bBanner });
  if (b[0].art.icon !== aIcon || b[0].art.banner !== null) throw new Error('row 0 art wrong');
  if (b[1].art.icon !== null || b[1].art.banner !== bBanner) throw new Error('row 1 art wrong');
  if (hasArt(b[2])) throw new Error('row 2 should stay automatic');
  clearArt(b, 0);
  if (hasArt(b[0]) || !hasArt(b[1])) throw new Error('clearing row 0 touched row 1');
  setArt(b, 1, null);
  if (hasArt(b[1]) || b[1].art.icon !== null || b[1].art.banner !== null) throw new Error('setArt(null) did not clear');
});

await t('batch/art-survives-status-transitions', async () => {
  const {
    createBatch, setArt, markRunning, progress, markDone, markFailed, markPending, artLabel,
  } = await import('./batch.js');
  const b = createBatch([
    { name: 'a.zip', title: 'A', ok: true, problem: null },
    { name: 'b.zip', title: 'B', ok: true, problem: null },
    { name: 'c.zip', title: 'C', ok: true, problem: null },
  ]);
  const icon = artFile('a.png'), banner = artFile('banner.png');
  setArt(b, 0, { icon, banner });
  markRunning(b, 0);
  progress(b, 0, 'art', 'icon + banner');
  markDone(b, 0, { name: 'a-web.cia', mb: 1 });
  if (b[0].art.icon !== icon || b[0].art.banner !== banner || artLabel(b[0]) !== 'icon+banner')
    throw new Error('done dropped art');
  markRunning(b, 1);
  markFailed(b, 1, 'boom');
  if (b[1].art.icon !== null || b[1].art.banner !== null) throw new Error('failure invented art');
  setArt(b, 2, { icon: null, banner });
  markRunning(b, 2);
  markPending(b, 2);
  if (b[2].art.banner !== banner) throw new Error('cancel dropped art');
  // A failed row keeps its picture: editing the row before a later retry is
  // allowed, and the list still shows what was chosen.
  setArt(b, 1, { icon, banner: null });
  if (b[1].art.icon !== icon) throw new Error('failed row cannot hold art');
});

await t('batch/art-blocked-rows-ignore-set', async () => {
  const { createBatch, setArt, clearArt, hasArt, artLabel, artPayload } = await import('./batch.js');
  const b = createBatch(TWO_READY_ONE_BLOCKED());
  setArt(b, 1, { icon: artFile('x.png'), banner: artFile('y.png') });
  if (hasArt(b[1]) || artLabel(b[1]) !== '') throw new Error('blocked row got art');
  if (artPayload(b[1]) !== null) throw new Error('blocked row payload');
  clearArt(b, 1);
  if (JSON.stringify(b[1].art) !== '{"icon":null,"banner":null}') throw new Error('blocked row art changed');
  // Out-of-range / missing rows are inert, not a crash.
  setArt(b, 99, { icon: artFile('z.png') });
  setArt(null, 0, { icon: artFile('z.png') });
});

await t('batch/art-label-and-payload', async () => {
  const { createBatch, setArt, artLabel, hasArt, artPayload } = await import('./batch.js');
  const b = createBatch([
    { name: 'a.zip', title: 'A', ok: true, problem: null },
    { name: 'b.zip', title: 'B', ok: true, problem: null },
    { name: 'c.zip', title: 'C', ok: true, problem: null },
  ]);
  const icon = artFile('icon.png'), banner = artFile('banner.png');
  setArt(b, 0, { icon, banner: null });
  setArt(b, 1, { icon, banner });
  if (artLabel(b[0]) !== 'icon' || artLabel(b[1]) !== 'icon+banner' || artLabel(b[2]) !== '')
    throw new Error(`${artLabel(b[0])} / ${artLabel(b[1])} / ${artLabel(b[2])}`);
  if (!hasArt(b[0]) || hasArt(b[2])) throw new Error('hasArt wrong');
  if (JSON.stringify(artPayload(b[0])) !== '{"icon":{"name":"icon.png"},"banner":null}')
    throw new Error('icon-only payload ' + JSON.stringify(artPayload(b[0])));
  if (artPayload(b[2]) !== null) throw new Error('automatic row must send null art');
  setArt(b, 0, { icon: null, banner });
  if (artLabel(b[0]) !== 'banner') throw new Error('banner-only label');
});

// ── #81 recognition/overall progress + all-results ZIP (pure) ────────────
// The recognition bar counts game zips, the overall bar maps a worker stage
// onto one game (or completed games + current game), and "download all" zips
// the finished files byte-for-byte under their per-row names.

await t('preflight/progress-callback-per-game-zip', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const calls = [];
  await preflight(db, RomSet, [fakeZip('a.zip'), fakeZip('b.zip'), fakeZip('neogeo.zip')], {
    onProgress: (done, total, name) => calls.push([done, total, name]),
  });
  const want = [[0, 2, null], [1, 2, 'a.zip'], [2, 2, 'b.zip']];
  if (JSON.stringify(calls) !== JSON.stringify(want)) throw new Error(JSON.stringify(calls));
});

await t('progress/stage-fraction-windows', async () => {
  const { stageFraction } = await import('./progress.js');
  if (stageFraction('load', 0.05) !== 0.05) throw new Error('load');
  if (stageFraction('romfs', 0.1) !== 0.1 || stageFraction('romfs', 0.65) !== 0.65) throw new Error('romfs');
  if (stageFraction('art', 0) !== 0.7 || stageFraction('cia', 0) !== 0.85) throw new Error('stage floors');
  if (stageFraction('cia', 0.9) !== 0.9) throw new Error('pack');
  if (stageFraction('cia', 99) !== 1) throw new Error('high clamp');
  if (stageFraction('load', undefined) !== 0 || stageFraction('bogus', 0.5) !== 0) throw new Error('missing stage');
});

await t('progress/overall-batch-capped-until-done', async () => {
  const { overallFraction } = await import('./progress.js');
  const near = (got, want, tag) => { if (Math.abs(got - want) > 1e-9) throw new Error(`${tag}: ${got} != ${want}`); };
  near(overallFraction({ ready: 3, index: 0, step: 'load', frac: 0.05 }), 0.05 / 3, 'first game');
  near(overallFraction({ ready: 3, index: 1, step: 'romfs', frac: 0.65 }), 1.65 / 3, 'second game');
  near(overallFraction({ ready: 3, index: 2, step: 'cia', frac: 0.85 }), 2.85 / 3, 'third game');
  if (overallFraction({ ready: 3, index: 2, step: 'cia', frac: 1 }) !== 0.99) throw new Error('not capped at 99%');
  near(overallFraction({ ready: 2, index: 9, step: 'load', frac: 0 }), 0.5, 'index clamp');
  near(overallFraction({ ready: 0 }), 0, 'empty ready');
});

await t('progress/percent-text', async () => {
  const { percentText } = await import('./progress.js');
  if (percentText(0.678) !== '68%' || percentText(0) !== '0%' || percentText(1) !== '100%') throw new Error('percent');
  if (percentText(-1) !== '0%' || percentText(2) !== '100%') throw new Error('percent clamp');
});

await t('bundle/zip-roundtrip-stored', async () => {
  const { zipResults } = await import('./bundle.js');
  const { unzipSync } = await import('./fflate.js');
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array(1024).fill(7);
  const zip = zipResults([{ name: 'a-web.cia', bytes: a }, { name: 'b.neo3ds', bytes: b }]);
  if (!(zip instanceof Uint8Array)) throw new Error('not a Uint8Array');
  const out = unzipSync(zip);
  if (JSON.stringify(Object.keys(out).sort()) !== '["a-web.cia","b.neo3ds"]') throw new Error('names ' + Object.keys(out));
  if (out['a-web.cia'].join(',') !== '1,2,3,4,5') throw new Error('a bytes');
  if (out['b.neo3ds'].length !== 1024 || out['b.neo3ds'][1023] !== 7) throw new Error('b bytes');
});

await t('bundle/rejects-empty-duplicate-unsafe', async () => {
  const { zipResults } = await import('./bundle.js');
  const one = () => new Uint8Array([1]);
  const err = (fn) => { try { fn(); } catch (e) { return String(e.message); } return ''; };
  if (!/at least one/.test(err(() => zipResults([])))) throw new Error('empty accepted');
  if (!/duplicate/.test(err(() => zipResults([{ name: 'x.cia', bytes: one() }, { name: 'x.cia', bytes: one() }]))))
    throw new Error('duplicate accepted');
  for (const name of ['', '../x.cia', '/abs.cia', 'a/../b.cia', 'a\\b.cia', 'a//b.cia', 'dir/', 'bad\u0000.cia']) {
    if (!/name/.test(err(() => zipResults([{ name, bytes: one() }]))))
      throw new Error('unsafe name accepted: ' + JSON.stringify(name));
  }
  if (!/Uint8Array/.test(err(() => zipResults([{ name: 'x.cia', bytes: [1, 2] }]))))
    throw new Error('non-byte payload accepted');
});

// Duplicate result names (same zip dropped twice) must still bundle: the page
// asks for " (2)"-style unique entry names before zipping.
await t('bundle/unique-entry-names', async () => {
  const { uniqueEntryName } = await import('./bundle.js');
  const used = new Set();
  const seq = [
    ['a.cia', 'a.cia'],
    ['a.cia', 'a (2).cia'],
    ['a.cia', 'a (3).cia'],
    ['noext', 'noext'],
    ['noext', 'noext (2)'],
    ['dir/x.neo3ds', 'dir/x.neo3ds'],
  ];
  for (const [input, want] of seq) {
    const got = uniqueEntryName(input, used);
    if (got !== want) throw new Error(`${input} -> ${got}, want ${want}`);
  }
});

// Producer contract: every frac the worker posts must already lie inside its
// stage window, otherwise stageFraction clamps it and the overall bar jumps.
// (Regression: the launcher path used art 0.1 / cia 0.5, clamped to 70%/85%.)
await t('progress/producer-fracs-stay-in-stage', async () => {
  const { STAGES, stageFraction } = await import('./progress.js');
  const producers = [
    ['load', 0], ['load', 0.05],
    ['romfs', 0.1], ['romfs', 0.65],
    ['art', 0.7], ['art', 0.75],
    ['cia', 0.85], ['cia', 0.9], ['cia', 0.92],
  ];
  for (const [step, frac] of producers) {
    const [lo, hi] = STAGES[step];
    if (frac < lo || frac > hi) throw new Error(`${step} ${frac} outside [${lo},${hi}]`);
    if (stageFraction(step, frac) !== frac) throw new Error(`${step} ${frac} was clamped`);
  }
});

process.exit(fail ? 1 : 0);
