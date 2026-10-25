// MVP page logic (#33): zip drop -> worker conversion -> CIA download.
// #74: 2+ game zips get a preflight game list before conversion, then per-row
// status. The pure list/status rules live in vendor/conv/batch.js (Node-tested).
// #75: a single CIA run previews the auto icon/banner and allows image overrides.
// #76: in the multi-game CIA list, clicking a row opens that game's art editor;
// each row keeps its own icon/banner Files (batch.js) for its own CIA.
// #81: determinate recognition/overall bars, progress focus, one ZIP for all.
import {
  createBatch, markRunning, markPending, markDone, markFailed, progress as rowProgress, summary,
  setArt, artLabel, artPayload, poolSize, STATUS,
} from './vendor/conv/batch.js';
import {
  iconPng, bannerPng, ICON_SIZE, BANNER_W, BANNER_H,
} from './vendor/conv/art.js';
import { zipResults } from './vendor/conv/bundle.js';
import { stageFraction, batchFraction, percentText } from './vendor/conv/progress.js';
import { uniqueEntryName } from './vendor/conv/bundle.js';

const $ = (id) => document.getElementById(id);
const logEl = $('gateLog'), pipe = $('gatePipe');
const isEn = () => document.documentElement.lang === 'en';
const t = (ko, en) => (isEn() ? en : ko);
// Worker reasons are fixed at preflight/run time, like log lines: send the
// language the page is in so a KO page gets KO reasons (#79).
const uiLang = () => (isEn() ? 'en' : 'ko');
const log = (s) => { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };

let files = [];
let rejectedFiles = 0; // non-zip drops ignored by ingest (#79): say so instead of nothing
let folderDropped = false; // folder drops arrive with no File entries; explain instead of silence
let workers = [], queue = [], jobId = 0, running = false, batchT0 = 0;
let preflightCancel = null, preflightSeq = 0, preflighting = false;
let batch = null, batchSource = null, batchFiles = null;
let batchStarted = false, batchError = '', readyIndexes = [];
let artEditor = null, artCancel = null;
let runInputs = null; // #81: {files, mode} the current run started with
let artBusy = false; // a picture is being decoded/validated before it can be applied
let artLoading = false, artLoadingFiles = null, artTitle = null, artTitleFiles = null, artProblem = null;
let selectedIndex = -1; // #76 batch row currently shown in #gateArt (-1 = list)
const urls = new Set();
let preflightProgress = null; // #81 {done,total} while the batch preflight runs
let overallView = null; // #81 {fraction, kind, index, ready, end} shown in #progress
let bundleBusy = false, bundleUrl = null, bundleSeq = 0; // #81 "download all" ZIP

const drop = $('gateDrop'), input = $('gateZips'), runBtn = $('gateRun'), cancelBtn = $('gateCancel');
const batchPanel = $('gateBatchList'), batchRowsEl = $('gateBatchRows');
const batchCount = $('gateBatchCount'), batchMsg = $('gateBatchMsg'), batchSummary = $('gateBatchSummary');
const artPanel = $('gateArt'), artTitleEl = $('gateArtTitle'), artMsgEl = $('gateArtMsg');
const artBack = $('gateArtBack'), artLock = $('gateArtLock');
const rowEls = new Map(); // batch index -> { li, state, detail, link, art, index }
const recogBox = $('gateBatchProg'), recogBar = $('gateBatchProgBar');
const recogFill = $('gateBatchProgFill'), recogText = $('gateBatchProgText');
const overallBox = $('gateOverall'), overallBar = $('gateOverallBar');
const overallFill = $('gateOverallFill'), overallText = $('gateOverallText');
const dlAllBtn = $('gateBatchAll');
const progressSection = $('progress'), progressH2 = $('gateProgH2');

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

// #81: the ZIP from "download all" is also an ObjectURL in `urls`, so a new
// run / file change revokes it. A build still running when that happens must
// not publish its URL afterwards, hence the generation counter.
function revokeBundleUrl() {
  if (bundleUrl) { revokeUrl(bundleUrl); bundleUrl = null; }
}

function cancelBundle() {
  bundleSeq++;
  bundleBusy = false;
  revokeBundleUrl();
}

function clearSingleLink() {
  const dl = $('gateDl');
  if (dl.dataset.url) { revokeUrl(dl.dataset.url); delete dl.dataset.url; }
  dl.removeAttribute('href');
  dl.classList.add('hidden');
}

function revokeAllUrls() {
  cancelBundle();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  clearSingleLink();
  paintBatchAll();
}

/* ── #75 single-game art preview / override ───────────────────────────────
   The editor is a small factory so #76 can mount the same two-row UI on a
   batch row: renderArtEditor(container, { title, art, onChange }). It draws
   the exact PNG bytes the worker passes to bannertool (single-IDAT merge). */
const ART_ROWS = {
  icon: { w: ICON_SIZE, h: ICON_SIZE, ko: '아이콘', en: 'Icon' },
  banner: { w: BANNER_W, h: BANNER_H, ko: '배너', en: 'Banner' },
};
const artEditors = new WeakMap();

function renderArtEditor(container, { title = '', art = null, onChange = null, locked, onBusy = null } = {}) {
  let ed = artEditors.get(container);
  if (!ed) {
    ed = createArtEditor(container, { onBusy });
    artEditors.set(container, ed);
  }
  ed.configure({ title, art, onChange, locked });
  return ed;
}

