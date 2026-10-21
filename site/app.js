/* neo3ds 소개 페이지 — 인터랙션.
   히어로는 실기 캡처 이미지(정적)이고, 움직이는 것은 GIF뿐입니다.
   화면에 나오는 수치는 실기 측정값과 engine/source/* 의 실제 상수에서 가져왔습니다. */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ══════════════════════════════════════════════════════════════════════
   1. 언어 (한국어가 기본, 브라우저 로케일로 자동 선택)
   ════════════════════════════════════════════════════════════════════ */
const EN = {
  'a11y.skip': 'Skip to content', 'a11y.sections': 'Sections', 'meta.desc': 'Converter + emulator engine turning Neo Geo (MAME) romsets into 3DS install files (CIA). 60fps on an Old 3DS, one HOME Menu icon per game.', 'meta.ogdesc': 'Drop a rom zip on the PC, get one CIA per game. Neo Geo emulator running at 60fps on the 3DS.',
  'nav.steps': 'Set-up in three steps', 'nav.panel': 'Touch controls', 'nav.convert': 'Conversion pipeline',
  'nav.speed': 'Speed', 'nav.games': 'Game compatibility',
  'cta.download': 'Get the converter', 'cta.source': 'Source code', 'lang.label': 'Language',
  'hero.kicker': 'romset zip on the PC → a 3DS install file (CIA) · converter + emulator engine',
  'hero.h1': 'Neo Geo games,<br>on the 3DS HOME menu.',
  'hero.lede': 'Drop the romset zip of a game you own on the converter and each game becomes one install file (CIA) — or pack several games for the one launcher app. Install it on the 3DS and the game shows up on the HOME menu with its own icon, at 60 fps even on an Old 3DS.',
  'hero.req': 'Windows 10/11 64-bit · no runtime to install · GPL-2.0',
  'steps.h2': 'Set-up in three steps',
  'steps.lede': 'Building an install file takes a minute or two on the PC. After that you only need the 3DS.',
  'steps.s1t': 'Get the romset ready',
  'steps.s1d': 'Keep your game\'s MAME romset and the BIOS together, names unchanged.',
  'steps.s2t': 'Build the CIA (or launcher files)',
  'steps.s2d': 'One game takes a minute or two, mostly compressing graphics. Drop several zips to convert them one after another, or build launcher files (.neo3ds) instead.',
  'steps.s3t': 'Install on the 3DS (or copy to the launcher)',
  'steps.s3d': 'A CIA shows up on the HOME menu. Launcher files go on the SD card at /neo3ds/games/ and start from the launcher app.',
  'prep.h3': 'What you need',
  'prep.1b': 'A 3DS', 'prep.1d': 'Old 3DS / 2DS / New 3DS / New 2DS XL, with custom firmware (Luma3DS) and an installer (FBI)',
  'prep.2b': 'A Windows PC', 'prep.2d': 'Windows 10/11 64-bit · no runtime to install · unzips to one neo3ds-converter folder (exe, tools, launcher CIA)',
  'prep.3b': 'Romsets you own', 'prep.3d': 'MAME romset zip + neogeo.zip (not included here)',
  'prep.4b': 'The sound file', 'prep.4d': '<code>/3ds/dspfirm.cdc</code> on the SD card',
  'panel.h2': 'Touch controls',
  'panel.lede': 'Everything works while the game keeps running, and settings are saved per game. Choose one CIA per game or the single launcher app.',
  'dev.keyconfig': 'Key config', 'dev.diag': 'Diagnostics', 'dev.restart': 'Restart',
  'panel.r1': 'Map each button to a Neo Geo button or a two-button press.',
  'panel.r2n': 'Turbo', 'panel.r2': 'Holds one button down 20 times a second. R + A/B/X/Y switches it.',
  'panel.r3n': 'System: AES / MVS', 'panel.r3': 'Switches home ↔ arcade BIOS. Two taps, so it cannot happen by accident.',
  'panel.r4': 'FPS, per-core time and memory, once a second.',
  'panel.r5': 'Hold to restart from the beginning; SELECT+START for a second does the same.',
  'panel.r6n': 'Service', 'panel.r6': 'Opens the arcade (MVS) settings menu. Backup RAM (settings, high scores) is kept on the SD card.',
  'panel.r7n': 'Slot / Save / Load', 'panel.r7': 'Save and load from three slots. SELECT+L saves, SELECT+R loads.',
  'panel.mapH3': 'Default mapping',
  'panel.map1k': 'D-pad', 'panel.map1': 'lever', 'panel.map2': 'Neo Geo A · B · C · D', 'panel.map3': 'coin · start',
  'panel.map4': 'turbo on/off', 'panel.map5': 'quick save / load',
  'panel.mapNote': 'In KOF, L = A+B (evade) and R = C+D (blowback) is a good start.',
  'conv.h2': 'Conversion pipeline',
  'conv.lede': 'All decryption happens on the PC. The 3DS spends no time and no memory on it.',
  'conv.p1t': 'Identify the romset', 'conv.p1d': 'The zip name selects a romset, then every chip is checked by CRC. Merged zips (kof98.zip → kof98h) are handled.',
  'conv.p2t': 'Decrypt', 'conv.p2d': 'CMC42, CMC50, SMA, PCM2, PVC and friends, undone on the PC.',
  'conv.p3t': 'Patch for hardware + region', 'conv.p3d': 'Protection checks are removed and the 68k byte order is fixed. Region is picked too (Europe/Asia, Japan or USA).',
  'conv.p4t': 'Compress graphics', 'conv.p4d': 'Sprites become 4KB zstd blocks; the 3DS unpacks them into an 8MB cache.',
  'conv.p5t': 'Make icon and banner', 'conv.p5d': 'Icon (48×48) and banner (256×128) drawn from the title.',
  'conv.p6t': 'Package the CIA (or launcher files)', 'conv.p6d': 'Engine and game data wrapped into an install file — or launcher files (.neo3ds) for the SD card.',
  'conv.run': 'Build CIA', 'conv.again': 'Again', 'conv.sets': 'Romsets', 'conv.logLabel': 'Converter log',
  'conv.logNote': 'Wording and layout match the real converter. Compression figures come from the KOF \'99 run we measured.',
  'speed.h2': 'Speed',
  'speed.lede': 'No GPU: the CPU draws the frame itself, and the work is split across both cores.',
  'speed.figCap': 'One frame is 16.7ms — read from the on-device diagnostics screen (KOF \'99, 59.8fps)',
  'speed.figNote': 'Press an item for details.',
  'speed.memH3': 'Memory layout',
  'speed.memP': 'Sprite ROMs stay compressed; only the blocks in use are unpacked.',
  'speed.kv1k': 'Compression', 'speed.kv1v': '4KB blocks · zstd 19 · KOF \'99 64.0 → 19.6MB',
  'speed.kv2k': 'Cache', 'speed.kv2v': '8MB (2,048 blocks of 4KB)',
  'speed.kv3k': 'In RAM', 'speed.kv3v': '51.8MB used · 2.0MB free',
  'speed.kv4k': 'Output', 'speed.kv4v': '304×224 only · three screens in rotation (triple buffered) · nothing reloads',
  'speed.modeH3': 'Memory mode choice',
  'speed.modeP': '80MB gives more memory, but the system is reloaded every time a game starts or quits.',
  'speed.mode64tag': '(neo3ds)', 'speed.mode80tag': '(not used)', 'speed.modeLabel': 'Memory mode',
  'speed.n1h': 'Speed optimisations',
  'speed.n1': 'Drawing and sound move to the second core while the main core emulates the next frame.',
  'speed.n2': 'Unzoomed sprites are drawn tile by tile, and opaque runs of 8 pixels go out as ARM assembly (raw CPU instructions).',
  'speed.n3': 'Games that zoom out a lot use code pre-built for every zoom step (16) and flip (2).',
  'speed.n4': 'Cache cleaning calls the system call directly (an SVC), so the second core never waits on a service.',
  'speed.n2h': 'Sound',
  'speed.s1': 'The YM2610 is split in two; the second core replays the logged register writes and makes the audio.',
  'speed.s2': 'The 3DS DSP is unused and sound is never dropped. Without <code>/3ds/dspfirm.cdc</code> the game runs silently.',
  'games.h2': 'Game compatibility',
  'games.lede': 'The converter knows 282 romsets and builds 242 of them. 15 of those were played on an Old 3DS (Aero Fighters 3 is playable).',
  'games.searchLabel': 'Search games', 'games.searchPh': 'Title or romset name (e.g. kof99, slug)',
  'games.fAll': 'All', 'games.fVerified': 'On hardware', 'games.fOk': 'Buildable', 'games.fNo': 'Not supported', 'games.filters': 'Filters',
  'games.sort': 'Sort', 'games.sortDefault': 'Hardware first', 'games.sortName': 'Title',
  'games.sortYear': 'Year', 'games.sortSize': 'ROM size',
  'games.more': 'Show more',
  'games.cavH3': 'Notes',
  'games.cav1': 'Some decryption is implemented but never played, because we lack the ROMs.',
  'games.cav1b': 'Games we could not check — CMC42: Sengoku 3, Zupapa, Strikers 1945 Plus, Prehistoric Isle 2, Nightmare in the Dark, Ganryu, Bang Bead · CMC50: KOF2001 · PCM2: Metal Slug 4, Rage of the Dragons, Pochi and Nyaa',
  'games.cav2': 'KOF \'98 does not convert: the MVS version has a protection chip. When the home set (kof98h) is in the zip it is picked automatically.',
  'games.cav3': 'When a romset is tight for memory, the converter warns you first.',
  'games.cav4': 'Metal Slug 2, X and 3 slow down in scenes with many enemies and explosions on the original arcade board too. neo3ds drops frames in exactly those scenes, as PC emulators do.',
  'faq.h2': 'Questions',
  'faq.q1': 'Where do I get the ROMs?', 'faq.a1': 'Nowhere. You need romsets for games you own, and a built CIA contains ROM data, so never share it.',
  'faq.q2': 'Is it really 60 fps on an Old 3DS?', 'faq.a2': 'KOF \'98, \'99, 2000, 2002, Metal Slug 1, X and 3, SVC Chaos and Samurai Shodown V Special ran at full speed on hardware. Metal Slug 2, X and 3 slow down exactly where the original board did; Aero Fighters 3 is playable.',
  'faq.q3': 'No sound.', 'faq.a3': 'The SD card needs <code>/3ds/dspfirm.cdc</code>; a tool like DSP1 creates it once.',
  'faq.q4': 'Where are key configs stored?', 'faq.a4': 'Per game, on the SD card: key config <code>/3ds/neo3ds/keys/</code>, backup RAM <code>/3ds/neo3ds/saves/</code>, quick saves <code>/3ds/neo3ds/states/</code>, launcher files <code>/neo3ds/games/</code>.',
  'faq.q5': 'What about a New 3DS?', 'faq.a5': 'The CIA asks for 804MHz and the L2 cache, which leaves more headroom (not confirmed on hardware yet).',
  'faq.q6': 'Can I use it commercially?', 'faq.a6': 'No: the included CPU cores (Cyclone 68000, DrZ80) allow non-commercial use only.',
  'faq.q7': 'Can I build it myself?', 'faq.a7': 'The engine needs devkitPro: <code>bash scripts/build_engine.sh</code>; the converter needs the .NET 10 SDK. See docs/build.md.',
  'legal.h2': 'Legal',
  'legal.p1': 'No ROMs, BIOS or game data are included here. Convert only games you own, and never distribute a CIA you build.',
  'legal.p2': 'neo3ds is a personal fan project, unaffiliated with SNK or Nintendo. NEOGEO is a trademark of SNK CORPORATION; Nintendo 3DS of Nintendo.',
  'legal.credH': 'Credits',
  'legal.cred2': 'the MAME team (romset data and cartridge decryption research)',
  'legal.lic': 'Source is GPL-2.0; bundled third-party code is listed in THIRD_PARTY_NOTICES.md.',
  'foot.repo': 'Repository', 'foot.rel': 'Releases', 'foot.readme': 'README',
  'foot.build': 'Build procedure', 'foot.lic': 'Licence',
  'foot.note': 'Game screens and trademarks belong to their owners.',
  /* convert.html — Phase 0 gate */
  'gate.meta': 'Pack a desktop converter RomFS folder into a CIA with WASM makerom·bannertool, in the browser. Files never leave this tab.',
  'gate.kicker': 'Web converter Phase 0 · no server · files stay in this tab',
  'gate.h1': 'Build a CIA<br>in the browser.',
  'gate.lede': 'Drop the RomFS folder the desktop converter kept and WASM-built makerom·bannertool pack a CIA inside this tab. Neither the rom nor the result ever leaves it.',
  'gate.req': 'How to make the folder: NEO3DS_KEEP=1 neo3ds-converter kof98h.zip out → the kof98h-* folder in the temp dir',
  'gate.nofile': 'Drop a folder', 'gate.dropT': 'Drop the kept folder',
  'gate.dropD': 'Click or drag here (romfs/ + icon.png·banner.png·banner.wav)',
  'gate.run': 'Build CIA', 'gate.dl': 'Get the CIA',
  'gate.progH2': 'Progress', 'gate.progLede': 'Each step reports here. Get the CIA above when done.',
  'gate.p1t': 'Staging files', 'gate.p1d': 'Load romfs/ (14 files) + icon/banner sources into memory.',
  'gate.p2t': 'Icon·banner', 'gate.p3t': 'Packing the CIA',
  'gate.p3d': 'Pack the engine ELF + RomFS with WASM makerom.',
  'gate.logLabel': 'Gate log', 'gate.logNote': 'Log lines match the desktop converter. CIAs are usually tens of MB.',
  'gate.issue': 'Phase 0 issue', 'gate.home': 'Intro page',
  /* JS가 그리는 문구 */
  'budget.main': 'main core', 'budget.core1': 'core 1', 'budget.idle': 'idle',
  'budget.d68k': '68000 (game code)', 'budget.dz80': 'Z80 (sound CPU)', 'budget.dtmr': 'timers',
  'budget.dsnd': 'YM2610 synthesis', 'budget.drnd': 'frame drawing',
  'budget.d68kT': 'Runs the game program: 3.15ms of the 16.7ms frame, measured on hardware.',
  'budget.dz80T': 'Runs the sound program and the ADPCM streaming.',
  'budget.dtmrT': 'The Neo Geo frame timers, 264 lines per frame.',
  'budget.dsndT': 'YM2610 synthesis on the second core, while the main core emulates ahead.',
  'budget.drndT': 'Sprites and tiles drawn straight into the top screen framebuffer — no GPU involved.',
  'budget.didleT': 'Time spent waiting for the screen-refresh signal (vblank). The emulator is paced at 60Hz, not maxed out.',
  'mem.rom': 'ROM data', 'mem.cache': 'sprite cache', 'mem.free': 'heap free', 'mem.linear': 'linear (screens, audio)',
  'mode.64a': 'Games start and quit immediately — nothing is reloaded.',
  'mode.64b': '64MB of app memory split as heap 58MB + linear 2MB.',
  'mode.64c': 'KOF \'99 uses 51.5MB of it, packed sprites (19.6MB) included.',
  'mode.80a': 'More memory, but the system reloads the HOME menu on every start and quit.',
  'mode.80b': 'So it stays off: fitting a 64MB graphics ROM into the default mode was the better trade.',
  'mode.80c': 'A New 3DS still gets 124MB, 804MHz and the L2 cache from the same CIA (not confirmed on hardware).',
  'ex.verified': 'on hardware', 'ex.ok': 'buildable', 'ex.no': 'not supported',
  'ex.pick': 'Pick a game on the left.',
  'ex.unverified': 'Converts fine, but not played on hardware yet.',
  'ex.romset': 'romset', 'ex.year': 'year', 'ex.maker': 'maker', 'ex.rom': 'ROM size',
  'ex.gfx': 'graphics', 'ex.tiles': 'tiles', 'ex.decrypt': 'decryption',
  'tiles': 'tiles',
};

