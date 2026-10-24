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

// The romset named like the zip when supported and complete; otherwise a
// supported clone whose chips the zips hold (CiaBuilder.cs:65-81).
// `lang` picks the reason text (C# Lang.L): a KO page gets KO reasons (#79).
// Options keep the C# `set` argument and the page language distinct.
export async function pickGame(db, RomSetCls, files, name, { set = null, lang = 'en' } = {}) {
  const exact = db.find(set ?? name);
  if (!exact) return { game: null, problem: L(lang,
    `'${name}'은(는) MAME 네오지오 롬셋 이름이 아닙니다. MAME 롬셋 zip만 지원합니다. zip 파일 이름을 바꾸지 마세요.`,
    `'${name}' is not a MAME Neo Geo romset name. Only MAME romset zips are supported; keep the zip's original file name.`) };
  let problem = null;
  const cands = set != null ? [exact] : [exact, ...db.clonesOf(exact.name)];
  for (const g of cands) {
    const why = db.unsupported(g, lang);
    if (why != null) { problem ??= `${db.title(exact)}: ${why}`; continue; }
    // Index-only open (#121): the browser reads the zip tail + central directory,
    // so judging a romset no longer inflates its chips.
    const zips = await RomSetCls.open(zipsFor(g, files, name));
    const missing = zips.missing(g);
    if (missing.length === 0) return { game: g, problem: null, romset: zips };
    if (g === exact || problem == null)
      problem = `${g.name}: ` + L(lang, '롬 파일이 빠졌습니다', 'ROM files are missing') +
        ` (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' ...' : ''})`;
  }
  return { game: null, problem, romset: null };
}

export function productCode(romName) {
  return ('NEO3DS-' + romName.toUpperCase()).slice(0, 16);
}