function createArtEditor(container, { onBusy = null } = {}) {
  const keys = Object.keys(ART_ROWS);
  const slots = {};
  const state = {
    title: '', icon: null, banner: null, onChange: null, locked: false, busy: false,
    gen: 0, onBusy, urls: { icon: null, banner: null },
  };

  for (const key of keys) {
    const row = container.querySelector(`[data-art="${key}"]`);
    if (!row) continue;
    const slot = {
      img: row.querySelector('.art-img'),
      input: row.querySelector('[data-art-file]'),
      pick: row.querySelector('[data-art-pick]'),
      clear: row.querySelector('[data-art-clear]'),
      note: row.querySelector('[data-art-note]'),
      token: 0,
      error: null,
    };
    slots[key] = slot;
    slot.pick?.addEventListener('click', () => slot.input?.click());
    slot.input?.addEventListener('change', () => {
      const file = slot.input.files?.[0] ?? null;
      slot.input.value = ''; // picking the same file again still fires change
      if (file) void choose(key, file);
    });
    slot.clear?.addEventListener('click', () => void choose(key, null));
  }

  function altText(key) {
    const { w, h, ko, en } = ART_ROWS[key];
    return t(`${ko} 미리보기 (${w}×${h})`, `${en} preview (${w}×${h})`);
  }

  function refreshNotes() {
    for (const key of keys) {
      const s = slots[key];
      if (!s) continue;
      s.note.classList.toggle('err', !!s.error);
      if (s.error) s.note.textContent = t(`이미지를 읽을 수 없습니다: ${s.error}`, `Cannot read image: ${s.error}`);
      else if (state[key]) s.note.textContent = t('직접 지정', 'Custom image');
      else s.note.textContent = state.title ? t('자동 생성', 'Automatic') : '';
    }
  }

  function setEnabled() {
    for (const key of keys) {
      const s = slots[key];
      if (!s) continue;
      const off = state.locked || state.busy || !state.title;
      s.pick.disabled = off;
      s.clear.disabled = off;
    }
  }

  function showPreview(key, bytes) {
    const s = slots[key];
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    if (state.urls[key]) URL.revokeObjectURL(state.urls[key]);
    state.urls[key] = url;
    s.img.src = url;
    s.img.alt = altText(key);
  }

  function clearPreview(key) {
    const s = slots[key];
    if (!s) return;
    s.token++;
    if (state.urls[key]) { URL.revokeObjectURL(state.urls[key]); state.urls[key] = null; }
    s.img.removeAttribute('src');
    s.img.alt = '';
  }

  async function draw(key) {
    const s = slots[key];
    if (!s || !state.title) return;
    const token = ++s.token;
    try {
      let bytes;
      if (state[key]) {
        const bmp = await createImageBitmap(state[key]);
        try {
          bytes = key === 'icon' ? await iconPng(state.title, bmp) : await bannerPng(state.title, bmp);
        } finally { bmp.close?.(); }
      } else {
        bytes = key === 'icon' ? await iconPng(state.title) : await bannerPng(state.title);
      }
      if (token === s.token) showPreview(key, bytes);
    } catch {
      if (token !== s.token) return;
      const file = state[key];
      state[key] = null;
      s.error = file?.name ?? null;
      refreshNotes();
      if (file) void draw(key); // fall back to the automatic picture
    }
  }

  async function choose(key, file) {
    const s = slots[key];
    if (!s || !state.title || state.locked || state.busy) return;
    const gen = state.gen;
    state.busy = true;
    setEnabled();
    state.onBusy?.(true);
    try {
      if (!file) {
        if (gen !== state.gen) return;
        state[key] = null;
        s.error = null;
        refreshNotes();
        state.onChange?.(selectedFiles());
        await draw(key);
        return;
      }
      let ok = false;
      try {
        const bmp = await createImageBitmap(file);
        ok = bmp.width > 0 && bmp.height > 0;
        bmp.close?.();
      } catch { ok = false; }
      // The editor can be re-pointed at another row while the decode runs:
      // drop the stale pick instead of applying it to the new row (#76 review).
      if (gen !== state.gen) return;
      if (ok) { state[key] = file; s.error = null; }
      else { state[key] = null; s.error = file.name; }
      refreshNotes();
      state.onChange?.(selectedFiles());
      await draw(key); // rejected image: redraw the automatic picture
    } finally {
      state.busy = false;
      setEnabled();
      state.onBusy?.(false);
    }
  }

  function selectedFiles() {
    return { icon: state.icon ?? null, banner: state.banner ?? null };
  }

  return {
    // Configure the one editor for whichever game is shown. `art` is applied
    // in the same pass as `title` (#75 review: setting art then changing the
    // title used to clear it), so switching rows redraws once with that row's
    // Files. `locked` disables both pickers while a conversion is running.
    configure({ title = '', art = null, onChange = null, locked = state.locked } = {}) {
      const next = title ?? '';
      const nextIcon = art?.icon ?? null;
      const nextBanner = art?.banner ?? null;
      const changed = next !== state.title || nextIcon !== state.icon || nextBanner !== state.banner;
      state.gen++; // invalidate any picture still decoding for the old row
      state.title = next;
      state.icon = nextIcon;
      state.banner = nextBanner;
      state.onChange = onChange ?? null;
      state.locked = !!locked;
      setEnabled();
      if (changed) {
        for (const key of keys) {
          if (!slots[key]) continue;
          slots[key].error = null;
          clearPreview(key);
        }
      }
      refreshNotes();
      if (changed && state.title) for (const key of keys) void draw(key);
    },
    setLocked(locked) {
      state.locked = !!locked;
      setEnabled();
    },
    refresh() {
      refreshNotes();
      for (const key of keys) if (slots[key] && state.urls[key]) slots[key].img.alt = altText(key);
    },
    getFiles: selectedFiles,
  };
}

function artEligible() {
  return currentMode() === 'cia' && gameZips().length === 1;
}