const snapshots = [];
function snapshotKo() {
  $$('[data-i18n]').forEach((el) => snapshots.push(['el', el, el.innerHTML]));
  $$('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':');
      snapshots.push(['attr', el, key, attr, el.getAttribute(attr)]);
    });
  });
  snapshots.push(['title', document.querySelector('title'), document.title]);
}

let LANG = 'ko';
function setLang(lang) {
  LANG = lang;
  for (const s of snapshots) {
    if (s[0] === 'el') {
      const key = s[1].dataset.i18n;
      if (lang === 'en' && !(key in EN)) console.warn('[i18n] missing EN key:', key);
      s[1].innerHTML = lang === 'en' ? (EN[key] ?? s[2]) : s[2];
    } else if (s[0] === 'attr') {
      if (lang === 'en' && !(s[2] in EN)) console.warn('[i18n] missing EN key:', s[2]);
      s[1].setAttribute(s[3], lang === 'en' ? (EN[s[2]] ?? s[4]) : s[4]);
    } else {
      s[1].textContent = lang === 'en' ? 'neo3ds — Neo Geo games on your 3DS HOME menu' : s[2];
    }
  }
  $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  document.documentElement.lang = lang;
  try { localStorage.setItem('neo3ds-lang', lang); } catch (e) { /* private mode */ }
}

