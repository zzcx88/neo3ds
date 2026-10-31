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

// #121: the index comes from the central directory, so judging a romset must
// not inflate chips. A File-shaped source counts the bytes actually read.
const fileSourceOf = (name, bytes) => {
  const f = {
    name, size: bytes.length, bytesRead: 0,
    slice(off, end) {
      f.bytesRead += end - off;
      return { arrayBuffer: async () => bytes.slice(off, end).buffer };
    },
  };
  return f;
};
// Deterministic, poorly compressible bytes so the zip really is ~1MB.
const noise = (n, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
};

await t('zipset/index-needs-no-chip-bytes', async () => {
  const { zipSync } = await import('./fflate.js');
  const { RomSet } = await import('./zipset.js');
  const { crc32Bytes } = await import('./job.js');
  const chip = noise(1 << 20);
  const zip = zipSync({ 'big.bin': chip });
  const f = fileSourceOf('big.zip', zip);
  const rom = await RomSet.open([f]);
  if (!rom.has('big.bin', crc32Bytes(chip))) throw new Error('chip not indexed by CRC');
  if (f.bytesRead > 100_000) throw new Error(`read ${f.bytesRead} bytes for a ${zip.length} byte zip`);
});

await t('zipset/lazy-read-returns-entry', async () => {
  const { zipSync } = await import('./fflate.js');
  const { RomSet } = await import('./zipset.js');
  const { crc32Bytes } = await import('./job.js');
  const chip = noise(4096, 7);
  const zip = zipSync({ 'rom.bin': chip }, { level: 0 }); // stored entry
  const rom = await RomSet.open([fileSourceOf('stored.zip', zip)]);
  const got = await rom.read('rom.bin', crc32Bytes(chip), 'testset');
  if (Buffer.compare(Buffer.from(got), Buffer.from(chip)) !== 0) throw new Error('stored entry bytes differ');
  const deflated = zipSync({ 'rom.bin': chip });
  const rom2 = await RomSet.open([fileSourceOf('deflated.zip', deflated)]);
  const got2 = await rom2.read('rom.bin', crc32Bytes(chip), 'testset');
  if (Buffer.compare(Buffer.from(got2), Buffer.from(chip)) !== 0) throw new Error('deflated entry bytes differ');
});

await t('zipset/crc-mismatch-keeps-reason', async () => {
  const { zipSync } = await import('./fflate.js');
  const { RomSet } = await import('./zipset.js');
  const { crc32Bytes } = await import('./job.js');
  const chip = noise(1024, 3);
  const rom = await RomSet.open([fileSourceOf('v1.zip', zipSync({ 'rom.bin': chip }))]);
  const actual = crc32Bytes(chip);
  const expected = (actual ^ 0xdead) >>> 0;
  let msg = '';
  try { await rom.read('rom.bin', expected, 'kof98h'); } catch (e) { msg = e.message; }
  const want = `rom.bin has CRC ${actual.toString(16)}, expected ${expected.toString(16)}: not the kof98h romset version.`;
  if (msg !== want) throw new Error(`got ${JSON.stringify(msg)}`);
});

await t('zipset/truncated-zip-throws', async () => {
  const { zipSync } = await import('./fflate.js');
  const { RomSet } = await import('./zipset.js');
  const zip = zipSync({ 'rom.bin': noise(512, 9) });
  let msg = '';
  try { await RomSet.open([fileSourceOf('broken.zip', zip.subarray(0, zip.length - 30))]); } catch (e) { msg = e.message; }
  if (!/zip archive|central directory/.test(msg)) throw new Error('expected a zip error, got ' + JSON.stringify(msg));
});