// Multi-game CIA list only: pack output has no icon/banner to edit.
function batchArtEligible() {
  return currentMode() === 'cia' && wantsBatch();
}

function stopArtTitle() {
  if (artCancel) { artCancel(); artCancel = null; }
  artLoading = false;
  artLoadingFiles = null;
}

function artProblemText() {
  if (!artProblem) return '';
  if (artProblem.kind === 'unknown') return t('게임을 인식하지 못해 아이콘·배너 미리보기를 만들 수 없습니다.',
    'Game not recognized, so the icon and banner preview cannot be built.');
  if (artProblem.kind === 'preview') return t('아이콘·배너 미리보기를 만들지 못했습니다.',
    'Could not build the icon and banner preview.');
  return t(`아이콘·배너 확인 실패: ${artProblem.detail}`, `Icon and banner check failed: ${artProblem.detail}`);
}

function renderArtMsg() {
  const text = artLoading
    ? t('게임 이름을 확인하는 중…', 'Checking the game title…')
    : artProblemText();
  artMsgEl.textContent = text;
  artMsgEl.classList.toggle('hidden', !text);
}

function startArtTitle() {
  stopArtTitle();
  artLoading = true;
  artLoadingFiles = files;
  artTitle = null; artTitleFiles = null; artProblem = null;
  artTitleEl.textContent = '';
  artEditor.configure({ title: '', art: null, locked: running, onChange: null });
  renderArtMsg();
  refreshArtLock();
  const myFiles = files;
  artCancel = runPreflight(myFiles, {
    onProgress(done, total) {
      if (!artLoading) return;
      artMsgEl.textContent = t(`게임 이름 확인 중… (${done}/${total})`, `Checking the game title… (${done}/${total})`);
      artMsgEl.classList.remove('hidden');
    },
    onRows(rows) {
      artLoading = false;
      artLoadingFiles = null;
      artTitle = rows?.[0]?.title ?? null;
      artProblem = artTitle ? null : { kind: 'unknown' };
      artTitleFiles = myFiles;
      artTitleEl.textContent = artTitle ?? '';
      artEditor.configure({ title: artTitle ?? '', art: null, locked: running, onChange: null });
      renderArtMsg();
      refreshArtLock();
    },
    onError(message, kind) {
      artLoading = false;
      artLoadingFiles = null;
      artProblem = kind === 'worker'
        ? { kind: 'preview', detail: message }
        : { kind: 'error', detail: message };
      artTitleFiles = myFiles;
      artTitle = null;
      artTitleEl.textContent = '';
      artEditor.configure({ title: '', art: null, locked: running, onChange: null });
      renderArtMsg();
      refreshArtLock();
    },
  });
}

/* ── #76 per-game art panel (one row at a time) ─────────────────────────── */
function artBadgeText(label) {
  if (label === 'icon+banner') return t('아이콘·배너 지정', 'Custom art');
  if (label === 'icon') return t('아이콘 지정', 'Custom icon');
  return t('배너 지정', 'Custom banner');
}

function canEditRow(row) {
  return batchArtEligible() && !!row?.ok && !running && !artBusy;
}

// A pick is decoded/validated off the main flow: keep Run and row switching
// inert until it lands, so a conversion cannot start with stale art.
function handleArtBusy(busy) {
  artBusy = !!busy;
  refreshRun();
  refreshArtLock();
}

function refreshArtLock() {
  const locked = running || artBusy;
  artLock.classList.toggle('hidden', !(locked && !artPanel.classList.contains('hidden')));
  artEditor.setLocked(locked);
}

function hideArtPanel() {
  artPanel.classList.add('hidden');
  artBack.classList.add('hidden');
  artLock.classList.add('hidden');
  artTitleEl.textContent = '';
}

function paintSelection() {
  for (const [i, host] of rowEls) {
    const selected = i === selectedIndex;
    host.li.dataset.selected = String(selected);
    if (host.li.getAttribute('role') === 'button') host.li.setAttribute('aria-pressed', String(selected));
  }
}

function showRowArt(index) {
  const row = batch?.[index];
  if (!row?.ok) return;
  artPanel.classList.remove('hidden');
  artBack.classList.remove('hidden');
  artTitleEl.textContent = row.title ?? '';
  artLoading = false;
  artLoadingFiles = null;
  artProblem = null;
  renderArtMsg();
  artEditor.configure({
    title: row.title ?? '',
    art: artPayload(row),
    locked: running,
    onChange: (chosen) => {
      if (index !== selectedIndex || running) return;
      setArt(batch, index, chosen);
      updateRow(index);
      paintSelection();
    },
  });
  refreshArtLock();
}

function selectRow(index) {
  if (!canEditRow(batch?.[index])) return;
  selectedIndex = index;
  paintSelection();
  showRowArt(index);
  artPanel.scrollIntoView?.({ block: 'nearest' });
}

function closeRowArt({ focus = false } = {}) {
  const prev = selectedIndex;
  selectedIndex = -1;
  paintSelection();
  hideArtPanel();
  artLoading = false;
  artLoadingFiles = null;
  artProblem = null;
  artEditor.configure({ title: '', art: null, locked: true, onChange: null });
  renderArtMsg();
  if (focus && prev >= 0) rowEls.get(prev)?.li.focus({ preventScroll: true });
}