/** 지금 언어에 맞는 문구 (en이 없으면 넘긴 한국어를 그대로 씀) */
const t = (ko, en) => (LANG === 'en' ? en : ko);

snapshotKo();
try {
  const saved = localStorage.getItem('neo3ds-lang');
  setLang(saved || ((navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en'));
} catch (e) {
  setLang((navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en');
}
$$('.lang button').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); refreshDynamic(); }));

/* 모션을 줄이는 설정이면 GIF 대신 같은 프레임의 정지 이미지를 씁니다. */
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  $$('.device img').forEach((img) => { img.src = img.src.replace(/\.gif$/, '.png'); });
}

/* ══════════════════════════════════════════════════════════════════════
   2. 변환 파이프라인 (게임 DB의 실제 값으로)
   ════════════════════════════════════════════════════════════════════ */
const DB = window.NEO3DS_DB || { counts: { total: 0, ok: 0, no: 0, verified: 0 }, games: [] };
const bySet = new Map(DB.games.map((r) => [r[0], r]));

const CHAIN = {
  '': ['보호칩 없음', 'no protection'],
  'patch': ['보호칩 없음 · 검사 패치', 'no protection · check patched'],
  'cmc42': ['CMC42 해독', 'CMC42 decrypted'],
  'cmc50': ['CMC50 해독', 'CMC50 decrypted'],
  'sma+cmc42': ['SMA + CMC42 해독', 'SMA + CMC42 decrypted'],
  'sma+cmc50': ['SMA + CMC50 해독', 'SMA + CMC50 decrypted'],
  'cmc50+pcm2': ['CMC50 + PCM2 해독', 'CMC50 + PCM2 decrypted'],
  'cmc50+pcm2+k2k2': ['KOF2002형 + CMC50 + PCM2 해독', 'KOF2002-type + CMC50 + PCM2 decrypted'],
  'cmc50+pcm2+pvc': ['PVC + PCM2 + CMC50 해독', 'PVC + PCM2 + CMC50 decrypted'],
  'boot': ['해적판 자체 해독', 'bootleg decryption'],
};
const chainText = (c) => (CHAIN[c] || CHAIN[''])[LANG === 'en' ? 1 : 0];
const tiles = (mb) => Math.round((mb * 1048576) / 128);   // 스프라이트 128B = 타일 1개(RomPack.cs)
const CHIP_GAMES = ['kof99', 'mslug3', 'mslugx', 'svc', 'garou', 'kof2002'];
let chipSelect = 'kof99';
const chips = $('#chips');

