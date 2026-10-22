// MVP page logic (#33): zip drop -> worker conversion -> CIA download.
// #74: 2+ game zips get a preflight game list before conversion, then per-row
// status. The pure list/status rules live in vendor/conv/batch.js (Node-tested).
import {
  createBatch, markRunning, markPending, markDone, markFailed, progress as rowProgress, summary, STATUS,
} from './vendor/conv/batch.js';

const $ = (id) => document.getElementById(id);
const logEl = $('gateLog'), pipe = $('gatePipe');
const t = (ko, en) => (document.documentElement.lang === 'en' ? en : ko);
const log = (s) => { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };

let files = [];
let worker = null, jobId = 0, running = false;
let preflightWorker = null, preflightId = 0, preflighting = false;
let batch = null, batchSource = null, batchFiles = null;
let batchStarted = false, batchError = '', readyIndexes = [];
const urls = new Set();

const drop = $('gateDrop'), input = $('gateZips'), runBtn = $('gateRun'), cancelBtn = $('gateCancel');
const batchPanel = $('gateBatchList'), batchRowsEl = $('gateBatchRows');
const batchCount = $('gateBatchCount'), batchMsg = $('gateBatchMsg'), batchSummary = $('gateBatchSummary');
const rowEls = new Map(); // batch index -> { li, state, detail, link }

function currentMode() {
  return document.querySelector('input[name="gateMode"]:checked')?.value ?? 'cia';
}

function gameZips() {
  return files.filter((f) => f.name.toLowerCase() !== 'neogeo.zip');
}

// Multi-game non-launcher runs get the preflight list; single-game and
// launcher runs keep their old flow untouched.
function wantsBatch() {
  return currentMode() !== 'launcher' && gameZips().length > 1;
}

/* ── ObjectURL bookkeeping (#74): every generated file URL is revoked when a
   new run starts, so repeated runs cannot leak blobs. ───────────────────── */
function makeUrl(bin) {
  const url = URL.createObjectURL(new Blob([bin], { type: 'application/octet-stream' }));
  urls.add(url);
  return url;
}

function revokeUrl(url) {
  if (url && urls.delete(url)) URL.revokeObjectURL(url);
}

function clearSingleLink() {
  const dl = $('gateDl');
  if (dl.dataset.url) { revokeUrl(dl.dataset.url); delete dl.dataset.url; }
  dl.removeAttribute('href');
  dl.classList.add('hidden');
}

function revokeAllUrls() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  clearSingleLink();
}

/* ── Preflight list ─────────────────────────────────────────────────────── */
function stopPreflight() {
  preflightId++; // invalidate messages from an older request
  if (preflightWorker) { preflightWorker.terminate(); preflightWorker = null; }
  preflighting = false;
}

function dropBatchModel() {
  if (batch) for (const row of batch) if (row.result?.url) revokeUrl(row.result.url);
  batch = null; batchSource = null; batchFiles = null;
  batchStarted = false; batchError = ''; readyIndexes = [];
}

function startPreflight() {
  stopPreflight();
  dropBatchModel();
  preflighting = true;
  renderBatch();
  refreshRun();
  const id = preflightId;
  const w = new Worker('vendor/conv/worker.js', { type: 'module' });
  preflightWorker = w;
  w.onerror = (e) => {
    if (id !== preflightId) return;
    stopPreflight();
    batchError = t(`목록을 읽지 못했습니다 (${e.message || 'worker error'})`,
      `Could not read the game list (${e.message || 'worker error'})`);
    renderBatch();
    refreshRun();
  };
  w.onmessage = (e) => {
    const m = e.data;
    if (id !== preflightId || m.id !== id) return;
    stopPreflight();
    if (m.type === 'preflight') {
      batchSource = m.rows;
      batch = createBatch(m.rows);
      batchFiles = files;
    } else if (m.type === 'error') {
      batchError = t(`목록 확인 실패: ${m.message}`, `Preflight failed: ${m.message}`);
    } else {
      batchError = t(`알 수 없는 응답: ${m.type}`, `Unexpected response: ${m.type}`);
    }
    renderBatch();
    refreshRun();
  };
  w.postMessage({ id, type: 'preflight', files });
}

