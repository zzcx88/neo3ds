import initMakerom from './vendor/makerom.js';
import initBannertool from './vendor/bannertool.js';

// Phase 0 gate: pack a NEO3DS_KEEP folder into a CIA, fully in-browser.
// Static assets (engine.elf, neo3ds.rsf) are fetched from vendor/ — same origin, no upload.
const $ = (id) => document.getElementById(id);
const logEl = $('gateLog'), pipe = $('gatePipe');
const t = (ko, en) => (document.documentElement.lang === 'en' ? en : ko);
const log = (s) => { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };
const setStep = (name, cls) => {
  const li = pipe.querySelector(`[data-step="${name}"]`);
  if (li) { li.classList.remove('now', 'done'); if (cls) li.classList.add(cls); }
  const val = li?.querySelector('[data-pipe]');
  return (s) => { if (val) val.textContent = s; };
};

let files = new Map(); // relpath -> File
const drop = $('gateDrop'), input = $('gateDir'), runBtn = $('gateRun');

const need = ['romfs/meta.txt', 'romfs/game/c.pak', 'romfs/game/c.idx', 'icon.png', 'banner.png', 'banner.wav'];
function ingest(list) {
  files.clear();
  for (const f of list) {
    // webkitdirectory gives "kof98h-123/romfs/..." — strip the top folder
    const parts = f.webkitRelativePath ? f.webkitRelativePath.split('/') : [f.name];
    if (parts.length < 2) continue;
    files.set(parts.slice(1).join('/'), f);
  }
  const missing = need.filter((n) => !files.has(n));
  $('gateFile').textContent = missing.length === 0
    ? t(`${files.size}개 파일 준비됨`, `${files.size} files staged`)
    : t(`${files.size}개 (부족: ${missing.join(', ')})`, `${files.size} files (missing: ${missing.join(', ')})`);
  $('gateMeta').textContent = [...files.keys()].filter((k) => k.startsWith('romfs/')).length
    ? t('romfs 확인됨', 'romfs found') : '';
  runBtn.disabled = missing.length !== 0;
}
input.addEventListener('change', () => ingest(input.files));
for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => ingest([...e.dataTransfer.files].filter((f) => f.webkitRelativePath || f.name)));

const run = (mod, args) => {
  try { mod.callMain(args); }
  catch (e) { if (e.code !== 0 && e.status !== 0) throw new Error(`exit ${e.code ?? e.status}: ${args.join(' ')}`); }
};
const smdh = (s, max) => s.replaceAll('"', "'").slice(0, max);

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  $('gateDl').classList.add('hidden');
  logEl.textContent = '';
  const t0 = performance.now();
  try {
    // 1. stage
    const v1 = setStep('stage', 'now');
    log(t('[1/3] 파일 올리기', '[1/3] Staging files'));
    const bt = await initBannertool();
    const mr = await initMakerom();
    bt.FS.mkdirTree('/work');
    mr.FS.mkdirTree('/work/romfs');
    for (const [rel, f] of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (rel.startsWith('romfs/')) {
        mr.FS.mkdirTree('/work/' + rel.split('/').slice(0, -1).join('/'));
        mr.FS.writeFile('/work/' + rel, buf);
      } else {
        bt.FS.writeFile('/work/' + rel, buf);
      }
    }
    // meta.txt lives in makerom's fs (romfs/ side)
    const metaText = new TextDecoder().decode(mr.FS.readFile('/work/romfs/meta.txt'));
    const m = Object.fromEntries(metaText.trim().split('\n').map((l) => l.split(/: (.+)/)));
    const rom = m['rom'], title = m['title'], titleId = m['title id'], set = m['set'] || rom;
    const uniqueId = parseInt(titleId.slice(-8), 16) >>> 8;
    const product = ('NEO3DS-' + rom.toUpperCase()).slice(0, 16);
    // Publisher mirrors CiaBuilder: game?.Maker ?? "SNK" (CiaBuilder.cs:48)
    const dbRes = await fetch('vendor/neogeo_games.json');
    const publisher = dbRes.ok ? ((await dbRes.json()).find((x) => x.name === set)?.maker ?? 'SNK') : 'SNK';
    setStep('stage', 'done'); v1(t(`${files.size}개`, `${files.size} files`));
    log(t(`  롬: ${rom}, Title ID ${titleId}`, `  rom: ${rom}, Title ID ${titleId}`));

    // 2. art (bannertool)
    const v2 = setStep('art', 'now');
    log(t('[2/3] 아이콘·배너 생성', '[2/3] Making icon and banner'));
    run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
    run(bt, ['makesmdh', '-s', smdh(title, 64), '-l', smdh(title + ' (neo3ds)', 128),
      '-p', smdh(publisher, 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
    mr.FS.writeFile('/work/icon.icn', bt.FS.readFile('/work/icon.icn'));
    mr.FS.writeFile('/work/banner.bnr', bt.FS.readFile('/work/banner.bnr'));
    setStep('art', 'done'); v2('icn·bnr');

    // 3. cia (makerom)
    const v3 = setStep('cia', 'now');
    log(t(`[3/3] CIA 생성 (Title ID ${titleId})`, `[3/3] Building CIA (Title ID ${titleId})`));
    for (const f of ['neo3ds.rsf', 'engine.elf']) {
      const r = await fetch('vendor/' + f);
      if (!r.ok) throw new Error(`vendor/${f}: ${r.status}`);
      mr.FS.writeFile('/work/' + f, new Uint8Array(await r.arrayBuffer()));
    }
    run(mr, ['-f', 'cia', '-o', '/work/out.cia', '-target', 't', '-exefslogo',
      '-rsf', '/work/neo3ds.rsf', '-elf', '/work/engine.elf',
      '-icon', '/work/icon.icn', '-banner', '/work/banner.bnr',
      '-DAPP_TITLE=neo3ds', `-DAPP_PRODUCT_CODE=${product}`,
      `-DAPP_UNIQUE_ID=0x${uniqueId.toString(16).toUpperCase().padStart(5, '0')}`,
      '-DAPP_ROMFS=/work/romfs']);
    const cia = mr.FS.readFile('/work/out.cia');
    const blob = new Blob([cia], { type: 'application/octet-stream' });
    const dl = $('gateDl');
    if (dl.href) URL.revokeObjectURL(dl.href);
    dl.href = URL.createObjectURL(blob);
    dl.download = `${rom}-web.cia`;
    dl.classList.remove('hidden');
    const mb = (blob.size / 1048576).toFixed(1);
    setStep('cia', 'done'); v3(`${mb} MB`);
    log(t(`[완료] ${rom}-web.cia (${mb} MB, ${((performance.now() - t0) / 1000).toFixed(1)}초)`,
      `[Done] ${rom}-web.cia (${mb} MB, ${((performance.now() - t0) / 1000).toFixed(1)}s)`));
  } catch (e) {
    log(t(`실패: ${e.message}`, `Failed: ${e.message}`));
  } finally {
    runBtn.disabled = false;
  }
});