function buildChips() {
  if (!DB.games.length) { chips.innerHTML = ''; return; }
  chips.innerHTML = CHIP_GAMES.map((s) => {
    const g = bySet.get(s);
    return `<button type="button" class="chip" data-set="${s}" aria-pressed="${s === chipSelect}">${g[1]} <span class="dim">${s}</span></button>`;
  }).join('');
  $$('.chip', chips).forEach((c) => c.addEventListener('click', () => {
    chipSelect = c.dataset.set; buildChips(); resetPipeline();
  }));
}

const g = () => bySet.get(chipSelect);
const isKof99 = () => chipSelect === 'kof99';

function pipeValues() {
  const row = g();
  return {
    1: `${row[0]} · ${row[2]}`,
    2: chainText(row[5]),
    3: row[5] === 'patch' ? t('보호칩 검사 패치', 'protection check patched') : t('바이트 순서 정리', 'byte order fixed'),
    4: `${tiles(row[9]).toLocaleString()} ${t('타일', 'tiles')} · ${t('그래픽', 'graphics')} ${row[9]}MB` + (isKof99() ? ' → 19.6MB' : ''),
    5: '48×48 · 256×128',
    6: t('엔진 + 게임 데이터', 'engine + game data'),
  };
}

function logLines() {
  const row = g();
  const titleId = isKof99() ? '0004000000CE43400' : t('zip 이름에서 생성', 'from the zip name');
  const biosMvs = row[0] === 'svcplus';
  const graphicsKo = `타일 ${tiles(row[9]).toLocaleString()}개, 그래픽 ${row[9]}MB` +
    (isKof99() ? ' → 19.6MB, 3DS 메모리 사용 약 43.5MB' : ' (zstd 4KB 블록)');
  const graphicsEn = `${tiles(row[9]).toLocaleString()} tiles, graphics ${row[9]}MB` +
    (isKof99() ? ' → 19.6MB, about 43.5MB of 3DS memory' : ' (zstd 4KB blocks)');
  return [
    [`선택: ${chipSelect}.zip  (Title ID ${titleId})`, `Selected: ${chipSelect}.zip  (Title ID ${titleId})`],
    [`[1/4] RomFS 준비 (${chipSelect})`, `[1/4] Preparing RomFS (${chipSelect})`],
    row[5] === 'patch' ? ['  MslugX 보호칩 검사 패치 적용', '  MslugX protection check patched'] : null,
    row[5] ? [`  암호 해독 중... (${chainText(row[5])})`, `  Decrypting... (${chainText(row[5])})`] : null,
    row[5] ? [biosMvs ? '  시스템: MVS (아케이드)' : '  시스템: AES (가정용)',
              biosMvs ? '  System: MVS (arcade)' : '  System: AES (home)'] : null,
    ['  그래픽 변환 + 압축 중...', '  Converting and compressing graphics...'],
    ['  ' + graphicsKo, '  ' + graphicsEn],
    ['[2/4] 아이콘/배너 생성', '[2/4] Making icon and banner'],
    [`[3/4] CIA 생성 (Title ID ${titleId})`, `[3/4] Building CIA (Title ID ${titleId})`],
    [`[4/4] 완료: C:\\NeoGeo\\${chipSelect}.cia`, `[4/4] Done: C:\\NeoGeo\\${chipSelect}.cia`],
    ['FBI로 설치하세요: SD카드에 복사 → FBI → SD → 파일 선택 → Install CIA',
     'Install with FBI: copy to the SD card → FBI → SD → pick the file → Install CIA'],
  ].filter(Boolean);
}

