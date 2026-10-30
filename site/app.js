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
  'a11y.skip': 'Skip to content', 'a11y.sections': 'Sections',
  'a11y.noscript': 'This page needs JavaScript. The game list and the converter demo will not run.',
  'nav.steps': 'Setup', 'nav.games': 'Games', 'nav.faq': 'FAQ',
  'cta.download': 'Convert now', 'cta.source': 'Source code',
  'hero.kicker': 'romset zip on the PC → a 3DS install file (CIA) · converter + emulator engine',
  'hero.h1': 'Neo Geo games,<br>on the 3DS HOME menu.',
  'hero.mock': 'Game footage composited into a 3DS console mockup',
  'hero.lede': 'Drop the romset zip of a game you own and it becomes a 3DS install file (CIA) with its own HOME menu icon. It runs at 60 fps even on an Old 3DS.',
  'hero.st1': 'romsets convert', 'hero.st2': 'played on hardware', 'hero.st3': 'on an Old 3DS',
  'hero.req': 'Runs in the browser · nothing to install · GPL-2.0',
  'hero.notes': 'Patch notes — what changed in each version',
  'cta.dl': 'Get the offline converter', 'cta.dlWin': 'Get it for Windows x64',
  'cta.dlLin': 'Get it for Linux x64', 'cta.dlMac': 'Get it for macOS (Apple Silicon)',
  'steps.h2': 'Set-up in three steps',
  'steps.lede': 'Building an install file takes a minute or two on the PC. After that you only need the 3DS.',
  'steps.s1t': 'Get the romset ready',
  'steps.s1d': 'Keep your game\'s MAME romset and the BIOS together, names unchanged.',
  'steps.s2t': 'Build the CIA (or launcher files)',
  'steps.s2d': 'One game takes a minute or two, mostly compressing graphics. Drop several zips to convert them one after another, or build launcher files (.neo3ds) instead.',
  'steps.s3t': 'Install on the 3DS (or copy to the launcher)',
  'steps.s3d': 'A CIA shows up on the HOME menu. Launcher files go on the SD card at /neo3ds/games/ and start from the launcher app.',
  'out.ciaH': 'Game CIA', 'out.ciaP': 'One install file per game, with its own HOME menu icon.',
  'out.ciaCta': 'Build a game CIA',
  'out.p1': 'HOME icon and banner per game', 'out.p2': 'Key config, saves and quick saves per game',
  'out.p3': 'Install only the games you want',
  'controls.h3': 'Controls on the 3DS', 'controls.more': 'Full control table',
  'controls.href': 'manual.html',
  'chip.key': 'Key config', 'chip.turbo': 'Turbo', 'chip.slots': '3 save slots', 'chip.system': 'AES / MVS',
  'chip.keyD': 'Map every 3DS button to Neo Geo A–D, combinations, start or coin; stored per game.',
  'chip.turboD': 'Hold R and press a button to make it auto-fire; pin it in key config to keep it.',
  'chip.slotsD': 'Three quick-save slots per game, and MVS backup RAM saved to the SD card.',
  'chip.systemD': 'Switch the AES or MVS BIOS; on MVS, insert a coin with SELECT to start.',
  'prep.h3': 'What you need',
  'prep.1b': 'A 3DS', 'prep.1d': 'Old 3DS / 2DS / New 3DS / New 2DS XL, with custom firmware (Luma3DS) and an installer (FBI)',
  'prep.2b': 'A web browser', 'prep.2d': 'Chrome, Edge, Firefox, Safari · roms stay inside the browser',
  'prep.3b': 'Romsets you own', 'prep.3d': 'MAME romset zip + neogeo.zip (not included here)',
  'prep.note': 'Only MAME romset zips convert. A romset whose names or chip CRCs differ from MAME\'s will not convert.',
  'prep.4b': 'The sound file', 'prep.4d': '<code>/3ds/dspfirm.cdc</code> on the SD card',
  'conv.p5d': 'Icon (48×48) and banner (256×128) from the title or from a picture you pick.', /* convert.html gatePipe가 공유 */
  'launch.kicker': 'Recommended · the way to go for several games',
  'launch.h2': 'Launcher: every game in one app',
  'launch.lede': 'Instead of a CIA per game, install the launcher once and pick games from the list of files on the SD card. Only one HOME menu icon is added.',
  'launch.imgAlt': 'Launcher game list with the All and Fav tabs',
  'launch.cap': 'Launcher controls',
  'launch.capHref': 'manual.html',
  'launch.p1n': 'Install once', 'launch.p1': 'Install the launcher CIA with FBI just once. Adding a game later is copying its .neo3ds file to /neo3ds/games/.',
  'launch.p2n': 'Shared saves', 'launch.p2': 'The same game shares key config, backup RAM and quick saves between its CIA and launcher copies.',
  'launch.p3n': 'Back in a tap', 'launch.p3': 'In a game, tap Game list on the bottom screen twice to return to the list.',
  'launch.cta1': 'Build the launcher CIA', 'launch.cta2': 'Build launcher files',
  'speed.meas': 'Measured', 'speed.line': '16.7ms per frame · 59.8fps · KOF \'98 64.0 → 20.3MB',
  'speed.doc': 'Technical notes', 'speed.docHref': 'https://github.com/zzcx88/neo3ds/blob/main/docs/TECHNICAL.md',
  'games.h2': 'Game compatibility',
  'games.lede': 'The converter knows 282 romsets and builds 242 of them. 25 of those were played on an Old 3DS (Aero Fighters 3 is playable).',
  'games.all': 'All 282 romsets — status per game',
  /* 시리즈 바로가기 (#198): 앵커 텍스트는 게임명 + 3DS, 검색어와 일치시킨다. */
  'games.seriesH': 'Browse by series', 'games.seriesLabel': 'Series pages',
  'games.seriesMetalSlug': 'Metal Slug on 3DS', 'games.seriesKof': 'The King of Fighters on 3DS',
  'games.seriesSamsho': 'Samurai Shodown on 3DS', 'games.seriesFatalFury': 'Fatal Fury &amp; Garou on 3DS',
  'games.seriesAof': 'Art of Fighting on 3DS', 'games.seriesLastBlade': 'The Last Blade on 3DS',
  'games.seriesWorldHeroes': 'World Heroes on 3DS', 'games.seriesSengoku': 'Sengoku on 3DS',
  'games.seriesPuzzleBobble': 'Puzzle Bobble on 3DS', 'games.seriesShockTroopers': 'Shock Troopers on 3DS',
  'games.seriesSuperSidekicks': 'Super Sidekicks on 3DS', 'games.seriesKotm': 'King of the Monsters on 3DS',
  'games.searchLabel': 'Search games', 'games.searchPh': 'Title or romset name (e.g. kof99, slug)',
  'games.fAll': 'All', 'games.fVerified': 'On hardware', 'games.fOk': 'Buildable', 'games.fNo': 'Not supported', 'games.filters': 'Filters',
  'games.sort': 'Sort', 'games.sortDefault': 'Hardware first', 'games.sortName': 'Title',
  'games.sortYear': 'Year', 'games.sortSize': 'ROM size',
  'games.pagesLabel': 'Pages', 'games.prev': 'Previous page', 'games.next': 'Next page',
  'games.cavH3': 'Notes',
  'games.cav1': 'Some decryption is implemented but never played, because we lack the ROMs.',
  'games.cav1b': 'Games we could not check because we have no ROM — CMC42: Sengoku 3, Zupapa, Strikers 1945 Plus, Prehistoric Isle 2, Nightmare in the Dark, Ganryu, Bang Bead · CMC50: KOF2001 · PCM2: Metal Slug 4 Plus, Rage of the Dragons, Pochi and Nyaa',
  'games.cav2': 'KOF \'98 does not convert: the MVS version has a protection chip. When the home set (kof98h) is in the zip it is picked automatically.',
  'games.cav3': 'When a romset is tight for memory, the converter warns you first.',
  'games.cav4': 'Metal Slug 2, X and 3 slow down in scenes with many enemies and explosions on the original arcade board too. neo3ds drops frames in exactly those scenes.',
  'faq.h2': 'Questions',
  'faq.q1': 'Where do I get the ROMs?', 'faq.a1': 'Nowhere. You need romsets for games you own, and a built CIA contains ROM data, so never share it.',
  'faq.q2': 'Is it really 60 fps on an Old 3DS?', 'faq.a2': 'KOF \'95-\'99, 2000, 2002, Metal Slug 1, X, 3 and 5, Neo Turf Masters, Neo Drift Out, SVC Chaos and Samurai Shodown V Special ran at full speed on hardware. Metal Slug 2, X and 3 slow down exactly where the original board did; Aero Fighters 3 is playable.',
  'faq.q3': 'No sound.', 'faq.a3': 'The SD card needs <code>/3ds/dspfirm.cdc</code>; a tool like DSP1 creates it once.',
  'faq.q5': 'What about a New 3DS?', 'faq.a5': 'The CIA asks for 804MHz and the L2 cache, which leaves more headroom (not confirmed on hardware yet).',
  'faq.q6': 'Can I use it commercially?', 'faq.a6': 'No: the included CPU cores (Cyclone 68000, DrZ80) allow non-commercial use only.',
  'legal.h2': 'Legal',
  'legal.p1': 'No ROMs, BIOS or game data are included here. Convert only games you own, and never distribute a CIA you build.',
  'legal.p2': 'neo3ds is a personal fan project, unaffiliated with SNK or Nintendo. NEOGEO is a trademark of SNK CORPORATION; Nintendo 3DS of Nintendo. Credits and third-party code are in <a href="https://github.com/zzcx88/neo3ds/blob/main/THIRD_PARTY_NOTICES.md">third-party notices</a>; the source is GPL-2.0.',
  'foot.compat': 'Game list', 'foot.repo': 'Repository', 'foot.rel': 'Releases', 'foot.readme': 'README',
  'foot.build': 'Build procedure', 'foot.lic': 'Licence',
  'foot.note': 'Game screens and trademarks belong to their owners.', 'foot.privacy': 'Privacy',
  'foot.report': 'Report a problem',
  /* privacy.html — web usage stats (#125) */
  'priv.h1': 'Privacy',
  'priv.lede': 'The web converter never sends your rom or its file name to a server. This is the complete list of what the site measures and what a report sends.',
  'priv.whatH2': 'What is measured',
  'priv.whatP': 'Visit statistics come from Umami Cloud. It counts the following without cookies.',
  'priv.pageviews': 'Page views: the page URL, the referring page, browser and operating system, device type, and country. The IP address is not stored; only the country is derived from it.',
  'priv.events': 'Conversion events: the output mode (the game-count range when several zips are queued), the game\'s romset name (only when it is in the public catalog, otherwise <code>unknown</code>), the stage and reason a run failed (<code>load/bios</code> pairs step and cause), the output mode of a download click, and one event per report submission (no properties).',
  'priv.notSent': 'Not sent: rom files, zip file names, custom icon or banner images, or the converted file. All of them stay inside the browser tab.',
  'priv.reportH2': 'Problem reports',
  'priv.reportP': 'Pressing send in the intro page\'s report form sends the values below to an anonymous Cloudflare Worker, which opens an issue in the public GitHub repository. No account is needed.',
  'priv.reportWhat': 'Sent: the report type, your description and optional game name, the last 200 lines of the converter log, the failed games\' public romset names, reasons and stages, the error message, the converter version, the output mode, the page address, and browser information (user agent).',
  'priv.reportPublic': 'The issue is public and anyone can read it; closing it does not delete it. No identity or email is collected, and no reply is promised.',
  'priv.reportRate': 'Abuse limit: instead of the IP itself the worker keeps a hash of IP and hour for at most one hour, to allow 5 reports per hour.',
  'priv.reportNotSent': 'A report never carries zip file names, rom files, icon or banner images.',
  'priv.cookiesH2': 'Cookies and ad blockers',
  'priv.cookiesP': 'No cookies are used, so there is no consent banner. Umami tells visits apart without cookies.',
  'priv.blockersP': 'If an ad blocker removes the statistics script, that visit is missing from the counts and nothing else changes: conversion still works.',
  'priv.processorH2': 'Processor and retention',
  'priv.processorP': 'Umami Cloud (EU region) processes these events. The site uses its Hobby plan, and raw events are deleted after 6 months. Long-term trends are exported before that.',
  'priv.purposeP': 'The numbers are used only to improve the site: which page people read, where conversion fails, and which games are popular. No advertising, selling or profiling.',
  'priv.contactH2': 'Contact',
  'priv.contactP': 'Questions about this page go to the <a href="https://github.com/zzcx88/neo3ds/issues">repository issues</a>.',
  'priv.updated': 'Last updated 2026-10-30.',
  /* convert.html — web converter */
  'gate.meta': 'Drop game zips and convert in the browser. Files never leave this tab.',
  'gate.noscript': 'This page needs JavaScript.',
  'gate.kicker': 'Web converter · no server · files stay in this tab',
  'gate.h1': 'Convert<br>in the browser.',
  'gate.lede': 'Drop several game zips plus neogeo.zip and this tab converts them one after another. Neither the rom nor the result ever leaves it.',
  'gate.factLabel': 'Before you convert',
  'gate.biosT': 'neogeo.zip (BIOS) is required',
  'gate.biosD': '— drop it together with the game zip. Without it nothing converts.',
  'gate.batchT': 'Many games at once',
  'gate.batchD': '— drop several game zips and they convert one after another. No refresh between games.',
  'gate.onlyT': 'MAME Neo Geo romset zips only',
  'gate.onlyD': '— a romset whose names or chip CRCs differ from MAME will not convert. For a merged set, add the parent zip too (kof98h.zip + kof98.zip).',
  'gate.nofile': 'Drop zips', 'gate.dropT': 'Drop rom zips',
  'gate.dropD': 'Click or drag here · multiple files allowed (game zip + neogeo.zip)',
  'gate.run': 'Convert', 'gate.dl': 'Download', 'gate.cancel': 'Cancel',
  'gate.region': 'Region', 'gate.eu': 'Europe/Asia', 'gate.jp': 'Japan', 'gate.us': 'USA',
  'gate.system': 'System', 'gate.auto': 'Auto',
  'gate.progH2': 'Progress', 'gate.progLede': 'Each step reports here. Download right here when it is done.', 'gate.resultH': 'Result',
  'gate.p1t': 'Checking romset', 'gate.p1d': 'Find the romset by zip name and check chips by CRC.',
  'gate.p2t': 'Compressing graphics', 'gate.p2d': 'Pack sprites into 16KB zstd blocks.',
  'gate.p3t': 'Icon·banner', 'gate.p4t': 'Packing the output',
  'gate.p3d': 'Bundle the output with WASM tooling.',
  'gate.logLabel': 'Converter log', 'gate.logNote': 'Each log line shows the elapsed time, game and stage. Outputs are usually tens of MB.',
