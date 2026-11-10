// User-facing failure text (#326). Pure: no DOM, no Worker, no network, so the
// page and Node tests share one wording table. Every code returns the cause in
// one sentence and the next action in a second sentence, in plain adult
// language — a technical exception message stays in the log/report instead.
//
// Only a public catalog romset name may appear here. A user's dropped zip file
// name (case, extension, spaces) or a path collapses to 'game', the same rule
// analytics.gameSet and report.redactions already enforce. (#125, #326)

const SET_NAME = /^[a-z0-9_]{1,40}$/;

export function catalogName(value) {
  return typeof value === 'string' && SET_NAME.test(value) ? value : 'game';
}

// Every code the worker, analytics and report contracts may deliver. The list
// is pinned by conv.test.mjs so a new worker code cannot ship without words.
export const MESSAGE_CODES = Object.freeze([
  'nofile', 'bios', 'notromset', 'missing', 'unsupported', 'zip', 'image',
  'oom', 'wasm', 'crash', 'unknown',
  'zip-corrupt', 'crc-mismatch', 'bios-read', 'game-db',
]);

const KO = {
  nofile: () => '게임 zip을 찾지 못했어요. 게임 zip과 neogeo.zip을 함께 올려 주세요.',
  bios: () => 'neogeo.zip(바이오스)이 없어요. neogeo.zip을 게임 zip과 함께 올려 주세요.',
  notromset: () => '이 zip 이름은 MAME 네오지오 롬셋이 아니에요. zip 파일 이름을 원래대로 두고 다시 올려 주세요.',
  missing: (n) => `${n}에 필요한 롬 파일이 빠져 있어요. 같은 버전의 롬셋 zip을 모두 올려 주세요.`,
  unsupported: (n) => `${n}은(는) 이 변환기가 지원하지 않는 카트리지예요. 지원 목록에 있는 다른 게임을 골라 주세요.`,
  zip: (n) => `${n} zip을 읽지 못했어요. zip이 손상되지 않았는지 확인하고 다시 올려 주세요.`,
  image: () => '아이콘·배너 이미지를 읽지 못했어요. 다른 PNG나 JPG로 다시 지정해 주세요.',
  oom: () => '브라우저 메모리가 부족해요. 다른 탭을 닫고 다시 시도해 주세요.',
  wasm: () => '변환 도구가 중간에 멈췄어요. 새로고침한 뒤 다시 시도해 주세요.',
  crash: () => '변환 작업이 예기치 않게 끝났어요. 다시 시도하고, 계속되면 제보해 주세요.',
  unknown: () => '확실한 원인을 찾지 못했어요. 다시 시도해 보고, 계속되면 제보해 주세요.',
  'zip-corrupt': (n) => `${n} zip 안의 항목이 손상됐어요. 다른 롬셋 zip으로 다시 올려 주세요.`,
  'crc-mismatch': (n) => `${n}이(가) 기대한 버전과 달라요. MAME 롬셋 zip 원본으로 다시 올려 주세요.`,
  'bios-read': () => 'neogeo.zip에서 필요한 바이오스 칩을 찾지 못했어요. neogeo.zip을 게임 zip과 함께 다시 올려 주세요.',
  'game-db': (n) => `${n} 그래픽을 처리하는 중 문제가 생겼어요. 다시 시도하고, 계속되면 제보해 주세요.`,
};

const EN = {
  nofile: () => 'No game zip was found. Drop the game zip together with neogeo.zip.',
  bios: () => 'neogeo.zip (the BIOS) is missing. Drop it together with the game zip.',
  notromset: () => 'This zip name is not a MAME Neo Geo romset. Keep the zip file name as it was and drop it again.',
  missing: (n) => `${n} is missing required ROM files. Drop every zip of the same romset version.`,
  unsupported: (n) => `${n} uses a cartridge this converter does not support. Pick another game from the supported list.`,
  zip: (n) => `The ${n} zip could not be read. Check that the zip is not damaged and drop it again.`,
  image: () => 'The icon or banner image could not be read. Pick another PNG or JPG.',
  oom: () => 'The browser ran out of memory. Close other tabs and try again.',
  wasm: () => 'A conversion tool stopped in the middle. Reload the page and try again.',
  crash: () => 'The conversion stopped unexpectedly. Try again; if it keeps happening, send a report.',
  unknown: () => 'The exact cause could not be found. Try again; if it keeps happening, send a report.',
  'zip-corrupt': (n) => `An entry inside the ${n} zip is damaged. Drop a different romset zip.`,
  'crc-mismatch': (n) => `${n} is a different version than expected. Drop the original MAME romset zip.`,
  'bios-read': () => 'neogeo.zip is missing a required BIOS chip. Drop neogeo.zip again with the game zip.',
  'game-db': (n) => `Something went wrong while processing ${n} graphics. Try again; if it keeps happening, send a report.`,
};

const TABLES = Object.freeze({ ko: KO, en: EN });

// `lang` is the page language ('ko' | 'en'); anything else reads as Korean.
// `set` is the public catalog romset name, never the user's file name.
export function failureMessage(code, { set = null, lang = 'ko' } = {}) {
  const table = TABLES[lang === 'en' ? 'en' : 'ko'];
  const text = table[code] ?? table.unknown;
  return text(catalogName(set));
}