let pipeToken = 0;
function resetPipeline() {
  pipeToken++;
  const row = g();
  $('#convFile').textContent = `${chipSelect}.zip`;
  $('#convLog').innerHTML = `<i>${t('변환 대기 중 — [CIA 만들기]를 누르세요.', 'Ready — press [Build CIA].')}</i>\n` +
    `<i>${t(`롬셋: ${row[1]} (${row[2]}) · 롬 ${row[4]}MB · ${chainText(row[5])}`,
          `romset: ${row[1]} (${row[2]}) · ROM ${row[4]}MB · ${chainText(row[5])}`)}</i>`;
  $$('.pipe li').forEach((li) => li.classList.remove('done', 'now'));
  $$('[data-pipe]').forEach((el) => { el.textContent = ''; });
  $('#convReset').classList.add('hidden');
  $('#convRun').disabled = false;
}

function runPipeline() {
  const vals = pipeValues(), lines = logLines();
  const log = $('#convLog'), items = $$('.pipe li');
  log.innerHTML = '';
  $('#convRun').disabled = true;
  items.forEach((li) => li.classList.remove('done', 'now'));
  const stageOf = [0, 1, 1, 2, 3, 4, 4, 5, 5, 5, 5];
  let i = 0;
  const my = ++pipeToken;
  const tick = () => {
    if (my !== pipeToken) return;
    const stage = Math.min(items.length - 1, stageOf[Math.min(i, stageOf.length - 1)]);
    items.forEach((li, n) => {
      li.classList.toggle('now', n === stage);
      if (n < stage) { li.classList.add('done'); if (!li.querySelector('.pipe-val').textContent) li.querySelector('.pipe-val').textContent = vals[n + 1]; }
    });
    const [ko, en] = lines[i];
    log.insertAdjacentHTML('beforeend', t(ko, en).replace(/^(\[[0-9]\/4\])/, '<b>$1</b>') + '\n');
    log.scrollTop = log.scrollHeight;
    if (++i >= lines.length) {
      items.forEach((li, n) => { li.classList.remove('now'); li.classList.add('done'); li.querySelector('.pipe-val').textContent = vals[n + 1]; });
      $('#convRun').disabled = false;
      $('#convReset').classList.remove('hidden');
      return;
    }
    setTimeout(tick, matchMedia('(prefers-reduced-motion: reduce)').matches ? 60 : 420);
  };
  tick();
}
// Subpages (convert.html) share the i18n + header logic but skip index-only sections.
const ON_INDEX = !!$('#convRun');
if (ON_INDEX) {
  $('#convRun').addEventListener('click', runPipeline);
  $('#convReset').addEventListener('click', resetPipeline);
  buildChips();
  if (DB.games.length) resetPipeline();
}