'gate.home': 'Intro page',
  'gate.offWin': 'Offline converter (Windows)', 'gate.offLin': 'Offline converter (Linux)', 'gate.offMac': 'Offline converter (macOS)',
  'gate.mCia': 'Game CIA', 'gate.mPack': 'Launcher file', 'gate.mLaunch': 'Launcher CIA',
  'gate.mLabel': 'Pick an output', 'gate.mGame': 'Per game — straight onto the HOME menu',
  'gate.mLaunchGroupTitle': 'For the launcher — many games in one app',
  'gate.mGameGroup': 'Per game', 'gate.mLaunchGroup': 'For the launcher',
  'gate.mCiaOut': '.cia → install with FBI', 'gate.mPackOut': '.neo3ds → /neo3ds/games/', 'gate.mLaunchOut': '.cia → install once',
  'gate.mUpd': 'To update, just install the new launcher CIA. Your existing .neo3ds files run on the new version as they are.',
  'gate.listH': 'Recognized games',
  'gate.recog': 'Checking…', 'gate.overallReady': 'Ready to convert',
  'gate.listHint': 'Check before converting. Select a game row to change that game\'s icon and banner. Games that cannot be converted show why and are skipped.',
  'gate.artH': 'Icon and banner',
  'gate.artHint': 'Check the HOME menu art before converting. A picture you pick is centre-cropped to 48×48 / 256×128.',
  'gate.artIcon': 'Icon 48×48', 'gate.artBanner': 'Banner 256×128',
  'gate.artPick': 'Choose file', 'gate.artClear': 'Automatic',
  'gate.artBack': 'Back to list', 'gate.artLock': 'The icon and banner cannot be changed while converting.',
  /* #188/#189 익명 제보 폼 — 소개 페이지 */
  'report.h': 'Something went wrong?',
  'report.landingH': 'Report a problem',
  'report.landingLede': 'Leave a comment or a problem. It is filed anonymously as a public GitHub issue, no account needed.',
  'report.convertLede': 'Reports go through the form on the intro page. The log and game details of the failed run travel with you.',
  'report.go': 'Report',
  'report.pending': 'The log and game details of the failed run are attached.',
  'report.type': 'Type', 'report.typeConvert': 'Conversion failed', 'report.typeBug': 'Site / converter bug',
  'report.typeFeature': 'Feature request', 'report.typeOther': 'Something else',
  'report.gameLabel': 'Game name (optional)', 'report.textLabel': 'What went wrong?',
  'report.public': 'The report (symptom, log, browser info) becomes a public GitHub issue. Do not include personal details.',
  'report.send': 'Send', 'report.open': 'Report a problem',
  /* JS가 그리는 문구 */
  'ex.verified': 'on hardware', 'ex.ok': 'buildable', 'ex.no': 'not supported',
  'ex.pick': 'Pick a game on the left.',
  'ex.cta': 'Build this game\'s CIA',
  'ex.unverified': 'Converts fine, but not played on hardware yet.',
  'ex.romset': 'romset', 'ex.year': 'year', 'ex.maker': 'maker', 'ex.rom': 'ROM size',
  'ex.gfx': 'graphics', 'ex.tiles': 'tiles', 'ex.decrypt': 'decryption',
  'tiles': 'tiles',
  /* manual.html (#162) — 3DS 사용 안내 */
  'man.h1': '3DS manual',
  'man.nav.launch': 'Launcher', 'man.nav.controls': 'Controls', 'man.nav.keys': 'Key config',
  'man.launchH2': 'Launcher',
  'man.launchAlt': 'Launcher game list with the All and Fav tabs',
  'man.launchCap': 'Game list · All / Fav tabs',
  'man.pickK': 'Pick a game',
  'man.pickD': 'Up/Down (L/R for a page) or touch to pick; A or a double tap to start.',
  'man.favK': 'Favorites',
  'man.favD': 'SELECT or a tap on the <code>*</code> at the left of a game adds or removes it. Left/Right or the tabs switch between All and Fav.',
  'man.backK': 'Back to the list',
  'man.backD': 'In a game, tap <strong>[Game list]</strong> on the bottom screen twice.',
  'man.update': '<strong>Updating only takes the launcher.</strong> The engine lives in the launcher, so the <code>.neo3ds</code> files you already made run on a new version as they are. Per-game CIAs carry their own engine and have to be converted again. Key configs and backup RAM carry over; quick saves from another version can\'t be loaded.',
  'man.ciaP': 'To use per-game CIAs instead, copy the <code>.cia</code> to the SD card and install it in FBI (SD → the file → <strong>Install CIA</strong>). A game shares its key config, backup RAM and quick saves between its CIA and the launcher.',
  'man.ctrlH2': 'Controls',
  'man.ctrlLede': 'These are the defaults; Key config changes them per game.',
  'man.grp1': 'Game input', 'man.grp2': 'System and shortcuts',
  'man.th1': '3DS', 'man.th2': 'Neo Geo',
  'man.k.dpad': 'D-pad',
  'man.k.restart': 'Hold <kbd>SELECT</kbd> <span class="sep">+</span> <kbd>START</kbd> for 1 s',
  'man.m.joystick': 'Joystick',
  'man.m.coin': 'Coin / Start',
  'man.m.turbo': 'Turbo on/off',
  'man.m.qs': 'Quick save / quick load',
  'man.m.restart': 'Restart the game',
  'man.ctrlNote': 'The bottom screen shows the current layout in the arcade panel colours (A red, B yellow, C green, D blue), with the game title and fps at the top.',
  'man.bottomH2': 'Bottom screen',
  'man.bottomAlt': 'Bottom screen buttons and key layout',
  'man.bottomCap': 'The bottom screen in a game',
  'man.b.keys': 'Opens the key config screen (the game pauses)',
  'man.b.turbo': 'Each tap moves turbo off → A → B → X → Y',
  'man.b.system': 'Switches between the home (AES) and arcade (MVS) BIOS. Tap twice; the game restarts on it',
  'man.b.diag': 'fps, per-core time and memory use, once a second. Touch to go back',
  'man.b.restart': 'Hold until the yellow bar fills. Like switching the console off and on (cartridge saves are kept)',
  'man.b.service': 'MVS BIOS service menu (difficulty, credits, hardware tests). MVS only',
  'man.b.slot': 'Quick save: pick slot 1-3, save, load (tap twice)',
  'man.b.gamelist': 'From the launcher only: tap twice to go back to the list',
  'man.b.power': 'Turns the bottom screen\'s backlight off; touch anywhere to turn it back on (that touch presses nothing)',
  'man.keysH2': 'Key config',
  'man.keysAlt': 'Key config screen (L = A+B, R = C+D)',
  'man.keysCap': 'Key config is saved per game',
  'man.k1': 'A / B / X / Y / L / R / ZL / ZR / START / SELECT can each press Neo Geo A-D, a combination (A+B, C+D, B+C, A+B+C, B+C+D, A+B+C+D), Start or Coin. For example in KOF: L = A+B (dodge), R = C+D (blowback).',
  'man.k2': 'Tap <code>&lt;</code> <code>&gt;</code> at the end of a line, or Up/Down then Left/Right. The turbo button is set here too.',
  'man.k3': '<strong>System</strong> switches the BIOS (saving restarts the game). On MVS, press SELECT for a coin before starting.',
  'man.k4': '<strong>Screen</strong>: <code>Original (1:1)</code> shows the 304×224 picture as is; <code>Full (stretched)</code> fills the 400×240 top screen (about 1.3× wider, 1.07× taller, so some pixels show twice as wide).',
  'man.k5': '<strong>B</strong> or <code>Save (B)</code> saves and returns; <code>Default</code> restores the defaults. Settings are kept per game.',
  'man.turboH3': 'Turbo',
  'man.turboP': 'Hold R and press A, B, X or Y to make it the turbo button (the same button again turns it off). Held down, it fires 20 times a second; single taps still fire once. R + button lasts for the session; set it in Key config to keep it.',
  'man.saveH2': 'Saves',
  'man.qsH3': 'Quick save',
  'man.qsP': 'Three slots per game hold the exact game state. A slot saved on the other BIOS switches to it before loading.',
  'man.bramH3': 'Backup RAM',
  'man.bramP': 'On the MVS BIOS, the board\'s settings, high scores and ranking initials are saved to the SD card when they change, and straight away on HOME, close or sleep.',
  'man.pathH3': 'Where things are saved',
  'man.pathTh1': 'File', 'man.pathTh2': 'SD card path',
  'man.titleId': 'title ID',
  'man.p1': 'Key config', 'man.p2': 'Backup RAM', 'man.p3': 'Quick saves',
  'man.p4': 'Launcher game files', 'man.p5': 'Launcher favorites',
  'man.pathP': 'The title ID comes from the romset (zip) name, so rebuilding from the same zip or starting the game from the launcher uses the same files.',
  'foot.manual': '3DS manual', 'foot.changelog': 'Changelog',
};

