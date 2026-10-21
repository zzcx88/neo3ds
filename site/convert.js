// MVP page logic (#33): zip drop -> worker conversion -> CIA download.
const $ = (id) => document.getElementById(id);
const logEl = $('gateLog'), pipe = $('gatePipe');
const t = (ko, en) => (document.documentElement.lang === 'en' ? en : ko);
const log = (s) => { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };

let files = [];
let worker = null, jobId = 0, running = false;
const drop = $('gateDrop'), input = $('gateZips'), runBtn = $('gateRun'), cancelBtn = $('gateCancel');

function ingest(list) {
  files = [...list].filter((f) => f.name.toLowerCase().endsWith('.zip'));
  const hasBios = files.some((f) => f.name.toLowerCase() === 'neogeo.zip');
  const names = files.map((f) => f.name).join(', ');
  $('gateFile').textContent = files.length === 0
    ? t('zip을 올리세요', 'Drop zips')
    : `${files.length}개: ${names}`;
  $('gateMeta').textContent = files.length > 0 && !hasBios ? t('neogeo.zip이 없습니다', 'neogeo.zip missing') : '';
  runBtn.disabled = files.length === 0 || running;
}
input.addEventListener('change', () => ingest(input.files));
for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => ingest(e.dataTransfer.files));

const vals = {};
function setStep(name, cls, val = null) {
  const li = pipe.querySelector(`[data-step="${name}"]`);
  if (!li) return;
  if (cls === 'reset') li.classList.remove('now', 'done');
  else if (cls) { li.classList.remove('now', 'done'); li.classList.add(cls); }
  if (val !== null) {
    const v = li.querySelector('[data-pipe]');
    if (v) v.textContent = val;
  }
  vals[name] = val ?? vals[name];
}

function resetPipe() {
  for (const s of ['load', 'romfs', 'art', 'cia']) {
    setStep(s, 'reset');
    const v = pipe.querySelector(`[data-step="${s}"] [data-pipe]`);
    if (v) v.textContent = '';
    delete vals[s];
  }
  delete vals.romfsLogged; delete vals.artLogged; delete vals.ciaLogged;
}

runBtn.addEventListener('click', () => {
  if (running || files.length === 0) return;
  running = true;
  runBtn.disabled = true;
  cancelBtn.classList.remove('hidden');
  $('gateDl').classList.add('hidden');
  $('gateStats').classList.add('hidden');
  logEl.textContent = '';
  resetPipe();
  worker = new Worker('vendor/conv/worker.js', { type: 'module' });
  const id = ++jobId;
  worker.onerror = (e) => {
    finish();
    log(t(`실패: 워커 오류 (${e.message || 'load failed'})`, `Failed: worker error (${e.message || 'load failed'})`));
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.type === 'progress') {
      const order = ['load', 'romfs', 'art', 'cia'];
      const idx = order.indexOf(m.step);
      order.forEach((s, i) => {
        if (i < idx) setStep(s, 'done');
        else if (i === idx) setStep(s, 'now', m.detail);
      });
      if (m.step === 'load' && m.frac === 0) log(t('[1/4] 롬셋 확인', '[1/4] Checking romset'));
      if (m.step === 'romfs' && !vals.romfsLogged) { vals.romfsLogged = true; log(t('[2/4] 그래픽 압축', '[2/4] Compressing graphics')); }
      if (m.step === 'art' && !vals.artLogged) { vals.artLogged = true; log(t('[3/4] 아이콘·배너 생성', '[3/4] Making icon and banner')); }
      if (m.step === 'cia' && !vals.ciaLogged) { vals.ciaLogged = true; log(t(`[4/4] CIA 생성 (${m.detail})`, `[4/4] Building CIA (${m.detail})`)); }
    } else if (m.type === 'done') {
      finish();
      for (const s of ['load', 'romfs', 'art', 'cia']) setStep(s, 'done');
      const dl = $('gateDl');
      if (dl.href) URL.revokeObjectURL(dl.href);
      dl.href = URL.createObjectURL(new Blob([m.cia], { type: 'application/octet-stream' }));
      dl.download = `${m.stats.rom}-web.cia`;
      dl.classList.remove('hidden');
      const st = $('gateStats');
      st.textContent = t(
        `CIA ${m.stats.ciaMB}MB · 메모리 ${m.stats.memMB ?? '?'}MB · 3DS 약 ${m.stats.totalMB}MB · ${m.stats.secs}초`,
        `CIA ${m.stats.ciaMB}MB · memory ${m.stats.memMB ?? '?'}MB · 3DS ~${m.stats.totalMB}MB · ${m.stats.secs}s`,
      );
      st.classList.remove('hidden');
      log(t(`[완료] ${m.stats.rom}-web.cia (${m.stats.ciaMB} MB, ${m.stats.secs}초)`,
        `[Done] ${m.stats.rom}-web.cia (${m.stats.ciaMB} MB, ${m.stats.secs}s)`));
      log(t(`  타일 ${m.stats.tiles.toLocaleString()}개, 그래픽 ${m.stats.spriteRawMB}MB → ${m.stats.spritePackedMB}MB`,
        `  ${m.stats.tiles.toLocaleString()} tiles, graphics ${m.stats.spriteRawMB}MB → ${m.stats.spritePackedMB}MB`));
    } else if (m.type === 'error') {
      finish();
      log(t(`실패: ${m.message}`, `Failed: ${m.message}`));
    }
  };
  worker.postMessage({ id, files, region: $('gateRegion').value, system: $('gateSystem').value });
});

function finish() {
  running = false;
  runBtn.disabled = files.length === 0;
  cancelBtn.classList.add('hidden');
  if (worker) { worker.terminate(); worker = null; }
}

cancelBtn.addEventListener('click', () => {
  if (!running) return;
  finish();
  log(t('취소됨', 'Cancelled'));
});