/* ══════════════════════════════════════════════════════════════════════
   3. 프레임 예산 (실기 진단 화면 값) — 숫자는 막대 밖 범례에 씁니다
   ════════════════════════════════════════════════════════════════════ */
const FRAME = 16.7;
const BUDGET = [
  { row: 'main', color: 'var(--a)', value: 3.15, ko: '68000 (게임 코드)', en: '68000 (game code)', key: 'd68k' },
  { row: 'main', color: 'var(--b)', value: 0.86, ko: 'Z80 (사운드 CPU)', en: 'Z80 (sound CPU)', key: 'dz80' },
  { row: 'main', color: 'var(--c)', value: 0.40, ko: '타이머', en: 'timers', key: 'dtmr' },
  { row: 'core1', color: 'var(--d)', value: 1.23, ko: '사운드 칩(YM2610) 합성', en: 'sound chip (YM2610) synthesis', key: 'dsnd' },
  { row: 'core1', color: 'var(--gold)', value: 2.96, ko: '화면 그리기', en: 'frame drawing', key: 'drnd' },
];
const budgetName = (b) => (LANG === 'en' ? b.en : b.ko);
const KO_NOTE = {
  d68k: '게임 프로그램을 돌립니다. 16.7ms 중 3.15ms — 실기 측정값입니다.',
  dz80: '사운드 프로그램과 ADPCM 스트리밍을 처리합니다.',
  dtmr: '네오지오 프레임 타이머. 한 프레임에 264줄입니다.',
  dsnd: 'YM2610 합성. 메인 코어가 다음 프레임을 에뮬레이션하는 동안 두 번째 코어가 맡습니다.',
  drnd: '스프라이트와 타일을 위 화면 프레임버퍼에 직접 그립니다. GPU를 쓰지 않습니다.',
  didle: '화면이 갱신되는 신호(vblank)를 기다리는 시간입니다. 60Hz에 맞춰 돌리는 것이지, 최대로 돌리는 것이 아닙니다.',
};