/* 언어는 URL이 정합니다: / 는 한국어, /en/ 은 영어 (#130 P4).
   런타임에 문구를 바꾸지 않으므로 스냅숏·localStorage·클릭 핸들러가 필요 없습니다.
   EN 표는 지금도 JS가 그리는 문구(예산·메모리·호환성 목록)가 씁니다. */
const LANG = document.documentElement.lang === 'en' ? 'en' : 'ko';

/** 지금 언어에 맞는 문구 (en이 없으면 넘긴 한국어를 그대로 씀) */
const t = (ko, en) => (LANG === 'en' ? en : ko);

/* 반대 언어판 힌트 (#130, #141). 브라우저의 첫 선호 언어가 이 페이지 언어와 다르면
   화면 아래에 한 줄로 알린다. 리다이렉트는 하지 않는다: 구글봇은 en-US로 렌더하므로
   / 를 /ko/ 로 넘기면 영문 페이지가 색인에서 밀린다 (hreflang이 그 역할을 대신한다). */
function offerOtherLocale() {
  /* 첫 번째 선호 언어만 본다: 한국어 사용자가 영문 페이지에 오면 ko 가 목록에 섞여 있어도
     (ko, ko-KR, en-KR 처럼) 힌트를 띄워야 한다. */
  const primary = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
  if (primary.startsWith(LANG)) return;
  const key = 'neo3ds-locale-hint-' + LANG;
  try { if (localStorage.getItem(key)) return; } catch (e) { /* private mode */ }

  const file = location.pathname.split('/').pop() || '';
  const page = file === 'index.html' ? '' : file;
  const ko = LANG === 'ko';
  const box = document.createElement('div');
  box.className = 'lang-note';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', ko ? 'English version' : '한국어판');
  box.innerHTML = `<p>${ko ? 'This page is in Korean.' : 'This page is in English.'}
    <a href="${ko ? '../' : 'ko/'}${page}">${ko ? 'Read it in English' : '한국어로 보기'}</a></p>
    <button type="button" aria-label="${ko ? 'Dismiss' : '닫기'}">×</button>`;
  box.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(key, '1'); } catch (e) { /* private mode */ }
    box.remove();
  });
  document.body.appendChild(box);
}
offerOtherLocale();