// Single CIA: the panel shows the one game directly. Multi-game CIA: it shows
// the selected row (one at a time). Pack/launcher never show it.
function syncArt() {
  if (artEligible()) {
    artPanel.classList.remove('hidden');
    artBack.classList.add('hidden');
    refreshArtLock();
    if (artLoading && artLoadingFiles === files) { renderArtMsg(); return; }
    if (artTitleFiles === files) { renderArtMsg(); return; }
    startArtTitle();
    return;
  }
  if (batchArtEligible() && selectedIndex >= 0 && batch?.[selectedIndex]?.ok) {
    showRowArt(selectedIndex);
    return;
  }
  if (selectedIndex >= 0) { selectedIndex = -1; paintSelection(); }
  stopArtTitle();
  hideArtPanel();
  artTitle = null; artTitleFiles = null; artProblem = null;
  artEditor.configure({ title: '', art: null, locked: true, onChange: null });
  renderArtMsg();
}

artEditor = renderArtEditor(artPanel, { title: '', art: null, onChange: null, locked: true, onBusy: handleArtBusy });
artBack.addEventListener('click', () => { if (!artBusy) closeRowArt({ focus: true }); });

/* ── #81 recognition bar (done/total game zips) ────────────────────────── */
function paintPreflightProgress() {
  const total = Math.max(0, preflightProgress?.total ?? 0);
  const done = Math.max(0, Math.min(preflightProgress?.done ?? 0, total));
  const show = preflighting && total > 0;
  recogBox.classList.toggle('hidden', !show);
  const pct = show && total ? Math.round((done / total) * 100) : 0;
  recogFill.style.width = `${pct}%`;
  recogBar.setAttribute('aria-valuemax', String(show ? total : 0));
  recogBar.setAttribute('aria-valuenow', String(show ? done : 0));
  const label = show ? t(`인식 중 ${done}/${total}`, `Checking ${done}/${total}`) : '';
  if (show) recogText.textContent = label;
  recogBar.setAttribute('aria-valuetext', label);
}

/* ── Preflight worker protocol (batch list #74 + single title #75) ─────── */
// One helper for both callers: hand it files, get rows or a typed error back.
// The returned function cancels the request (worker terminated, no callback).
// #81: interleaved preflight-progress messages feed onProgress without ending
// the request (the final preflight/error payload still stops it).
function runPreflight(fileList, { onRows, onError, onProgress } = {}) {
  const id = ++preflightSeq;
  const w = new Worker('vendor/conv/worker.js', { type: 'module' });
  let done = false;
  const stop = () => {
    if (done) return false;
    done = true;
    w.terminate();
    return true;
  };
  w.onerror = (e) => {
    if (!stop()) return;
    onError?.(e.message || 'worker error', 'worker');
  };
  w.onmessage = (e) => {
    const m = e.data;
    if (done || m.id !== id) return;
    if (m.type === 'preflight-progress') {
      onProgress?.(m.done, m.total, m.name);
      return;
    }
    stop();
    if (m.type === 'preflight') onRows?.(Array.isArray(m.rows) ? m.rows : []);
    else if (m.type === 'error') onError?.(m.message, 'error');
    else onError?.(m.type, 'unexpected');
  };
  w.postMessage({ id, type: 'preflight', files: fileList, lang: uiLang() });
  return stop;
}

function stopPreflight() {
  if (preflightCancel) { preflightCancel(); preflightCancel = null; }
  preflighting = false;
  preflightProgress = null;
}

function dropBatchModel() {
  cancelBundle();
  if (batch) for (const row of batch) if (row.result?.url) revokeUrl(row.result.url);
  batch = null; batchSource = null; batchFiles = null;
  batchStarted = false; batchError = ''; readyIndexes = [];
  selectedIndex = -1;
}

function startPreflight() {
  stopPreflight();
  dropBatchModel();
  preflighting = true;
  preflightProgress = { done: 0, total: gameZips().length };
  renderBatch();
  refreshRun();
  preflightCancel = runPreflight(files, {
    onProgress(done, total) {
      preflightProgress = { done, total };
      paintBatchHeader();
    },
    onRows(rows) {
      preflighting = false;
      preflightProgress = null;
      batchSource = rows;
      batch = createBatch(rows);
      batchFiles = files;
      renderBatch();
      refreshRun();
    },
    onError(message, kind) {
      preflighting = false;
      preflightProgress = null;
      batchError = kind === 'worker'
        ? t(`목록을 읽지 못했습니다 (${message})`, `Could not read the game list (${message})`)
        : kind === 'error'
          ? t(`목록 확인 실패: ${message}`, `Preflight failed: ${message}`)
          : t(`알 수 없는 응답: ${message}`, `Unexpected response: ${message}`);
      renderBatch();
      refreshRun();
    },
  });
}

// Called when the dropped files or the output mode change (never mid-run).
function syncBatch() {
  if (running) return;
  if (!wantsBatch()) { stopPreflight(); dropBatchModel(); renderBatch(); return; }
  if (batch && batchFiles === files && !preflighting && !batchError) { renderBatch(); return; }
  startPreflight();
}

