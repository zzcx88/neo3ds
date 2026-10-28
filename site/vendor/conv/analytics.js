// Web usage events for the converter (#125, extended #175). Pure: no DOM, no
// worker, no network, so Node tests pin the exact payloads. The page passes the
// Umami tracker into send(); a blocked script or a throwing track() is a no-op.
//
// Umami bills one pageview plus one event per stored property, so the whole
// extra contract is four events, and each carries one property: convert_start
// (mode, batch size folded into the value), convert_done (game), convert_fail
// (game + stage/reason folded into the value), convert_save (mode).

export const EVENT = Object.freeze({
  start: 'convert_start',
  done: 'convert_done',
  fail: 'convert_fail',
  save: 'convert_save',
});

const MODES = new Set(['cia', 'pack', 'launcher']);
const SAVE_MODES = new Set(['cia', 'pack', 'launcher', 'batch']);
// Last progress step the page saw, or 'worker' when none arrived.
const STAGES = new Set(['load', 'romfs', 'art', 'cia', 'worker']);
// Why the run failed, stable across languages: the worker's message is for
// humans, this code is for analytics (#175).
const REASONS = new Set([
  'nofile', // no game zip in the drop
  'bios', // neogeo.zip missing
  'notromset', // zip name is not a MAME Neo Geo romset
  'missing', // romset known, chips missing
  'unsupported', // protection chip / no AES build
  'zip', // zip unreadable or corrupt
  'image', // icon/banner could not be decoded
  'oom', // browser ran out of memory
  'wasm', // makerom/bannertool failed or did not load
  'crash', // worker died without a message
  'unknown',
]);
// Public catalog romset names only: lowercase MAME set names.
const SET_NAME = /^[a-z0-9_]{1,40}$/;

// Only a romset name from the public catalog may leave the tab. A user's zip
// file name (case, extension, spaces) or a path collapses to 'unknown'.
export function gameSet(value) {
  return typeof value === 'string' && SET_NAME.test(value) ? value : 'unknown';
}

// Batch size as a value, not a second property: the bucket tells adoption
// without paying one more event per run (#175).
export function batchBucket(count) {
  const n = Number(count) || 0;
  if (n <= 2) return '2';
  if (n <= 5) return '3-5';
  return '6+';
}

// The page knows whether the run is a batch; every other output keeps its mode.
export function startEvent(mode, batch = false, count = 0) {
  const value = batch ? `batch:${batchBucket(count)}` : MODES.has(mode) ? mode : 'cia';
  return { name: EVENT.start, data: { mode: value } };
}

export function doneEvent(set) {
  return { name: EVENT.done, data: { game: gameSet(set) } };
}

// `stage` is the last progress step the page saw, `code` the worker's reason.
// Both fold into one property: 'load/bios', 'romfs/oom', 'worker/crash' (#175).
export function failEvent(set, stage, code) {
  const step = STAGES.has(stage) ? stage : 'worker';
  const why = REASONS.has(code) ? `/${code}` : '';
  return { name: EVENT.fail, data: { game: gameSet(set), stage: step + why } };
}

// A finished run is not an install: this fires on the download click only.
export function saveEvent(mode) {
  return { name: EVENT.save, data: { mode: SAVE_MODES.has(mode) ? mode : 'cia' } };
}

// Caller-owned delivery: pass window.umami. Returns whether a call was
// attempted, but never throws — an ad blocker is not a site bug.
export function send(tracker, event) {
  if (!event || typeof tracker?.track !== 'function') return false;
  try {
    tracker.track(event.name, event.data);
    return true;
  } catch {
    return false;
  }
}