/* 게임 DB (호환성 섹션이 씀) + 해독 체인 표시 (호환성 상세) */
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

/* ══════════════════════════════════════════════════════════════════════
   5. 호환성 목록 (처음에는 12줄만)
   ════════════════════════════════════════════════════════════════════ */
const PAGE = 12;
const exList = $('#exList'), exDetail = $('#exDetail'), exFilters = $('#exFilters');
let filter = 'all', query = '', sort = 'default', page = 1, selected = null;

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

const narrow = matchMedia('(max-width: 1080px)');
const exListWrap = $('.ex-list-wrap');
const exPages = $('#exPages'), exCount = $('#exCount');

function renderList() {
  const rows = sorted(DB.games.filter(matches));
  if (selected && !rows.some((r) => r[0] === selected)) selected = null;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  page = Math.min(page, pages);
  const start = (page - 1) * PAGE;
  const visible = rows.slice(start, start + PAGE);
  exList.innerHTML = visible.map(([set, title, year, , mb, , st]) => {
    const badge = st === 1 ? `<span class="badge">${t('실기 확인', 'hardware')}</span>`
      : st === 2 ? `<span class="badge">${t('불가', 'no')}</span>` : '';
    return `<div class="ex-item" role="listitem" data-set="${set}"><button type="button" class="ex-row${selected === set ? ' sel' : ''}" data-st="${st}" data-set="${set}" title="${title}">
      <span class="ex-title"><span class="ex-name">${title}</span>${badge}</span>
      <span class="ex-set">${set}</span>
      <span class="ex-year">${year}</span>
      <span class="ex-size">${mb}MB</span></button></div>`;
  }).join('');
  renderPages(pages);
  const end = start + visible.length;
  exCount.textContent = rows.length
    ? t(`${start + 1}–${end} / ${rows.length}개`, `${start + 1}–${end} / ${rows.length}`)
    : t('0 / 0개', '0 / 0');
  $$('.ex-row', exList).forEach((b) => b.addEventListener('click', () => {
    selected = b.dataset.set;
    refresh();
  }));
}

