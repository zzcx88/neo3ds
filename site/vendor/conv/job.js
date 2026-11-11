// CiaJob selection port (converter/Neo3dsConverter.Core/CiaBuilder.cs:10-101).
// RomName/TitleId/PickGame. Zip paths become in-memory file lists in the browser.
import { L } from './lang.js';

export function crc32Bytes(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

export function crc32Ascii(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0x7F;
  return crc32Bytes(b);
}

export function uniqueId(romName) {
  return (0xC0000 | (crc32Ascii(romName) & 0xFFFF)) >>> 0;
}

export function titleId(romName) {
  return '00040000' + ((uniqueId(romName) << 8) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

// Zips a romset's chips may come from: the dropped zips whose names match
// (zipName, game name, parent name) — mirrors CiaJob.ZipsFor.
export function zipsFor(g, files, zipName) {
  const want = new Set([zipName + '.zip', g.name + '.zip']);
  if (g.parent) want.add(g.parent.toLowerCase() + '.zip');
  return files.filter((f) => want.has(f.name.toLowerCase()));
}

// The parent romset a reader should also drop: only when a chip the game needs
// is a load op of that parent (a clone's split set) (#339).
function parentHint(db, g, missing, mismatch) {
  if (!g.parent) return null;
  const parent = db.find(g.parent);
  if (!parent) return null;
  const names = new Set([...missing, ...mismatch]);
  for (const r of parent.regions) {
    for (const o of r.ops) {
      if (o.kind === 'load' && names.has(o.file)) return parent.name;
    }
  }
  return null;
}

// Log/report text keeps the C# CiaBuilder shape; the page shows the plain
// message from messages.js instead (#327, #339).
function failureProblem(lang, g, missing, mismatch) {
  const names = [...mismatch, ...missing];
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ' ...' : '');
  return `${g.name}: ` + L(lang,
    mismatch.length > 0 ? '롬 파일 버전이 다릅니다' : '롬 파일이 빠졌습니다',
    mismatch.length > 0 ? 'ROM files are a different version' : 'ROM files are missing') + ` (${shown})`;
}

// The romset named like the zip when supported and complete; otherwise a
// supported clone whose chips the zips hold (CiaBuilder.cs:65-81).
// `lang` picks the reason text (C# Lang.L): a KO page gets KO reasons (#79).
// Options keep the C# `set` argument and the page language distinct.
export async function pickGame(db, RomSetCls, files, name, { set = null, lang = 'en' } = {}) {
  const exact = db.find(set ?? name);
  if (!exact) return {
    game: null, code: 'notromset', problem: L(lang,
      `'${name}'은(는) MAME 네오지오 롬셋 이름이 아닙니다. MAME 롬셋 zip만 지원합니다. zip 파일 이름을 바꾸지 마세요.`,
      `'${name}' is not a MAME Neo Geo romset name. Only MAME romset zips are supported; keep the zip's original file name.`),
    missing: [], mismatch: [], parent: null, versionMismatch: false, romset: null,
  };
  // #339: the detail must belong to the same candidate as code/problem. The
  // exact record is judged first, so a later clone cannot overwrite it.
  let found = null;
  const cands = set != null ? [exact] : [exact, ...db.clonesOf(exact.name)];
  for (const g of cands) {
    const why = db.unsupported(g, lang);
    if (why != null) {
      found ??= {
        code: 'unsupported', problem: `${db.title(exact)}: ${why}`,
        missing: [], mismatch: [], parent: null, versionMismatch: false,
      };
      continue;
    }
    // Index-only open (#121): the browser reads the zip tail + central directory,
    // so judging a romset no longer inflates its chips.
    const zips = await RomSetCls.open(zipsFor(g, files, name));
    const { missing, mismatch } = zips.missingDetail(g);
    if (missing.length === 0 && mismatch.length === 0) return {
      game: g, code: null, problem: null, romset: zips,
      missing: [], mismatch: [], parent: null, versionMismatch: false,
    };
    if (g === exact || found == null) {
      const versionMismatch = mismatch.length > 0;
      found = {
        code: versionMismatch ? 'crc-mismatch' : 'missing',
        problem: failureProblem(lang, g, missing, mismatch),
        missing, mismatch,
        parent: parentHint(db, g, missing, mismatch),
        versionMismatch,
      };
    }
  }
  return {
    game: null, code: found?.code ?? 'unknown', problem: found?.problem ?? null,
    missing: found?.missing ?? [], mismatch: found?.mismatch ?? [],
    parent: found?.parent ?? null, versionMismatch: found?.versionMismatch ?? false,
    romset: null,
  };
}

export function productCode(romName) {
  return ('NEO3DS-' + romName.toUpperCase()).slice(0, 16);
}