// One entry point for every files/mode/finish change: the list and the art
// panel must agree on whether they are visible and which row is selected.
function syncOutput() {
  syncBatch();
  syncArt();
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
  const label = artLabel(row);
  host.art.textContent = label ? artBadgeText(label) : '';
  host.art.classList.toggle('hidden', !label || !batchArtEligible());
  const interactive = !!row.ok && batchArtEligible();
  const selected = host.index === selectedIndex;
  host.li.dataset.selected = String(selected);
  host.li.dataset.edit = String(interactive && !running); // clickable only before a run
  if (interactive) {
    host.li.setAttribute('role', 'button');
    host.li.setAttribute('aria-pressed', String(selected));
    host.li.setAttribute('aria-disabled', String(running));
    host.li.tabIndex = running ? -1 : 0;
  } else {
    host.li.removeAttribute('role');
    host.li.removeAttribute('aria-pressed');
    host.li.removeAttribute('aria-disabled');
    host.li.tabIndex = -1;
  }
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
  const titleRow = document.createElement('div');
  titleRow.className = 'batch-row-title';
  const title = document.createElement('span');
  title.className = 'batch-title';
  title.textContent = row.title ?? t('게임을 인식하지 못함', 'Game not recognized');
  const art = document.createElement('span');
  art.className = 'batch-art hidden'; // paintRow shows it when the row has custom art
  titleRow.append(title, art);
  const detail = document.createElement('span');
  detail.className = 'batch-detail';
  const link = document.createElement('a');
  link.className = 'btn btn-ghost btn-sm batch-dl';
  li.append(head, titleRow, detail, link);
  li.addEventListener('click', (e) => {
    if (e.target.closest?.('a')) return; // download link, not row selection
    if (canEditRow(batch?.[index])) selectRow(index);
  });
  li.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest?.('a') || !canEditRow(batch?.[index])) return;
    e.preventDefault();
    selectRow(index);
  });
  rowEls.set(index, { li, state, detail, link, art, index });
  paintRow(rowEls.get(index), row);
  return li;
}

function paintBatchHeader() {
  const s = summary(batch ?? []);
  const hint = $('gateBatchHint');
  hint.textContent = batchArtEligible()
    ? t('변환하기 전에 확인하세요. 게임 줄을 누르면 그 게임의 아이콘·배너를 바꿀 수 있습니다. 변환 불가인 게임은 이유가 표시되고 건너뜁니다.',
      'Check before converting. Select a game row to change that game\'s icon and banner. Games that cannot be converted show why and are skipped.')
    : t('변환하기 전에 확인하세요. 변환 불가인 게임은 이유가 표시되고 건너뜁니다.',
      'Check before converting. Games that cannot be converted show why and are skipped.');
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
  paintPreflightProgress();
  paintBatchAll();
}

/* ── #81 one ZIP with every completed result (per-row links stay) ───────── */
function paintBatchAll() {
  const n = batch ? summary(batch).done : 0;
  const show = wantsBatch() && n > 0;
  dlAllBtn.classList.toggle('hidden', !show);
  dlAllBtn.disabled = show && bundleBusy;
  if (!show) { dlAllBtn.textContent = ''; return; }
  dlAllBtn.textContent = bundleBusy
    ? t('ZIP 만드는 중…', 'Building ZIP…')
    : t(`전체 다운로드 (${n})`, `Download all (${n})`);
}

async function downloadBatchZip() {
  if (bundleBusy || !wantsBatch()) return;
  const rows = (batch ?? []).filter((row) => row.status === STATUS.DONE && row.result?.url);
  if (rows.length === 0) return;
  const seq = ++bundleSeq;
  bundleBusy = true;
  paintBatchAll();
  try {
    const entries = [];
    const used = new Set();
    for (const row of rows) {
      const res = await fetch(row.result.url);
      if (seq !== bundleSeq) return; // new run / file change revoked the blobs
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      entries.push({ name: uniqueEntryName(row.result.name, used), bytes: new Uint8Array(await res.arrayBuffer()) });
      if (seq !== bundleSeq) return;
    }
    const bin = zipResults(entries);
    if (seq !== bundleSeq) return;
    revokeBundleUrl(); // a previous click's ZIP is superseded
    const url = makeUrl(bin);
    bundleUrl = url;
    const name = `neo3ds-batch-${rows.length}games.zip`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    log(t(`[ZIP] ${rows.length}개 결과를 ${name}로 묶었습니다`, `[ZIP] Bundled ${rows.length} results into ${name}`));
  } catch (err) {
    if (seq === bundleSeq) log(t(`[ZIP 실패] ${err?.message ?? err}`, `[ZIP failed] ${err?.message ?? err}`));
  } finally {
    if (seq === bundleSeq) {
      bundleBusy = false;
      paintBatchAll();
    }
  }
}

dlAllBtn.addEventListener('click', () => { void downloadBatchZip(); });

function updateRow(index) {
  if (!batch) return;
  const host = rowEls.get(index);
  if (host) paintRow(host, batch[index]);
  paintRowsScroll();
}

function renderBatch() {
  batchPanel.classList.toggle('hidden', !wantsBatch());
  if (!wantsBatch()) {
    rowEls.clear();
    batchRowsEl.replaceChildren();
    paintRowsScroll();
    paintBatchAll();
    return;
  }
  if (selectedIndex >= 0 && !batch?.[selectedIndex]?.ok) selectedIndex = -1;
  rowEls.clear();
  const frag = document.createDocumentFragment();
  (batch ?? []).forEach((row, i) => frag.appendChild(makeRow(row, i)));
  batchRowsEl.replaceChildren(frag);
  paintRowsScroll();
  paintBatchHeader();
}

/* #138: 5줄까지만 보이고 넘으면 목록 안에서 스크롤한다. 줄 높이가
   글꼴·이유 문구에 따라 달라지므로 실제 렌더된 높이로 상한을 잡는다. */
const ROWS_VISIBLE = 5;
function paintRowsScroll() {
  const rows = batchRowsEl.children;
  const first = rows[0];
  if (rows.length <= ROWS_VISIBLE || !first) {
    batchRowsEl.style.maxHeight = '';
    batchRowsEl.classList.remove('scroll');
    batchRowsEl.removeAttribute('tabindex');
    return;
  }
  const gap = parseFloat(getComputedStyle(batchRowsEl).rowGap) || 0;
  const h = first.getBoundingClientRect().height;
  batchRowsEl.style.maxHeight = `${Math.round(h * ROWS_VISIBLE + gap * (ROWS_VISIBLE - 1))}px`;
  batchRowsEl.classList.add('scroll');
  batchRowsEl.tabIndex = 0;
}