function renderPages(pages) {
  exPages.classList.toggle('hidden', pages <= 1);
  if (pages <= 1) { exPages.innerHTML = ''; return; }
  const prev = `<button type="button" data-page="${page - 1}" aria-label="${t('이전 페이지', EN['games.prev'])}"${page === 1 ? ' disabled' : ''}>‹</button>`;
  const next = `<button type="button" data-page="${page + 1}" aria-label="${t('다음 페이지', EN['games.next'])}"${page === pages ? ' disabled' : ''}>›</button>`;
  const nums = [];
  let last = 0;
  [...new Set([1, pages, page - 1, page, page + 1])]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b)
    .forEach((n) => {
      if (n - last > 1) nums.push('<span class="ex-gap" aria-hidden="true">…</span>');
      nums.push(`<button type="button" data-page="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`);
      last = n;
    });
  exPages.innerHTML = prev + nums.join('') + next;
  $$('button', exPages).forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    page = Number(b.dataset.page);
    refresh();
    const top = exList.getBoundingClientRect().top + scrollY - 70;
    scrollTo({ top, behavior: 'auto' });
  }));
}

function renderDetail() {
  const row = selected ? bySet.get(selected) : null;
  if (!row) { exDetail.innerHTML = `<p class="tiny">${t('왼쪽에서 게임을 고르세요.', EN['ex.pick'])}</p>`; return; }
  const [set, title, year, maker, mb, chain, st, noteKo, noteEn, spriteMb] = row;
  const note = st === 2 ? t(noteKo, noteEn) : st === 1 ? t(noteKo, noteEn) : t('변환은 되지만 아직 실기에서 확인하지 않았습니다.', EN['ex.unverified']);
  const cta = st === 2 ? '' : `<a class="btn btn-primary btn-sm ex-cta" href="convert.html">${t('이 게임 CIA 만들기', EN['ex.cta'])}</a>`;
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
    <p class="note${st === 2 ? ' no' : ''}">${note}</p>${cta}`;
}

/* 넓은 화면은 오른쪽 고정 패널, 좁은 화면은 고른 행 아래로 상세를 옮긴다 (#149). */
function placeDetail() {
  const item = selected ? exList.querySelector(`.ex-item[data-set="${selected}"]`) : null;
  if (narrow.matches && item) {
    item.appendChild(exDetail);
  } else {
    exListWrap.insertAdjacentElement('afterend', exDetail);
  }
  exDetail.classList.toggle('hidden', narrow.matches && !item);
}

function refresh() {
  renderList();
  renderDetail();
  placeDetail();
}

function applyFilters() {
  $$('button', exFilters).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  page = 1;
  refresh();
}
if (exList) {
  $$('button', exFilters).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; applyFilters(); }));
  $('#exSearch').addEventListener('input', (e) => { query = e.target.value.trim(); page = 1; refresh(); });
  $('#exSort').addEventListener('change', (e) => { sort = e.target.value; page = 1; refresh(); });
  $('#cAll').textContent = DB.counts.total;
  $('#cVerified').textContent = DB.counts.verified;
  $('#cOk').textContent = DB.counts.ok;
  $('#cNo').textContent = DB.counts.no;
  narrow.addEventListener('change', placeDetail);
  if (DB.games.length) refresh();
}
})();
