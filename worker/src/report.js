// Anonymous web report (#188): validation and GitHub issue rendering.
// Pure — no fetch, no KV, no clock — so Node tests pin the exact issue we file.
// The worker's fetch handler (index.js) owns transport, origin and rate limit.

export const MAX_BODY_BYTES = 64 * 1024;

// Report categories shown on the site. The label is the issue-title prefix.
export const TYPES = Object.freeze({
  'convert-fail': '변환 실패',
  'site-bug': '사이트·변환기 버그',
  'feature': '기능 제안',
  'other': '기타',
});

// Mirrors analytics.js: only a public catalog romset name may leave the tab.
const SET_NAME = /^[a-z0-9_]{1,40}$/;
const CODE = /^[a-z]{1,16}$/;
const STAGE = /^[a-z]{1,16}$/;
const MODES = new Set(['cia', 'pack', 'launcher']);
// Mirrors GameDb.BIOS (site/vendor/conv/gamedb.js): a public issue may carry
// only these chip names and the three region labels.
const BIOS_NAMES = new Set([
  'neo-epo.bin', 'neo-po.bin', 'sp-s2.sp1', 'sp-s.sp1', 'asia-s3.rom', 'sp-45.sp1',
  'vs-bios.rom', 'sp-j2.sp1', 'sp1.jipan.1024', 'usa_2slt.bin', 'sp-e.sp1',
]);
const BIOS_REGION = /^(Europe\/Asia|Japan|USA)$/;
const BIOS_STATES = new Set(['ok', 'missing', 'mismatch']);

const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function failure(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = {
    set: typeof input.set === 'string' && SET_NAME.test(input.set) ? input.set : null,
    title: str(input.title, 120) || null,
    code: typeof input.code === 'string' && CODE.test(input.code) ? input.code : null,
    stage: typeof input.stage === 'string' && STAGE.test(input.stage) ? input.stage : null,
  };
  // A row with neither a catalog name nor a display title says nothing.
  return row.set || row.title ? row : null;
}

// #202: BIOS profile from the page. Extra fields are dropped; only known
// slots, region labels and the two states leave this function.
function bios(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (input.present !== true) return { present: false };
  if (input.error === 'zip') return { present: true, error: 'zip' };
  const chips = (list) => (Array.isArray(list) ? list : [])
    .slice(0, 12)
    .map((c) => {
      const name = typeof c?.name === 'string' ? c.name : '';
      const region = typeof c?.region === 'string' ? c.region : '';
      return BIOS_NAMES.has(name) && BIOS_REGION.test(region) ? { name, region } : null;
    })
    .filter(Boolean);
  return {
    present: true,
    error: null,
    aes: chips(input.aes),
    mvs: chips(input.mvs),
    ...(Array.isArray(input.mismatch) ? { mismatch: chips(input.mismatch) } : {}),
    sfix: BIOS_STATES.has(input.sfix) ? input.sfix : 'missing',
    lo: BIOS_STATES.has(input.lo) ? input.lo : 'missing',
    ...(Number.isInteger(input.unknown) && input.unknown >= 0
      ? { unknown: Math.min(input.unknown, 9999) } : {}),
    ...(typeof input.unibios === 'boolean' ? { unibios: input.unibios } : {}),
  };
}

// Returns { ok: true, report } or { ok: false, error } with a short, stable code.
// Extra fields are dropped: the issue only ever shows the shape below.
export function validateReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'body' };
  if (!Object.hasOwn(TYPES, input.type)) return { ok: false, error: 'type' };
  const summary = str(input.summary, 4000).trim();
  if (!summary) return { ok: false, error: 'summary' };
  const failures = Array.isArray(input.failures)
    ? input.failures.slice(0, 50).map(failure).filter(Boolean)
    : [];
  return {
    ok: true,
    report: {
      type: input.type,
      summary,
      game: str(input.game, 80).trim() || null,
      mode: MODES.has(input.mode) ? input.mode : null,
      version: str(input.version, 32) || null,
      failures,
      bios: bios(input.bios),
      // Keep the newest lines: the issue section promises the tail, and GitHub
      // caps an issue body at 64KB.
      log: typeof input.log === 'string' ? input.log.slice(-40000) : '',
      error: str(input.error, 2000) || null,
    },
  };
}

export function issueTitle(report) {
  const tail = oneLine(report.summary).slice(0, 60);
  return `[제보] ${TYPES[report.type]}: ${tail}`;
}

// Report text is user input: a stray ~~~ would close the log fence early.
const fence = (value) => String(value ?? '').replace(/~~~/g, '~ ~ ~');

function failureTable(rows) {
  const head = ['| romset | code | stage | title |', '| --- | --- | --- | --- |'];
  const body = rows.map((row) =>
    `| ${row.set ?? '-'} | ${row.code ?? '-'} | ${row.stage ?? '-'} | ${oneLine(row.title) || '-'} |`);
  return [...head, ...body].join('\n');
}

function biosTable(b) {
  const cell = (list) => (list ?? []).map((c) => `${c.name} (${c.region})`).join(', ') || '-';
  const rows = [
    '| 항목 | 상태 |',
    '| --- | --- |',
    `| AES | ${cell(b.aes)} |`,
    `| MVS | ${cell(b.mvs)} |`,
  ];
  if (b.mismatch?.length) rows.push(`| mismatch | ${cell(b.mismatch)} |`);
  rows.push(`| sfix.sfix | ${b.sfix} |`, `| 000-lo.lo | ${b.lo} |`);
  if (b.unknown > 0) rows.push(`| unknown entries | ${b.unknown} |`);
  if (b.unibios) rows.push('| UniBIOS | detected — unsupported |');
  return rows.join('\n');
}

// meta: { ua, origin, at } — the request header and clock, never stored by the worker.
export function issueBody(report, meta = {}) {
  const lines = [
    '익명 제보 — 사이트 제보 폼이 자동 생성했습니다.',
    '',
    `- 유형: ${TYPES[report.type]}`,
    `- 변환기 버전: ${report.version ?? '알 수 없음'}`,
    `- 모드: ${report.mode ?? '알 수 없음'}`,
  ];
  if (report.bios && !report.bios.present) lines.push('- BIOS: not dropped');
  else if (report.bios?.error === 'zip') lines.push('- BIOS: unreadable');
  lines.push(
    `- 게임(직접 입력): ${report.game ?? '-'}`,
    `- 보낸 페이지: ${meta.origin ?? '-'}`,
    `- 브라우저: ${meta.ua || '-'}`,
    `- 시각(UTC): ${meta.at ?? '-'}`,
    '',
    '## 증상',
    '',
    report.summary,
  );
  if (report.bios?.present && !report.bios.error) {
    lines.push('', '## BIOS (neogeo.zip)', '', biosTable(report.bios));
  }
  if (report.failures.length) {
    lines.push('', `## 실패한 게임 (${report.failures.length})`, '', failureTable(report.failures));
  }
  lines.push('', '## 로그 (마지막 200줄)', '', '~~~text', fence(report.log) || '(비어 있음)', '~~~');
  if (report.error) lines.push('', '## 오류', '', '~~~text', fence(report.error), '~~~');
  lines.push('', '_zip 파일명·롬 파일·아이콘 이미지는 전송되지 않습니다._');
  return lines.join('\n');
}