/* ── File intake / run button state ────────────────────────────────────── */
function ingest(list, { folder = false } = {}) {
  const dropped = [...list];
  files = dropped.filter((f) => f.name.toLowerCase().endsWith('.zip'));
  rejectedFiles = dropped.length - files.length;
  folderDropped = folder;
  if (!running) { resetOverall(); syncOutput(); }
  refreshRun();
}

function refreshRun() {
  const mode = currentMode();
  const hasBios = files.some((f) => f.name.toLowerCase() === 'neogeo.zip');
  const names = files.map((f) => f.name).join(', ');
  $('gateFile').textContent = files.length === 0
    ? t('zip을 올리세요', 'Drop zips')
    : `${files.length}개: ${names}`;
  const notes = [];
  if (folderDropped) {
    notes.push(t('폴더는 지원하지 않습니다. 폴더 안의 게임 zip을 올려 주세요.',
      'Folders are not supported. Drop the game zips inside it.'));
  }
  if (rejectedFiles > 0) {
    notes.push(t(`zip 파일만 지원합니다 (${rejectedFiles}개 제외)`,
      `Only .zip files are supported (${rejectedFiles} ignored)`));
  }
  if (files.length > 0 && !hasBios && mode !== 'launcher') notes.push(t('neogeo.zip이 없습니다', 'neogeo.zip missing'));
  $('gateMeta').textContent = notes.join(' · ');

  let disabled = running || artBusy;
  // Launcher CIA needs no game zip; every other mode needs at least one (a lone
  // neogeo.zip used to reach the worker and fail with an English error, #79).
  if (mode !== 'launcher' && gameZips().length === 0) disabled = true;
  if (mode !== 'launcher' && gameZips().length > 1) {
    if (preflighting || batchError || !batch || batchFiles !== files) disabled = true;
    else if (summary(batch).ready === 0) disabled = true;
  }
  runBtn.disabled = disabled;
}

document.querySelectorAll('input[name="gateMode"]').forEach((r) => r.addEventListener('change', () => {
  if (!running) { resetOverall(); syncOutput(); }
  refreshRun();
}));
{ // Deep-link: convert.html?mode=pack|launcher preselects the output (?mode=cia = default).
  const m = new URLSearchParams(location.search).get('mode');
  const radio = m && document.querySelector(`input[name="gateMode"][value="${m}"]`);
  if (radio) { radio.checked = true; syncOutput(); refreshRun(); }
}
syncOutput(); // initial state: no files -> everything hidden
input.addEventListener('change', () => ingest(input.files));
for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => {
  // A dropped folder has no File entries in Chrome/Firefox, so detect it from
  // the item list; otherwise it would disappear without any message (#79).
  const items = [...(e.dataTransfer.items ?? [])];
  const folder = items.some((it) => it.webkitGetAsEntry?.()?.isDirectory);
  ingest(e.dataTransfer.files, { folder });
});

// app.js owns the language switch; its click listener runs first, so re-render
// the dynamic list/summary in the new language. Preflight reasons are data
// fixed when the list was built (like log lines), so they keep their language.
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  if (wantsBatch()) renderBatch();
  renderOverall();
  refreshRun();
  artEditor.refresh();
  renderArtMsg();
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
  delete vals.loadLogged;
}

function markRunningRowsFailed(message) {
  if (!batch) return;
  for (let i = 0; i < batch.length; i++) {
    if (batch[i].status === STATUS.RUNNING) markFailed(batch, i, message);
  }
  renderBatch();
}

/* ── #81 overall progress bar + progress focus ────────────────────────── */
// single: stage progress of this game. batch: finished games plus every game
// in flight (#122: the page may run several workers at once). A batch stays
// ≤99% until finishBatchRun(), and a cancelled/errored run keeps its value.
function renderOverall() {
  if (!overallView) return;
  const f = Math.max(0, Math.min(1, Number(overallView.fraction) || 0));
  const pct = percentText(f);
  let label;
  if (overallView.end === 'cancel') label = t(`취소됨 · ${pct}`, `Cancelled · ${pct}`);
  else if (overallView.end === 'error') label = t(`중단됨 · ${pct}`, `Stopped · ${pct}`);
  else if (overallView.kind === 'batch') {
    const total = Math.max(1, overallView.ready);
    const finished = Math.min(total, Math.max(0, overallView.done));
    label = t(`완료 ${finished}/${total} · ${pct}`, `Done ${finished}/${total} · ${pct}`);
  } else {
    label = overallView.end === 'done' ? t(`완료 ${pct}`, `Done ${pct}`) : t(`변환 중 ${pct}`, `Converting ${pct}`);
  }
  const percent = Math.round(f * 100);
  overallText.textContent = label;
  overallBar.setAttribute('aria-valuenow', String(percent));
  overallBar.setAttribute('aria-valuetext', label);
  overallFill.style.width = `${percent}%`;
}

function resetOverall() {
  overallView = null;
  overallBox.classList.add('hidden');
  overallFill.style.width = '0%';
  overallBar.setAttribute('aria-valuenow', '0');
  overallBar.setAttribute('aria-valuetext', '');
}

function startOverall(isBatch, ready) {
  overallView = {
    fraction: 0, kind: isBatch ? 'batch' : 'single', ready: Math.max(1, ready),
    done: 0, running: new Map(), end: null,
  };
  overallBox.classList.remove('hidden');
  renderOverall();
}

function overallFractionNow() {
  return batchFraction({
    ready: overallView.ready, done: overallView.done, running: [...overallView.running.values()],
  });
}