// Called when the dropped files or the output mode change (never mid-run).
function syncBatch() {
  if (running) return;
  if (!wantsBatch()) { stopPreflight(); dropBatchModel(); renderBatch(); return; }
  if (batch && batchFiles === files && !preflighting && !batchError) { renderBatch(); return; }
  startPreflight();
}

/* ── Rendering the list / per-row status ───────────────────────────────── */
function stepLabel(step) {
  if (step === 'load') return t('롬셋 확인', 'Checking romset');
  if (step === 'romfs') return t('그래픽 압축', 'Compressing graphics');
  if (step === 'art') return t('아이콘·배너', 'Icon and banner');
  if (step === 'cia') return t('결과물 묶기', 'Packing output');
  return step ?? '';
}

function statusLabel(row) {
  if (row.status === STATUS.BLOCKED) return t('변환 불가', 'Not convertible');
  if (row.status === STATUS.RUNNING) return t('변환 중', 'Converting');
  if (row.status === STATUS.DONE) return t('완료', 'Done');
  if (row.status === STATUS.FAILED) return t('실패', 'Failed');
  return batchStarted ? t('대기', 'Pending') : t('변환 가능', 'Convertible');
}

function detailText(row) {
  if (row.status === STATUS.BLOCKED) return row.problem ?? '';
  if (row.status === STATUS.FAILED) return row.detail || row.problem || '';
  if (row.status === STATUS.RUNNING) {
    const step = stepLabel(row.step);
    if (!row.detail) return step;
    return step ? `${step} · ${row.detail}` : row.detail;
  }
  return '';
}

function summaryText(s) {
  const blocked = s.blocked ? t(` · 변환 불가 ${s.blocked}`, ` · ${s.blocked} not convertible`) : '';
  return t(
    `변환 가능 ${s.ready}개 중 성공 ${s.done} · 실패 ${s.failed}${blocked}`,
    `${s.done} done · ${s.failed} failed of ${s.ready} convertible${blocked}`,
  );
}

function paintRow(host, row) {
  host.li.dataset.status = row.status;
  host.state.textContent = statusLabel(row);
  host.detail.textContent = detailText(row);
  if (row.status === STATUS.DONE && row.result?.url) {
    host.link.href = row.result.url;
    host.link.download = row.result.name;
    host.link.textContent = `⬇ ${row.result.name} (${row.result.mb} MB)`;
    host.link.classList.remove('hidden');
  } else {
    host.link.classList.add('hidden');
    host.link.removeAttribute('href');
    host.link.textContent = '';
  }
}

function makeRow(row, index) {
  const li = document.createElement('li');
  li.className = 'batch-row';
  const head = document.createElement('div');
  head.className = 'batch-row-head';
  const name = document.createElement('span');
  name.className = 'batch-zip';
  name.textContent = row.name;
  const state = document.createElement('span');
  state.className = 'batch-state';
  head.append(name, state);
  const title = document.createElement('span');
  title.className = 'batch-title';
  title.textContent = row.title ?? t('게임을 인식하지 못함', 'Game not recognized');
  const detail = document.createElement('span');
  detail.className = 'batch-detail';
  const link = document.createElement('a');
  link.className = 'btn btn-ghost btn-sm batch-dl';
  li.append(head, title, detail, link);
  rowEls.set(index, { li, state, detail, link });
  paintRow(rowEls.get(index), row);
  return li;
}

function paintBatchHeader() {
  const s = summary(batch ?? []);
  batchCount.textContent = preflighting
    ? t('확인 중…', 'Checking…')
    : batch
      ? t(`${s.ready}/${s.total} 변환 가능`, `${s.ready}/${s.total} convertible`)
      : batchError ? t('확인 실패', 'Check failed') : '';
  batchMsg.textContent = preflighting
    ? t('롬셋과 바이오스를 확인하는 중…', 'Checking romsets and BIOS…')
    : batchError;
  batchMsg.classList.toggle('hidden', !(preflighting || batchError));
  const showSummary = !!batch && batchStarted;
  batchSummary.classList.toggle('hidden', !showSummary);
  if (showSummary) batchSummary.textContent = summaryText(s);
}

function updateRow(index) {
  if (!batch) return;
  const host = rowEls.get(index);
  if (host) paintRow(host, batch[index]);
}