function buildBudget() {
  const host = $('#budget'), legend = $('#budgetLegend');
  host.innerHTML = ['main', 'core1'].map((row) => {
    const segs = BUDGET.filter((b) => b.row === row);
    const idle = FRAME - segs.reduce((a, b) => a + b.value, 0);
    const bars = segs.map((b) =>
      `<span class="seg" data-key="${b.key}" style="width:${(b.value / FRAME * 100).toFixed(2)}%;background:${b.color}"></span>`).join('') +
      `<span class="seg seg-idle" style="width:${(idle / FRAME * 100).toFixed(2)}%"></span>`;
    return `<div class="budget-row"><span class="budget-name">${row === 'main' ? t('메인 코어', 'main core') : t('코어 1', 'core 1')}</span>
      <span class="fbar">${bars}</span></div>`;
  }).join('');

  const idleMain = FRAME - BUDGET.filter((b) => b.row === 'main').reduce((a, b) => a + b.value, 0);
  const rows = BUDGET.concat([{ color: 'var(--panel)', value: idleMain, key: 'didle' }]);
  legend.innerHTML = rows.map((b) =>
    `<button type="button" data-key="${b.key}"><i style="--c:${b.color}"></i><span>${b.key === 'didle' ? t('남는 시간 (화면 신호를 기다림)', 'idle (waiting for the screen refresh)') : budgetName(b)}</span><b>${b.value.toFixed(2)} ms</b></button>`).join('');
  $$('button', legend).forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.key;
    $$('.seg', host).forEach((s) => s.classList.toggle('on', s.dataset.key === key));
    $('#budgetNote').textContent = LANG === 'en' ? EN['budget.' + key + 'T'] : KO_NOTE[key];
  }));
}
if (ON_INDEX) buildBudget();

/* ══════════════════════════════════════════════════════════════════════
   4. 메모리 / 64MB 모드
   ════════════════════════════════════════════════════════════════════ */
