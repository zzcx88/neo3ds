// Structured failure codes (#326). The module that hits the failure attaches
// the code where it happens; the page and analytics never parse an English
// message to guess a cause. The first throw wins: wrappers may keep a code but
// must not replace it with a coarser one.

export function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

// A worker error -> the stable code the page may display/report.
export function reasonCode(err) {
  if (typeof err?.code === 'string') return err.code;
  const message = String(err?.message ?? err);
  // Browsers word this differently per engine; both mean the run ran out of memory.
  if (/out of memory|allocation failed|cannot enlarge memory/i.test(message)) return 'oom';
  return 'unknown';
}

// pickGame's own verdicts (missing/unsupported/notromset) stay, and an OOM or a
// coded zip defect survives. Only an uncoded error — historically a zip the
// index reader could not open — keeps the old 'zip' label (#326, XMR ISSUE-004).
export function pickFailureCode(err) {
  const code = reasonCode(err);
  return code === 'unknown' ? 'zip' : code;
}