// ── #202 BIOS profile: central directory only, known slots, sfix/lo ─────────
// The table is injectable so the test can use synthetic bytes: real BIOS CRCs
// would need the copyrighted ROMs. Production uses GameDb's table.
const biosFixture = async (entries, seed = 20) => {
  const { zipSync } = await import('./fflate.js');
  const { openZipIndex } = await import('./zipset.js');
  const { crc32Bytes } = await import('./job.js');
  const bytes = {};
  for (const [i, name] of entries.names.entries()) bytes[name] = noise(0x20000, seed + i);
  const table = {
    chips: (entries.chips ?? []).map((name) => ({
      name, crc: crc32Bytes(bytes[name]), size: bytes[name].length,
    })),
    fix: entries.fix ? { name: 'sfix.sfix', crc: crc32Bytes(bytes['sfix.sfix']), size: bytes['sfix.sfix'].length } : undefined,
    zoom: entries.zoom ? { name: '000-lo.lo', crc: crc32Bytes(bytes['000-lo.lo']), size: bytes['000-lo.lo'].length } : undefined,
  };
  const files = Object.fromEntries(entries.names.map((name) => [name, bytes[name]]));
  return { zip: await openZipIndex(fileSourceOf('neogeo.zip', zipSync(files))), table, bytes };
};

await t('biosinfo/profile-lists-known-aes-mvs-and-support-roms', async () => {
  const { biosProfile } = await import('./biosinfo.js');
  const { zip, table } = await biosFixture({
    names: ['neo-epo.bin', 'sp-s2.sp1', 'sfix.sfix', '000-lo.lo'],
    chips: ['neo-epo.bin', 'sp-s2.sp1'], fix: true, zoom: true,
  });
  const p = biosProfile(zip, table);
  const got = JSON.stringify({ aes: p.aes, mvs: p.mvs, sfix: p.sfix, lo: p.lo });
  const want = JSON.stringify({
    aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }],
    mvs: [{ name: 'sp-s2.sp1', region: 'Europe/Asia' }],
    sfix: 'ok', lo: 'ok',
  });
  if (!p.present || p.error !== null || got !== want) throw new Error(got);
});

await t('biosinfo/name-with-wrong-crc-is-a-mismatch', async () => {
  const { biosProfile } = await import('./biosinfo.js');
  const { zip, table } = await biosFixture({
    names: ['neo-epo.bin', 'sfix.sfix'],
    chips: ['neo-epo.bin'], fix: true, zoom: false,
  });
  // Same name, different bytes than the table expects: a mismatch, not a clean match or absence.
  table.chips[0].crc ^= 0xdead;
  const p = biosProfile(zip, table);
  if (p.aes.length !== 0) throw new Error('wrong-CRC chip listed as present: ' + JSON.stringify(p.aes));
  if (JSON.stringify(p.mismatch) !== JSON.stringify([{ name: 'neo-epo.bin', region: 'Europe/Asia' }]))
    throw new Error('mismatch: ' + JSON.stringify(p.mismatch));
  if (p.sfix !== 'ok' || p.lo !== 'missing') throw new Error(JSON.stringify({ sfix: p.sfix, lo: p.lo }));
  if (p.unknown !== 0 || p.unibios !== false) throw new Error(JSON.stringify({ unknown: p.unknown, unibios: p.unibios }));
});

await t('biosinfo/classifies-mismatch-unknown-and-unibios', async () => {
  const { biosProfile } = await import('./biosinfo.js');
  const { zip, table } = await biosFixture({
    names: ['neo-epo.bin', 'sp-s.sp1', 'sfix.sfix', 'uni-bios_4_0.rom', 'extra.bin'],
    chips: ['neo-epo.bin', 'sp-s.sp1'], fix: true, zoom: false,
  });
  table.chips[1].crc ^= 0xdead;
  table.fix.crc ^= 0xdead;
  const p = biosProfile(zip, table);
  const got = JSON.stringify({
    aes: p.aes, mvs: p.mvs, mismatch: p.mismatch, sfix: p.sfix, lo: p.lo,
    unknown: p.unknown, unibios: p.unibios,
  });
  const want = JSON.stringify({
    aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }],
    mvs: [],
    mismatch: [{ name: 'sp-s.sp1', region: 'Europe/Asia' }],
    sfix: 'mismatch', lo: 'missing', unknown: 1, unibios: true,
  });
  if (got !== want) throw new Error(got);
});