const MEM = [
  { w: 43.5, color: 'var(--gold)', key: 'mem.rom', ko: '롬 데이터' },
  { w: 8.0, color: 'var(--d)', key: 'mem.cache', ko: '스프라이트 캐시' },
  { w: 6.5, color: 'var(--panel)', key: 'mem.free', ko: '힙 여유' },
  { w: 2.0, color: 'var(--c)', key: 'mem.linear', ko: 'linear (화면·오디오)' },
];
function buildMemory() {
  const total = MEM.reduce((a, m) => a + m.w, 0);
  $('#membar').innerHTML = MEM.map((m) =>
    `<span class="seg" style="width:${(m.w / total * 100).toFixed(2)}%;background:${m.color}"></span>`).join('');
  $('#memLegend').innerHTML = MEM.map((m) =>
    `<li><i style="--c:${m.color}"></i><span>${LANG === 'en' ? EN[m.key] : m.ko} ${m.w}MB</span></li>`).join('');
}
const KO_MODE = {
  'mode.64a': '게임을 켜고 끌 때 재로딩이 없습니다. HOME 메뉴에서 바로 켜고 바로 나옵니다.',
  'mode.64b': '앱 메모리 64MB를 힙 58MB + linear 2MB로 나눠 씁니다.',
  'mode.64c': "KOF '99는 압축한 스프라이트(19.6MB)를 포함해 51.5MB를 씁니다.",
  'mode.80a': '메모리는 넉넉해지지만, 게임을 켜고 끌 때마다 시스템이 HOME 메뉴를 다시 불러옵니다.',
  'mode.80b': '그래서 쓰지 않습니다. 기본 모드 안에 64MB 그래픽 롬을 밀어 넣는 쪽을 골랐습니다.',
  'mode.80c': '같은 CIA로 New 3DS에서는 124MB + 804MHz + L2 캐시가 켜집니다(실기 미확인).',
};
function setMode(m) {
  $$('.modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  const keys = m === '64' ? ['mode.64a', 'mode.64b', 'mode.64c'] : ['mode.80a', 'mode.80b', 'mode.80c'];
  $('#modeBody').innerHTML = `<ul>${keys.map((k) => `<li>${LANG === 'en' ? EN[k] : KO_MODE[k]}</li>`).join('')}</ul>`;
}
if (ON_INDEX) {
  $$('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  buildMemory();
  setMode('64');
}

/* ══════════════════════════════════════════════════════════════════════
   5. 호환성 목록 (처음에는 12줄만)
   ════════════════════════════════════════════════════════════════════ */
const FIRST = 12, MORE = 60;
const exList = $('#exList'), exDetail = $('#exDetail'), exFilters = $('#exFilters');
let filter = 'all', query = '', sort = 'default', shown = FIRST, selected = null;

const statusText = (st) => st === 1 ? t('실기 확인', 'on hardware') : st === 0 ? t('변환 가능', 'buildable') : t('변환 불가', 'not supported');
const matches = ([set, title, year, , , , st]) => {
  if (filter === 'verified' && st !== 1) return false;
  if (filter === 'ok' && st === 2) return false;
  if (filter === 'no' && st !== 2) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return set.includes(q) || title.toLowerCase().includes(q) || String(year).includes(q);
};
const sorted = (rows) => {
  const r = rows.slice();
  if (sort === 'name') r.sort((a, b) => a[1].localeCompare(b[1]));
  else if (sort === 'year') r.sort((a, b) => String(b[2]).localeCompare(String(a[2])) || a[1].localeCompare(b[1]));
  else if (sort === 'size') r.sort((a, b) => b[4] - a[4]);
  else r.sort((a, b) => (a[6] !== 1) - (b[6] !== 1) || a[1].localeCompare(b[1]));
  return r;
};

function renderList() {
  const rows = sorted(DB.games.filter(matches));
  exList.innerHTML = rows.slice(0, shown).map(([set, title, year, , mb, , st]) => {
    const badge = st === 1 ? `<span class="badge">${t('실기 확인', 'hardware')}</span>`
      : st === 2 ? `<span class="badge">${t('불가', 'no')}</span>` : '';
    return `<div role="listitem"><button type="button" class="ex-row${selected === set ? ' sel' : ''}" data-st="${st}" data-set="${set}" title="${title}">
      <span class="ex-title">${title}${badge}</span>
      <span class="ex-set">${set}</span>
      <span class="ex-year">${year}</span>
      <span class="ex-size">${mb}MB</span></button></div>`;
  }).join('');
  $('#exMore').classList.toggle('hidden', rows.length <= shown);
  $('#exCount').textContent = t(`${rows.length}종 표시 · 변환 가능 ${DB.counts.ok} · 실기 확인 ${DB.counts.verified}`,
                               `${rows.length} shown · buildable ${DB.counts.ok} · on hardware ${DB.counts.verified}`);
  $$('.ex-row', exList).forEach((b) => b.addEventListener('click', () => { selected = b.dataset.set; renderList(); renderDetail(); }));
}

function renderDetail() {
  const row = selected ? bySet.get(selected) : null;
  if (!row) { exDetail.innerHTML = `<p class="tiny">${t('왼쪽에서 게임을 고르세요.', EN['ex.pick'])}</p>`; return; }
  const [set, title, year, maker, mb, chain, st, noteKo, noteEn, spriteMb] = row;
  const note = st === 2 ? t(noteKo, noteEn) : st === 1 ? t(noteKo, noteEn) : t('변환은 되지만 아직 실기에서 확인하지 않았습니다.', EN['ex.unverified']);
  exDetail.innerHTML = `
    <h3>${title}</h3>
    <p class="tiny">${statusText(st)}</p>
    <dl class="ex-dl">
      <div><dt>${t('롬셋', 'romset')}</dt><dd>${set}</dd></div>
      <div><dt>${t('연도', 'year')}</dt><dd>${year}</dd></div>
      <div><dt>${t('제작', 'maker')}</dt><dd>${maker}</dd></div>
      <div><dt>${t('롬 크기', 'ROM size')}</dt><dd>${mb}MB · ${t('그래픽', 'graphics')} ${spriteMb}MB</dd></div>
      <div><dt>${t('타일', 'tiles')}</dt><dd>${tiles(spriteMb).toLocaleString()}</dd></div>
      <div><dt>${t('해독', 'decryption')}</dt><dd>${st === 2 ? t('지원 안 함', 'not supported') : chainText(chain)}</dd></div>
    </dl>
    <p class="note${st === 2 ? ' no' : ''}">${note}</p>`;
}

function applyFilters() {
  $$('button', exFilters).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  shown = FIRST; renderList(); renderDetail();
}
if (ON_INDEX) {
  $$('button', exFilters).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; applyFilters(); }));
  $('#exSearch').addEventListener('input', (e) => { query = e.target.value.trim(); shown = FIRST; renderList(); });
  $('#exSort').addEventListener('change', (e) => { sort = e.target.value; renderList(); });
  $('#exMore').addEventListener('click', () => { shown += MORE; renderList(); });
  $('#cAll').textContent = DB.counts.total;
  $('#cVerified').textContent = DB.counts.verified;
  $('#cOk').textContent = DB.counts.ok;
  $('#cNo').textContent = DB.counts.no;
  if (DB.games.length) { renderList(); renderDetail(); }
}

/* ══════════════════════════════════════════════════════════════════════
   6. 언어를 바꾸면 JS가 그린 부분을 다시 그림
   ════════════════════════════════════════════════════════════════════ */
function refreshDynamic() {
  if (!ON_INDEX) return;
  buildChips();
  if (DB.games.length) resetPipeline();
  buildBudget(); buildMemory();
  setMode($$('.modes button').find((b) => b.getAttribute('aria-pressed') === 'true').dataset.mode);
  if (DB.games.length) { renderList(); renderDetail(); }
}
})();