// `row` is the batch row this message belongs to (single runs pass -1).
function updateOverallProgress(m, row = -1) {
  if (!overallView) return;
  if (overallView.kind === 'batch') {
    if (row >= 0) overallView.running.set(row, { step: m.step, frac: m.frac });
    overallView.fraction = overallFractionNow();
  } else {
    overallView.fraction = stageFraction(m.step, m.frac);
  }
  renderOverall();
}

// One batch row ended (done or failed): count that game as complete.
function finishOverallRow(index) {
  if (!overallView || overallView.kind !== 'batch') return;
  if (typeof index === 'number' && index >= 0) overallView.running.delete(index);
  overallView.done = Math.min(overallView.ready, overallView.done + 1);
  overallView.fraction = overallFractionNow();
  renderOverall();
}

function completeOverall() {
  if (!overallView) return;
  overallView.fraction = 1;
  if (overallView.kind === 'batch') {
    overallView.done = overallView.ready;
    overallView.running.clear();
    overallView.end = null;
  } else {
    overallView.end = 'done';
  }
  renderOverall();
}

function endOverall(kind) {
  if (!overallView) return;
  overallView.end = kind;
  renderOverall();
}

// #81: the run button scrolls to the progress section and puts focus on its
// heading, so keyboard/screen-reader users land on the live progress. The
// conversion never moves focus again.
function focusProgress() {
  if (!progressSection || !progressH2) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  progressSection.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  progressH2.focus({ preventScroll: true });
}

/* ── Run ───────────────────────────────────────────────────────────────── */
runBtn.addEventListener('click', () => {
  const mode = currentMode();
  if (running || artBusy || (files.length === 0 && mode !== 'launcher')) return;
  const isBatch = wantsBatch();
  if (isBatch && (!batch || batchFiles !== files || batchError || summary(batch).ready === 0)) return;

  focusProgress(); // #81: show the progress section without hunting for it
  running = true;
  runInputs = { files, mode };
  runBtn.disabled = true;
  cancelBtn.classList.remove('hidden');
  revokeAllUrls(); // #74: a new run drops every previous per-game download URL
  $('gateStats').classList.add('hidden');
  logEl.textContent = '';
  resetPipe();

  if (isBatch) {
    // Fresh statuses for this run, but keep every row's chosen picture (#76).
    const prevArt = new Map((batch ?? []).map((row) => [row.name, row.art]));
    batch = createBatch(batchSource);
    for (let i = 0; i < batch.length; i++) setArt(batch, i, prevArt.get(batch[i].name) ?? null);
    readyIndexes = batch.map((row, i) => (row.ok ? i : -1)).filter((i) => i >= 0);
    batchStarted = true;
    markRunning(batch, readyIndexes[0]);
    renderBatch();
    log(t(`배치 ${readyIndexes.length}종 시작`, `Batch start: ${readyIndexes.length} games`));
  }
  startOverall(isBatch, isBatch ? readyIndexes.length : 1);
  refreshArtLock(); // editing is only possible before the run starts

  workers = [];
  const base = {
    files, region: $('gateRegion').value, system: $('gateSystem').value, mode, lang: uiLang(),
    art: artEligible() ? artEditor.getFiles() : null,
  };
  if (isBatch) startBatchRun(base);
  else startSingleRun(base);
});

/* ── #122 worker pool ────────────────────────────────────────────────────
   One game per worker, the page owns the queue. A worker that finishes a game
   takes the next one instead of sitting idle, and the pool size comes from
   batch.js (memory first: each worker holds a whole romset, ~150MB peak). */
function spawnWorker(base) {
  const w = new Worker('vendor/conv/worker.js', { type: 'module' });
  w.base = base;
  w.job = null;
  w.onerror = (e) => workerFailed(w, e.message || 'load failed');
  w.onmessage = (e) => onWorkerMessage(w, e.data);
  workers.push(w);
  return w;
}

function isMobileBrowser() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && window.matchMedia?.('(pointer: coarse)')?.matches === true;
}

function startSingleRun(base) {
  const w = spawnWorker(base);
  w.single = true;
  w.job = { id: ++jobId, row: -1 };
  w.postMessage({ ...base, id: w.job.id, batch: null });
}

function startBatchRun(base) {
  queue = readyIndexes.slice();
  batchT0 = performance.now();
  const size = poolSize({
    ready: readyIndexes.length,
    cores: navigator.hardwareConcurrency ?? 2,
    memory: navigator.deviceMemory ?? null,
    mobile: isMobileBrowser(),
  });
  if (size > 1) log(t(`워커 ${size}개 병렬 변환`, `Converting with ${size} workers`));
  for (let i = 0; i < size; i++) spawnWorker(base);
  for (const w of workers) if (!pushJob(w)) break;
}

// Hand the next ready game to an idle worker; false when the queue is empty.
function pushJob(w) {
  const row = queue.shift();
  if (row == null) { w.job = null; return false; }
  w.job = { id: ++jobId, row };
  markRunning(batch, row);
  rowProgress(batch, row, 'load', '');
  updateRow(row);
  w.postMessage({
    ...w.base, id: w.job.id,
    batch: [{ name: batch[row].name, art: artPayload(batch[row]) }],
  });
  return true;
}

function jobFinished(w, job) {
  w.job = null;
  if (!running) return; // cancelled: finish() already terminated the pool
  if (pushJob(w)) return;
  if (workers.every((x) => x.job == null)) finishBatchRun();
}

// Every way a row can fail ends the same way: mark, redraw, count, log.
function failRow(row, message) {
  markFailed(batch, row, message);
  updateRow(row);
  finishOverallRow(row);
  paintBatchHeader();
  log(t(`[실패] ${batch[row]?.name}: ${message}`, `[Failed] ${batch[row]?.name}: ${message}`));
}

