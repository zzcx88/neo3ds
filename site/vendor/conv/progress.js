// Progress math for the web converter (#81). Pure: no DOM, no timers, so the
// page and conv.test.mjs share one definition of "how far along".
//
// The worker sends {step, frac} where `frac` is already normalized to one
// game's 0..1 timeline: load 0.05, romfs 0.1 + f*0.55, art 0.7, cia 0.85
// (pack 0.9). This table is the single place that maps a step + frac onto
// that timeline; it also floors a stale/missing frac at its stage start.

// [start, end] of each conversion stage within one game.
export const STAGES = Object.freeze({
  load: Object.freeze([0, 0.1]),
  romfs: Object.freeze([0.1, 0.7]),
  art: Object.freeze([0.7, 0.85]),
  cia: Object.freeze([0.85, 1]),
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function finiteOrNull(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// One game's 0..1 progress from a worker stage message. Unknown steps are 0 so
// a stray message cannot make the bar jump; fracs outside the stage window are
// clamped to it (the worker never sends them, but batches can arrive late).
export function stageFraction(step, frac = 0) {
  const span = STAGES[step];
  if (!span) return 0;
  const [start, end] = span;
  const f = finiteOrNull(frac);
  if (f === null) return start;
  return clamp(f, start, end);
}

// Batch: completed games + the current game's stage progress. Clamped to 0.99
// until the page sets the final 1 on batch-done, so an in-flight batch never
// claims to be finished. `index` is 0-based within the ready (convertible) set.
export function overallFraction({ ready = 1, index = 0, step = 'load', frac = 0 } = {}) {
  const totalN = finiteOrNull(ready);
  const total = totalN !== null && totalN >= 1 ? Math.trunc(totalN) : 1;
  const indexN = finiteOrNull(index);
  const i = clamp(indexN === null ? 0 : Math.trunc(indexN), 0, total - 1);
  return clamp((i + stageFraction(step, frac)) / total, 0, 0.99);
}

// Whole percent for labels and aria-valuenow. `overallFraction` stays ≤0.99
// until completion, so 100% only appears when the page explicitly finishes.
export function percentText(fraction = 0) {
  const f = finiteOrNull(fraction);
  return `${Math.round(clamp(f === null ? 0 : f, 0, 1) * 100)}%`;
}