function renderBatch() {
  batchPanel.classList.toggle('hidden', !wantsBatch());
  if (!wantsBatch()) {
    rowEls.clear();
    batchRowsEl.replaceChildren();
    return;
  }
  rowEls.clear();
  const frag = document.createDocumentFragment();
  (batch ?? []).forEach((row, i) => frag.appendChild(makeRow(row, i)));
  batchRowsEl.replaceChildren(frag);
  paintBatchHeader();
}

/* ── File intake / run button state ────────────────────────────────────── */
function ingest(list) {
  files = [...list].filter((f) => f.name.toLowerCase().endsWith('.zip'));
  if (!running) syncBatch();
  refreshRun();
}

function refreshRun() {
  const mode = currentMode();
  const hasBios = files.some((f) => f.name.toLowerCase() === 'neogeo.zip');
  const names = files.map((f) => f.name).join(', ');
  $('gateFile').textContent = files.length === 0
    ? t('zip을 올리세요', 'Drop zips')
    : `${files.length}개: ${names}`;
  $('gateMeta').textContent = files.length > 0 && !hasBios && mode !== 'launcher'
    ? t('neogeo.zip이 없습니다', 'neogeo.zip missing') : '';

  let disabled = running;
  if (mode !== 'launcher' && files.length === 0) disabled = true;
  if (mode !== 'launcher' && gameZips().length > 1) {
    if (preflighting || batchError || !batch || batchFiles !== files) disabled = true;
    else if (summary(batch).ready === 0) disabled = true;
  }
  runBtn.disabled = disabled;
}

document.querySelectorAll('input[name="gateMode"]').forEach((r) => r.addEventListener('change', () => {
  if (!running) syncBatch();
  refreshRun();
}));
{ // Deep-link: convert.html?mode=pack|launcher preselects the output (?mode=cia = default).
  const m = new URLSearchParams(location.search).get('mode');
  const radio = m && document.querySelector(`input[name="gateMode"][value="${m}"]`);
  if (radio) { radio.checked = true; syncBatch(); refreshRun(); }
}
input.addEventListener('change', () => ingest(input.files));
for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => ingest(e.dataTransfer.files));

// app.js owns the language switch; its click listener runs first, so re-render
// the dynamic list/summary in the new language.
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  if (wantsBatch()) renderBatch();
}));

/* ── 4-step pipe (unchanged) ───────────────────────────────────────────── */
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

function markRunningRowsFailed(message) {
  if (!batch) return;
  for (let i = 0; i < batch.length; i++) {
    if (batch[i].status === STATUS.RUNNING) markFailed(batch, i, message);
  }
  renderBatch();
}