function finishBatchRun() {
  const s = summary(batch);
  const secs = ((performance.now() - batchT0) / 1000).toFixed(1);
  completeOverall();
  finish();
  for (const step of ['load', 'romfs', 'art', 'cia']) setStep(step, 'done');
  renderBatch();
  log(t(`배치 ${s.ready}종 완료: 성공 ${s.done} · 실패 ${s.failed} (${secs}초)`,
    `Batch finished: ${s.ready} games — ${s.done} done · ${s.failed} failed (${secs}s)`));
}

// A crashed worker loses its game (failed row) and is replaced while work is
// left, so one bad game cannot strand the rest of the queue.
function workerFailed(w, message) {
  const job = w.job;
  workers = workers.filter((x) => x !== w);
  try { w.terminate(); } catch { /* already gone */ }
  if (!running) return;
  if (w.single || job == null) {
    markRunningRowsFailed(t('워커 오류', 'Worker error'));
    endOverall('error');
    finish();
    log(t(`실패: 워커 오류 (${message})`, `Failed: worker error (${message})`));
    return;
  }
  failRow(job.row, message);
  if (queue.length) pushJob(spawnWorker(w.base));
  else if (workers.every((x) => x.job == null)) finishBatchRun();
}

const PIPE_ORDER = ['load', 'romfs', 'art', 'cia'];

// The 4-step pipe. With several games in flight the detail is prefixed with
// the game name so the numbers cannot be mistaken for one game's.
function pipeStep(m, row) {
  const idx = PIPE_ORDER.indexOf(m.step);
  if (idx < 0) return;
  const many = overallView?.kind === 'batch' && overallView.running.size > 1;
  const name = row >= 0 ? batch?.[row]?.name : null;
  const detail = many && name ? `${name}: ${m.detail}` : m.detail;
  PIPE_ORDER.forEach((s, i) => {
    if (i < idx) setStep(s, 'done');
    else if (i === idx) setStep(s, 'now', detail);
  });
  if (m.step === 'load' && !vals.loadLogged) { vals.loadLogged = true; log(t('[1/4] 롬셋 확인', '[1/4] Checking romset')); }
  if (m.step === 'romfs' && !vals.romfsLogged) { vals.romfsLogged = true; log(t('[2/4] 그래픽 압축', '[2/4] Compressing graphics')); }
  if (m.step === 'art' && !vals.artLogged) { vals.artLogged = true; log(t('[3/4] 아이콘·배너 생성', '[3/4] Making icon and banner')); }
  if (m.step === 'cia' && !vals.ciaLogged) { vals.ciaLogged = true; log(t(`[4/4] 결과물 묶기 (${m.detail})`, `[4/4] Packing output (${m.detail})`)); }
}

function onWorkerMessage(w, m) {
  const job = w.job;
  if (!job || m.id !== job.id) return;
  if (w.single) return onSingleMessage(m);
  const row = job.row;
  if (m.type === 'progress') {
    pipeStep(m, row);
    updateOverallProgress(m, row);
    rowProgress(batch, row, m.step, m.detail);
    updateRow(row);
  } else if (m.type === 'batch-one') {
    const name = downloadName({ ...m.stats, mode: currentMode() });
    markDone(batch, row, { url: makeUrl(m.bin), name, mb: m.stats.ciaMB });
    updateRow(row);
    finishOverallRow(row);
    paintBatchHeader();
    log(t(`[완료] ${name} (${m.stats.ciaMB} MB)`, `[Done] ${name} (${m.stats.ciaMB} MB)`));
    jobFinished(w, job);
  } else if (m.type === 'batch-error' || m.type === 'error') {
    failRow(row, m.message);
    jobFinished(w, job);
  }
  // batch-done carries no per-row news: jobFinished already ran for the game.
}

function onSingleMessage(m) {
  if (m.type === 'progress') {
    pipeStep(m, -1);
    updateOverallProgress(m);
  } else if (m.type === 'done') {
    completeOverall();
    finish();
    for (const s of ['load', 'romfs', 'art', 'cia']) setStep(s, 'done');
    showDownload(m.cia, downloadName(m.stats));
    showStats(m.stats);
    log(t(`[완료] ${downloadName(m.stats)} (${m.stats.ciaMB} MB, ${m.stats.secs}초)`,
      `[Done] ${downloadName(m.stats)} (${m.stats.ciaMB} MB, ${m.stats.secs}s)`));
    if (m.stats.tiles) log(t(`  타일 ${m.stats.tiles.toLocaleString()}개, 그래픽 ${m.stats.spriteRawMB}MB → ${m.stats.spritePackedMB}MB`,
      `  ${m.stats.tiles.toLocaleString()} tiles, graphics ${m.stats.spriteRawMB}MB → ${m.stats.spritePackedMB}MB`));
  } else if (m.type === 'error') {
    markRunningRowsFailed(m.message);
    endOverall('error');
    finish();
    log(t(`실패: ${m.message}`, `Failed: ${m.message}`));
  }
}

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
  for (const w of workers) { try { w.terminate(); } catch { /* already gone */ } }
  workers = [];
  queue = [];
  // A run that finished after its inputs changed must not leave its 100% bar
  // behind for the new file/mode selection (#81 review).
  if (runInputs && (files !== runInputs.files || currentMode() !== runInputs.mode)) resetOverall();
  runInputs = null;
  syncOutput(); // refresh the list, or start a preflight for files changed mid-run
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
  endOverall('cancel');
  finish();
  log(t('취소됨', 'Cancelled'));
});