await t('biosinfo/unibios-only-set-is-flagged', async () => {
  const { biosProfile } = await import('./biosinfo.js');
  const { zip, table } = await biosFixture({ names: ['uni-bios_4_0.rom'], chips: [], fix: false, zoom: false });
  const p = biosProfile(zip, table);
  if (p.unibios !== true || p.unknown !== 0) throw new Error(JSON.stringify({ unibios: p.unibios, unknown: p.unknown }));
  if (p.aes.length || p.mvs.length || p.mismatch.length) throw new Error('known slots in a UniBIOS-only set');
  if (p.sfix !== 'missing' || p.lo !== 'missing') throw new Error(JSON.stringify({ sfix: p.sfix, lo: p.lo }));
});

await t('biosinfo/zero-byte-known-slot-is-mismatch', async () => {
  const { zipSync } = await import('./fflate.js');
  const { openZipIndex } = await import('./zipset.js');
  const { biosProfile } = await import('./biosinfo.js');
  const zip = await openZipIndex(fileSourceOf('neogeo.zip', zipSync({
    'sfix.sfix': new Uint8Array(0),
    'uni-bios_4_0.rom': new Uint8Array(0),
  })));
  const table = {
    chips: [],
    fix: { name: 'sfix.sfix', crc: 0xc2ea0cfd, size: 0x20000 },
    zoom: undefined,
  };
  const p = biosProfile(zip, table);
  if (p.sfix !== 'mismatch') throw new Error('sfix: ' + p.sfix);
  if (p.unibios !== true) throw new Error('unibios: ' + p.unibios);
});

await t('biosinfo/no-bios-file-and-unreadable-zip', async () => {
  const { readBiosProfile } = await import('./biosinfo.js');
  const none = await readBiosProfile([fileSourceOf('kof98.zip', new Uint8Array(8))]);
  if (JSON.stringify(none) !== JSON.stringify({ present: false })) throw new Error(JSON.stringify(none));
  const bad = await readBiosProfile([fileSourceOf('neogeo.zip', new Uint8Array(0))]);
  if (bad.present !== true || bad.error !== 'zip') throw new Error(JSON.stringify(bad));
});

await t('biosinfo/profile-needs-no-entry-bytes', async () => {
  const { zipSync } = await import('./fflate.js');
  const f = fileSourceOf('neogeo.zip', zipSync({
    'neo-epo.bin': noise(0x20000, 31), 'sp-s2.sp1': noise(0x20000, 32),
    'sfix.sfix': noise(0x20000, 33), '000-lo.lo': noise(0x20000, 34),
  }));
  const { readBiosProfile } = await import('./biosinfo.js');
  await readBiosProfile([f]);
  if (f.bytesRead > 100_000) throw new Error(`read ${f.bytesRead} bytes of a ${f.size} byte zip`);
});

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
  // #125: rows carry the canonical romset name, never the dropped zip's name.
  if (by['nam1975.zip'].set !== 'nam1975') throw new Error('nam1975 set: ' + by['nam1975.zip'].set);
  if (by['kof98h.zip'].ok || !/missing/i.test(by['kof98h.zip'].problem))
    throw new Error('kof98h should miss its parent chips: ' + JSON.stringify(by['kof98h.zip']));
  if (by['kof98h.zip'].set !== 'kof98h') throw new Error('kof98h set: ' + by['kof98h.zip'].set);
  if (by['notagame.zip'].ok || !/not a MAME Neo Geo romset/.test(by['notagame.zip'].problem))
    throw new Error('unknown zip reason: ' + JSON.stringify(by['notagame.zip']));
  if (by['notagame.zip'].set !== null) throw new Error('unknown set: ' + by['notagame.zip'].set);
}, true);

