// Batch list/status model (#74). Pure: no DOM, no Worker, no File APIs, so the
// page and Node tests share the same rules. Rows start from the worker's
// preflight answer ({name, ok, title, rom, problem}); the page then feeds
// progress / batch-one / batch-error messages back through these helpers.
//
// Blocked rows keep STATUS.BLOCKED no matter what arrives later: only the
// page's ready subset is sent to the worker, and this module enforces it too.

export const STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

const at = (batch, i) => (Array.isArray(batch) && i >= 0 && i < batch.length ? batch[i] : null);

export function createBatch(rows = []) {
  return rows.map((r) => ({
    name: r.name,
    title: r.title ?? null,
    ok: !!r.ok,
    problem: r.ok ? null : (r.problem ?? ''),
    status: r.ok ? STATUS.PENDING : STATUS.BLOCKED,
    step: null,
    detail: '',
    result: null,
    // #76: per-game icon/banner Files. A null slot keeps the automatic picture.
    art: { icon: null, banner: null },
  }));
}

/* ── #76 per-row icon/banner choice ───────────────────────────────────────
   The page owns the File objects picked for one row; this module only keeps
   them next to the row so a re-render, progress update or cancel cannot drop
   them. Blocked rows never run, so their art stays automatic. */
export function setArt(batch, i, art = null) {
  const row = at(batch, i);
  if (row?.ok) row.art = { icon: art?.icon ?? null, banner: art?.banner ?? null };
  return batch;
}

export function clearArt(batch, i) {
  return setArt(batch, i, null);
}

// Which slots are user pictures: '' (automatic), 'icon', 'banner', 'icon+banner'.
export function artLabel(row) {
  const icon = !!row?.art?.icon, banner = !!row?.art?.banner;
  if (icon && banner) return 'icon+banner';
  if (icon) return 'icon';
  if (banner) return 'banner';
  return '';
}

export function hasArt(row) {
  return artLabel(row) !== '';
}

// Conversion message entry: null when the row is automatic (or blocked), so
// the worker takes exactly the old automatic-art path.
export function artPayload(row) {
  if (!row?.ok || !hasArt(row)) return null;
  return { icon: row.art.icon ?? null, banner: row.art.banner ?? null };
}

export function markRunning(batch, i) {
  const row = at(batch, i);
  if (row?.ok && row.status === STATUS.PENDING) row.status = STATUS.RUNNING;
  return batch;
}

// Progress for one row while it converts. `step` is the worker's 4-step name
// (load/romfs/art/cia) so the page can show which step the row is on.
export function progress(batch, i, step, detail = '') {
  const row = at(batch, i);
  if (row?.ok && row.status !== STATUS.DONE && row.status !== STATUS.FAILED) {
    row.status = STATUS.RUNNING;
    row.step = step;
    row.detail = detail;
  }
  return batch;
}

// A running row goes back to pending when the run is cancelled: nothing was
// produced for it, so it must not be counted as a failure in the summary.
export function markPending(batch, i) {
  const row = at(batch, i);
  if (row?.ok && row.status === STATUS.RUNNING) {
    row.status = STATUS.PENDING;
    row.step = null;
    row.detail = '';
    row.result = null;
  }
  return batch;
}

// `result` is page-owned (download URL, file name, size): the pure model only
// carries it so a re-render keeps per-game links.
export function markDone(batch, i, result = null) {
  const row = at(batch, i);
  if (row?.ok && row.status !== STATUS.FAILED) {
    row.status = STATUS.DONE;
    row.step = null;
    row.detail = '';
    row.result = result;
  }
  return batch;
}

export function markFailed(batch, i, message) {
  const row = at(batch, i);
  if (row?.ok && row.status !== STATUS.DONE) {
    row.status = STATUS.FAILED;
    row.step = null;
    row.detail = String(message ?? '');
    row.result = null;
  }
  return batch;
}

// Counts for the list header and the final success/fail summary.
export function summary(batch = []) {
  const s = {
    total: batch.length, ready: 0, blocked: 0,
    done: 0, failed: 0, running: 0, finished: 0,
  };
  for (const row of batch) {
    if (row.ok) s.ready++;
    else s.blocked++;
    if (row.status === STATUS.DONE) s.done++;
    else if (row.status === STATUS.FAILED) s.failed++;
    else if (row.status === STATUS.RUNNING) s.running++;
  }
  s.finished = s.done + s.failed;
  return s;
}