/* ── Run ───────────────────────────────────────────────────────────────── */
runBtn.addEventListener('click', () => {
  const mode = currentMode();
  if (running || (files.length === 0 && mode !== 'launcher')) return;
  const isBatch = wantsBatch();
  if (isBatch && (!batch || batchFiles !== files || batchError || summary(batch).ready === 0)) return;

  running = true;
  runBtn.disabled = true;
  cancelBtn.classList.remove('hidden');
  revokeAllUrls(); // #74: a new run drops every previous per-game download URL
  $('gateStats').classList.add('hidden');
  logEl.textContent = '';
  resetPipe();

  if (isBatch) {
    batch = createBatch(batchSource);
    readyIndexes = batch.map((row, i) => (row.ok ? i : -1)).filter((i) => i >= 0);
    batchStarted = true;
    markRunning(batch, readyIndexes[0]);
    renderBatch();
    log(t(`배치 ${readyIndexes.length}종 시작`, `Batch start: ${readyIndexes.length} games`));
  }

  worker = new Worker('vendor/conv/worker.js', { type: 'module' });
  const id = ++jobId;
  worker.onerror = (e) => {
    markRunningRowsFailed(t('워커 오류', 'Worker error'));
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
      if (m.step === 'cia' && !vals.ciaLogged) { vals.ciaLogged = true; log(t(`[4/4] 결과물 묶기 (${m.detail})`, `[4/4] Packing output (${m.detail})`)); }
      if (isBatch && typeof m.batch === 'number') {
        const rowIndex = readyIndexes[m.batch];
        if (rowIndex != null) {
          markRunning(batch, rowIndex);
          rowProgress(batch, rowIndex, m.step, m.detail);
          updateRow(rowIndex);
        }
      }
    } else if (m.type === 'done') {
      finish();
      for (const s of ['load', 'romfs', 'art', 'cia']) setStep(s, 'done');
      showDownload(m.cia, downloadName(m.stats));
      showStats(m.stats);
      log(t(`[완료] ${downloadName(m.stats)} (${m.stats.ciaMB} MB, ${m.stats.secs}초)`,
        `[Done] ${downloadName(m.stats)} (${m.stats.ciaMB} MB, ${m.stats.secs}s)`));
      if (m.stats.tiles) log(t(`  타일 ${m.stats.tiles.toLocaleString()}개, 그래픽 ${m.stats.spriteRawMB}MB → ${m.stats.spritePackedMB}MB`,
        `  ${m.stats.tiles.toLocaleString()} tiles, graphics ${m.stats.spriteRawMB}MB → ${m.stats.spritePackedMB}MB`));
    } else if (m.type === 'batch-one') {
      if (!isBatch) return;
      const rowIndex = readyIndexes[m.batch];
      if (rowIndex == null) return;
      // One game done: keep a per-row link (auto-clicking N files gets blocked).
      const name = downloadName({ ...m.stats, mode });
      markDone(batch, rowIndex, { url: makeUrl(m.bin), name, mb: m.stats.ciaMB });
      updateRow(rowIndex);
      paintBatchHeader();
      log(t(`[완료] ${name} (${m.stats.ciaMB} MB)`, `[Done] ${name} (${m.stats.ciaMB} MB)`));
    } else if (m.type === 'batch-error') {
      if (!isBatch) return;
      const rowIndex = readyIndexes[m.index];
      if (rowIndex == null) return;
      markFailed(batch, rowIndex, m.message);
      updateRow(rowIndex);
      paintBatchHeader();
      log(t(`[실패] ${m.name}: ${m.message}`, `[Failed] ${m.name}: ${m.message}`));
    } else if (m.type === 'batch-done') {
      if (!isBatch) return;
      finish();
      for (const s of ['load', 'romfs', 'art', 'cia']) setStep(s, 'done');
      renderBatch();
      log(t(`배치 ${m.count}종 완료: 성공 ${m.ok} · 실패 ${m.failed} (${m.secs}초)`,
        `Batch finished: ${m.count} games — ${m.ok} done · ${m.failed} failed (${m.secs}s)`));
    } else if (m.type === 'error') {
      markRunningRowsFailed(m.message);
      finish();
      log(t(`실패: ${m.message}`, `Failed: ${m.message}`));
    }
  };
  worker.postMessage({
    id, files, region: $('gateRegion').value, system: $('gateSystem').value, mode,
    batch: isBatch ? readyIndexes.map((i) => ({ name: batch[i].name })) : null,
  });
});

function downloadName(stats) {
  const mode = stats.mode ?? currentMode();
  if (stats.rom === 'launcher') return 'neo3ds-launcher.cia';
  if (mode === 'pack') return `${stats.rom}.neo3ds`;
  return `${stats.rom}-web.cia`;
}

function showDownload(bin, name) {
  const dl = $('gateDl');
  clearSingleLink();
  const url = makeUrl(bin);
  dl.dataset.url = url;
  dl.href = url;
  dl.download = name;
  dl.classList.remove('hidden');
}

function showStats(stats) {
  const st = $('gateStats');
  const kind = (stats.mode ?? currentMode()) === 'pack' ? '.neo3ds' : 'CIA';
  st.textContent = t(
    `${kind} ${stats.ciaMB}MB · 메모리 ${stats.memMB ?? '?'}MB · 3DS 약 ${stats.totalMB}MB · ${stats.secs}초`,
    `${kind} ${stats.ciaMB}MB · memory ${stats.memMB ?? '?'}MB · 3DS ~${stats.totalMB}MB · ${stats.secs}s`,
  );
  st.classList.remove('hidden');
}

function finish() {
  running = false;
  cancelBtn.classList.add('hidden');
  if (worker) { worker.terminate(); worker = null; }
  syncBatch(); // refresh the list, or start a preflight for files changed mid-run
  refreshRun();
}

cancelBtn.addEventListener('click', () => {
  if (!running) return;
  if (batch) {
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].status === STATUS.RUNNING) markPending(batch, i);
    }
    renderBatch();
  }
  finish();
  log(t('취소됨', 'Cancelled'));
});
