// Anonymous report payload (#188/#189). Pure: no DOM, no network, so Node
// tests pin what leaves the tab. The page collects the run state, this module
// redacts it and keeps it under the worker's 64KB cap.
//
// A user's zip file name is download-only: it must never reach the worker.
// Every dropped zip name is swapped for its public catalog romset name (or
// 'game') before the log and error text are attached.

export const REPORT_TYPES = Object.freeze({
  'convert-fail': '변환 실패',
  'site-bug': '사이트·변환기 버그',
  'feature': '기능 제안',
  'other': '기타',
});

export const MAX_LOG_LINES = 200;
// sessionStorage key: the converter page hands its failed run to the landing form.
export const PENDING_KEY = 'neo3ds:report';
export const MAX_PAYLOAD_BYTES = 64 * 1024;

const SET_NAME = /^[a-z0-9_]{1,40}$/;
const CODE = /^[a-z]{1,16}$/;
const STAGE = /^[a-z]{1,16}$/;
const MODES = new Set(['cia', 'pack', 'launcher']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Last `max` lines of the converter log, newline-normalised, no trailing blank.
export function tailLines(text, max = MAX_LOG_LINES) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-max).join('\n');
}

// name (zip, page-side) → replacement, for every dropped zip except the BIOS.
export function redactions(sources = []) {
  // The BIOS zip has one public name shared by every visitor, and preflight
  // strips it from the rows: seed it here so its name never reaches the issue.
  const map = new Map([['neogeo.zip', 'BIOS']]);
  for (const source of sources) {
    const name = String(source?.name ?? '');
    if (!name) continue;
    // The BIOS zip has one public name shared by every visitor: keep the fact
    // that it was involved, without carrying a file name into a public issue.
    if (name.toLowerCase() === 'neogeo.zip') { map.set('neogeo.zip', 'BIOS'); continue; }
    const to = SET_NAME.test(source?.set ?? '') ? source.set : 'game';
    map.set(name.toLowerCase(), to);
    const stem = name.replace(/\.zip$/i, '');
    if (stem && stem !== name) map.set(stem.toLowerCase(), to);
  }
  return map;
}

// One pass, longest match first: replacing 'kof98' after 'kof98h' was already
// substituted would double it ('kof98hh'). Boundaries keep a shorter stem from
// eating a longer catalog name.
export function redact(text, map) {
  const source = String(text ?? '');
  if (!map?.size) return source;
  const names = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const pattern = new RegExp(`(?<![a-z0-9_])(?:${names.join('|')})(?![a-z0-9_])`, 'gi');
  return source.replace(pattern, (hit) => map.get(hit.toLowerCase()) ?? hit);
}

function cleanFailure(input) {
  if (!input || typeof input !== 'object') return null;
  const row = {
    set: SET_NAME.test(input.set ?? '') ? input.set : null,
    title: String(input.title ?? '').slice(0, 120) || null,
    code: CODE.test(input.code ?? '') ? input.code : null,
    stage: STAGE.test(input.stage ?? '') ? input.stage : null,
  };
  return row.set || row.title ? row : null;
}

export function buildReport(input = {}) {
  const type = Object.hasOwn(REPORT_TYPES, input.type) ? input.type : 'other';
  const map = redactions(input.sources);
  const failures = Array.isArray(input.failures)
    ? input.failures.slice(0, 50).map(cleanFailure).filter(Boolean)
    : [];
  return {
    type,
    summary: String(input.summary ?? '').trim().slice(0, 4000),
    game: String(input.game ?? '').trim().slice(0, 80) || null,
    mode: MODES.has(input.mode) ? input.mode : null,
    version: input.version ? String(input.version).slice(0, 32) : 'unknown',
    failures,
    log: redact(tailLines(input.log), map),
    error: redact(String(input.error ?? '').slice(0, 2000), map) || null,
    website: String(input.website ?? ''),
  };
}

// Batch rows carry per-game failure state; keep each row's own code and stage
// next to its catalog name instead of reading whatever the last worker said.
export function failuresFrom(rows = [], sources = [], info = new Map()) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    if (row?.status !== 'failed') return;
    out.push({
      set: sources?.[i]?.set ?? null,
      title: sources?.[i]?.title ?? row.title ?? null,
      code: info.get(i)?.code ?? null,
      stage: info.get(i)?.stage ?? null,
    });
  });
  return out;
}

export function payloadBytes(report) {
  return new TextEncoder().encode(JSON.stringify(report)).length;
}

// Trim the log (oldest lines first), then the failure rows, until the payload
// fits the worker cap. The worker rejects anything larger with a 413.
export function fitPayload(report, max = MAX_PAYLOAD_BYTES) {
  let out = report;
  while (payloadBytes(out) > max && out.log) {
    const lines = out.log.split('\n');
    out = { ...out, log: lines.slice(Math.ceil(lines.length / 2)).join('\n') };
  }
  if (payloadBytes(out) > max && out.failures.length > 10) {
    out = { ...out, failures: out.failures.slice(0, 10) };
  }
  if (payloadBytes(out) > max) out = { ...out, error: null };
  return out;
}