// #79: blocked reasons follow the page language, so the KO page does not show
// the worker's English sentence; the reason names the MAME-only input rule.
await t('preflight/korean-unknown-romset-reason', async () => {
  const { db, RomSet, preflight } = await preflightFixture();
  const rows = await preflight(db, RomSet, [fakeZip('notagame.zip')], { lang: 'ko' });
  if (rows[0].ok || !/MAME/.test(rows[0].problem) || !/롬셋/.test(rows[0].problem))
    throw new Error('expected a Korean MAME romset reason: ' + JSON.stringify(rows[0]));
  if (rows[0].set !== null) throw new Error('unknown romset leaked a set: ' + rows[0].set);
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

await t('progress/batch-fraction-serial-and-capped', async () => {
  const { batchFraction } = await import('./progress.js');
  const near = (got, want, tag) => { if (Math.abs(got - want) > 1e-9) throw new Error(`${tag}: ${got} != ${want}`); };
  // serial (one game in flight) matches the old per-index timeline
  near(batchFraction({ ready: 3, done: 0, running: [{ step: 'load', frac: 0.05 }] }), 0.05 / 3, 'first game');
  near(batchFraction({ ready: 3, done: 1, running: [{ step: 'romfs', frac: 0.65 }] }), 1.65 / 3, 'second game');
  near(batchFraction({ ready: 3, done: 2, running: [{ step: 'cia', frac: 0.85 }] }), 2.85 / 3, 'third game');
  if (batchFraction({ ready: 3, done: 2, running: [{ step: 'cia', frac: 1 }] }) !== 0.99) throw new Error('not capped at 99%');
  near(batchFraction({ ready: 0 }), 0, 'empty ready');
  near(batchFraction({ ready: 2, done: 9, running: [{ step: 'cia', frac: 1 }] }), 0.99, 'done clamp');
});

await t('progress/batch-fraction-parallel-is-monotonic', async () => {
  const { batchFraction } = await import('./progress.js');
  const ready = 4;
  let done = 0, last = -1;
  // four games in flight, finishing one at a time while a fresh one starts
  const stages = [['load', 0.05], ['romfs', 0.3], ['romfs', 0.65], ['art', 0.8], ['cia', 0.9]];
  const running = [[0, 'load', 0.05], [1, 'load', 0.05], [2, 'load', 0.05], [3, 'load', 0.05]];
  for (let step = 0; step < stages.length; step++) {
    for (const r of running) { r[1] = stages[step][0]; r[2] = stages[step][1]; }
    const f = batchFraction({ ready, done, running: running.map(([, s2, x]) => ({ step: s2, frac: x })) });
    if (f < last) throw new Error(`went backwards at step ${step}: ${f} < ${last}`);
    last = f;
  }
  if (last > 0.99) throw new Error('overshot 99%');
  // each finished game frees a slot: done+1 while the replacement starts at 0
  const before = batchFraction({ ready, done: 3, running: [{ step: 'cia', frac: 1 }] });
  const after = batchFraction({ ready, done: 4, running: [] });
  if (after < before) throw new Error(`finish went backwards: ${after} < ${before}`);
});

await t('batch/pool-size-memory-first', async () => {
  const { poolSize } = await import('./batch.js');
  const eq = (got, want, tag) => { if (got !== want) throw new Error(`${tag}: ${got} != ${want}`); };
  eq(poolSize({ ready: 9, cores: 8 }), 4, 'capped at 4');
  eq(poolSize({ ready: 2, cores: 8 }), 2, 'never more than games');
  eq(poolSize({ ready: 9, cores: 2 }), 1, 'one spare core -> 1');
  eq(poolSize({ ready: 9, cores: 8, memory: 4 }), 1, '4GB device -> 1');
  eq(poolSize({ ready: 9, cores: 8, mobile: true }), 1, 'mobile without memory -> 1');
  eq(poolSize({ ready: 9, cores: 8, mobile: true, memory: 8 }), 4, 'mobile that reports 8GB keeps its cores');
  eq(poolSize({}), 1, 'unknown device -> 1');
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

// ── #125/#175 web analytics contract (pure, DOM-free) ─────────────────────
// Only these five events may leave the page. The test pins names, property
// keys and the values; a zip file name must always collapse to 'unknown' and
// the batch size and failure reason stay inside the existing property values.
await t('analytics/event-payloads', async () => {
  const { startEvent, doneEvent, failEvent, saveEvent, submitEvent } = await import('./analytics.js');
  const same = (got, want, tag) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error(`${tag}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  };
  same(startEvent('cia'), { name: 'convert_start', data: { mode: 'cia' } }, 'cia');
  same(startEvent('pack'), { name: 'convert_start', data: { mode: 'pack' } }, 'pack');
  same(startEvent('launcher'), { name: 'convert_start', data: { mode: 'launcher' } }, 'launcher');
  same(startEvent('pack', true, 2), { name: 'convert_start', data: { mode: 'batch:2' } }, 'batch 2');
  same(startEvent('pack', true, 5), { name: 'convert_start', data: { mode: 'batch:3-5' } }, 'batch 5');
  same(startEvent('pack', true, 6), { name: 'convert_start', data: { mode: 'batch:6+' } }, 'batch 6');
  same(startEvent('bogus'), { name: 'convert_start', data: { mode: 'cia' } }, 'unknown mode');
  same(doneEvent('kof98h'), { name: 'convert_done', data: { game: 'kof98h' } }, 'done');
  same(failEvent('kof98h', 'romfs'), { name: 'convert_fail', data: { game: 'kof98h', stage: 'romfs' } }, 'fail');
  same(failEvent('kof98h', 'load', 'bios'), { name: 'convert_fail', data: { game: 'kof98h', stage: 'load/bios' } }, 'reason');
  same(failEvent('kof98h', 'romfs', 'oom'), { name: 'convert_fail', data: { game: 'kof98h', stage: 'romfs/oom' } }, 'oom');
  same(failEvent('kof98h', null, 'crash'), { name: 'convert_fail', data: { game: 'kof98h', stage: 'worker/crash' } }, 'crash');
  same(failEvent('kof98h', null), { name: 'convert_fail', data: { game: 'kof98h', stage: 'worker' } }, 'no stage');
  same(failEvent('kof98h', 'weird'), { name: 'convert_fail', data: { game: 'kof98h', stage: 'worker' } }, 'bad stage');
  same(failEvent('kof98h', 'load', 'not-a-code'), { name: 'convert_fail', data: { game: 'kof98h', stage: 'load' } }, 'bad reason');
  same(saveEvent('pack'), { name: 'convert_save', data: { mode: 'pack' } }, 'save pack');
  same(saveEvent('batch'), { name: 'convert_save', data: { mode: 'batch' } }, 'save batch');
  same(saveEvent('nonsense'), { name: 'convert_save', data: { mode: 'cia' } }, 'save fallback');
  same(submitEvent(), { name: 'feedback_submit', data: {} }, 'feedback submit');
});

await t('analytics/game-name-never-is-a-zip-file', async () => {
  const { gameSet } = await import('./analytics.js');
  for (const value of ['kof98h', 'mslug', 's1945p', 'a'.repeat(40), 'kof98_h']) {
    if (gameSet(value) !== value) throw new Error(`rejected catalog name ${value}`);
  }
  for (const value of ['KOF98H', 'kof98h.zip', 'KOF98H.ZIP', 'kof 98', 'kof-98', 'a'.repeat(41),
    '../kof98h', 'kof98h\n', '', null, undefined, 98]) {
    if (gameSet(value) !== 'unknown') throw new Error(`leaked ${JSON.stringify(value)}`);
  }
});

// ── #188/#189 anonymous report payload (pure) ─────────────────────────────
// A zip file name is download-only: it must never appear in the payload, in
// the log, or in an error message. Catalog names survive untouched.
await t('report/zip-names-never-leave-the-tab', async () => {
  const { buildReport } = await import('./report.js');
  const report = buildReport({
    type: 'convert-fail',
    summary: 'converted but hangs',
    log: '  1.2s #1 KOF98.ZIP [1/4] load\n  2.0s #1 kof98.zip ✗ bios\n  neogeo.zip ok\n  kof98h ok',
    error: 'kof98.zip: banner failed',
    sources: [{ name: 'KOF98.ZIP', set: 'kof98h' }],
  });
  for (const text of [report.log, report.error]) {
    if (/kof98\.zip/i.test(text)) throw new Error(`zip name leaked: ${text}`);
    if (/kof98hh/.test(text)) throw new Error(`double substitution: ${text}`);
  }
  if (!report.log.includes('kof98h')) throw new Error('catalog name lost: ' + report.log);
  if (report.log.includes('neogeo.zip')) throw new Error('BIOS zip name leaked: ' + report.log);
  if (!report.log.includes('BIOS')) throw new Error('BIOS marker lost: ' + report.log);
});

await t('report/batch-rows-keep-their-own-reason', async () => {
  const { buildReport, failuresFrom } = await import('./report.js');
  const rows = [
    { status: 'failed', title: 'A' },
    { status: 'done', title: 'B' },
    { status: 'failed', title: 'C' },
    { status: 'failed', title: 'D' },
  ];
  const sources = [
    { name: 'a.zip', set: 'mslug' },
    { name: 'b.zip', set: 'kof98h' },
    { name: 'c.zip', set: 'svc' },
    { name: 'd.zip', set: null },
  ];
  const info = new Map([
    [0, { code: 'bios', stage: 'load' }],
    [2, { code: 'oom', stage: 'romfs' }],
    [3, { code: 'crash', stage: 'worker' }],
  ]);
  const report = buildReport({
    type: 'convert-fail', summary: 'x',
    failures: failuresFrom(rows, sources, info),
  });
  const got = report.failures.map((f) => `${f.set ?? '-'}:${f.code ?? '-'}:${f.stage ?? '-'}`);
  const want = ['mslug:bios:load', 'svc:oom:romfs', '-:crash:worker'];
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(JSON.stringify(got));
  if (report.failures.some((f) => f.title === 'B')) throw new Error('done row leaked');
});

await t('report/version-falls-back-to-unknown', async () => {
  const { buildReport } = await import('./report.js');
  const report = buildReport({ type: 'other', summary: 'x' });
  if (report.version !== 'unknown') throw new Error('version ' + report.version);
});

await t('report/failure-rows-are-sanitized', async () => {
  const { buildReport } = await import('./report.js');
  const report = buildReport({
    type: 'convert-fail',
    summary: 'x',
    failures: [
      { set: 'kof98h', title: "KOF '98", code: 'bios', stage: 'load', name: 'kof98.zip' },
      { set: 'KOF98H', title: '', code: 'bad code', stage: 'load' },
      { name: 'only-zip.zip' },
    ],
  });
  if (report.failures.length !== 1) throw new Error('rows: ' + JSON.stringify(report.failures));
  const row = report.failures[0];
  if (row.set !== 'kof98h' || row.code !== 'bios' || row.stage !== 'load') throw new Error(JSON.stringify(row));
  if (JSON.stringify(report).includes('only-zip.zip')) throw new Error('zip name leaked');
});

await t('report/log-tail-is-bounded', async () => {
  const { buildReport, MAX_LOG_LINES } = await import('./report.js');
  const log = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const report = buildReport({ type: 'site-bug', summary: 'x', log });
  const lines = report.log.split('\n');
  if (lines.length !== MAX_LOG_LINES) throw new Error('lines ' + lines.length);
  if (lines.at(-1) !== 'line 499') throw new Error('tail lost');
});

await t('report/payload-fits-the-worker-cap', async () => {
  const { buildReport, fitPayload, payloadBytes } = await import('./report.js');
  const log = Array.from({ length: 200 }, (_, i) => `${i} `.padEnd(400, 'x')).join('\n');
  const fitted = fitPayload(buildReport({ type: 'convert-fail', summary: 'x', log }));
  const bytes = payloadBytes(fitted);
  if (bytes > 64 * 1024) throw new Error('still ' + bytes);
  if (fitted.log.split('\n').at(-1).trim() === '') throw new Error('tail dropped the newest line');
});

// ── #202 BIOS profile in the report payload ──────────────────────────────
await t('report/bios-profile-survives', async () => {
  const { buildReport } = await import('./report.js');
  const bios = {
    present: true, error: null,
    aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }],
    mvs: [{ name: 'sp-s2.sp1', region: 'Europe/Asia' }],
    sfix: 'missing', lo: 'ok',
  };
  const got = buildReport({ type: 'convert-fail', summary: 'x', bios }).bios;
  if (JSON.stringify(got) !== JSON.stringify(bios)) throw new Error(JSON.stringify(got));
});

await t('report/bios-profile-drops-unknown-names-and-states', async () => {
  const { buildReport } = await import('./report.js');
  const report = buildReport({
    type: 'convert-fail', summary: 'x',
    bios: {
      present: true, error: null,
      aes: [{ name: 'kof98.zip', region: '<script>' }, { name: 'neo-epo.bin', region: 'Europe/Asia' }],
      mvs: Array.from({ length: 20 }, () => ({ name: 'sp-s2.sp1', region: 'Europe/Asia' })),
      sfix: 'weird', lo: 'missing', secret: 'drop me',
    },
  });
  const text = JSON.stringify(report);
  if (text.includes('kof98.zip') || text.includes('<script>') || text.includes('drop me'))
    throw new Error('unknown data leaked: ' + text);
  if (report.bios.aes.length !== 1 || report.bios.aes[0].name !== 'neo-epo.bin')
    throw new Error('aes: ' + JSON.stringify(report.bios.aes));
  if (report.bios.mvs.length !== 12) throw new Error('cap: ' + report.bios.mvs.length);
  if (report.bios.sfix !== 'missing') throw new Error('state: ' + report.bios.sfix);
});

await t('report/bios-classification-fields-survive', async () => {
  const { buildReport } = await import('./report.js');
  const bios = {
    present: true, error: null,
    aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }],
    mvs: [],
    mismatch: [{ name: 'sp-s.sp1', region: 'Europe/Asia' }],
    sfix: 'mismatch', lo: 'missing', unknown: 2, unibios: true,
  };
  const got = buildReport({ type: 'convert-fail', summary: 'x', bios }).bios;
  if (JSON.stringify(got) !== JSON.stringify(bios)) throw new Error(JSON.stringify(got));
});

await t('report/bios-not-dropped-and-unreadable', async () => {
  const { buildReport } = await import('./report.js');
  const none = buildReport({ type: 'convert-fail', summary: 'x', bios: { present: false, extra: 1 } }).bios;
  if (JSON.stringify(none) !== JSON.stringify({ present: false })) throw new Error(JSON.stringify(none));
  const bad = buildReport({ type: 'convert-fail', summary: 'x', bios: { present: true, error: 'zip', aes: [{ name: 'neo-epo.bin', region: 'Europe/Asia' }] } }).bios;
  if (JSON.stringify(bad) !== JSON.stringify({ present: true, error: 'zip' })) throw new Error(JSON.stringify(bad));
});

await t('report/bios-profile-keeps-every-gamedb-chip-name', async () => {
  const { GameDb } = await import('./gamedb.js');
  const { buildReport } = await import('./report.js');
  const aes = GameDb.BIOS.map((f) => ({ name: f.name, region: 'Europe/Asia' }));
  const report = buildReport({
    type: 'convert-fail', summary: 'x',
    bios: { present: true, error: null, aes, mvs: [], sfix: 'ok', lo: 'ok' },
  });
  if (report.bios.aes.length !== GameDb.BIOS.length)
    throw new Error(`${report.bios.aes.length}/${GameDb.BIOS.length}`);
});

process.exit(fail ? 1 : 0);
