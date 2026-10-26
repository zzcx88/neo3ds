// Web usage events for the converter (#125). Pure: no DOM, no worker, no
// network, so Node tests pin the exact payloads. The page passes the Umami
// tracker into send(); a blocked script or a throwing track() is a no-op.
//
// Umami bills one pageview plus one event per stored property, so the whole
// extra contract is three events: convert_start(mode), convert_done(game),
// convert_fail(game, stage).

export const EVENT = Object.freeze({
  start: 'convert_start',
  done: 'convert_done',
  fail: 'convert_fail',
});

const MODES = new Set(['cia', 'batch', 'pack', 'launcher']);
const STAGES = new Set(['load', 'romfs', 'art', 'cia', 'worker']);
// Public catalog romset names only: lowercase MAME set names.
const SET_NAME = /^[a-z0-9_]{1,40}$/;

// Only a romset name from the public catalog may leave the tab. A user's zip
// file name (case, extension, spaces) or a path collapses to 'unknown'.
export function gameSet(value) {
  return typeof value === 'string' && SET_NAME.test(value) ? value : 'unknown';
}

// The page knows whether the run is a batch; every other output keeps its mode.
export function startEvent(mode, batch = false) {
  return { name: EVENT.start, data: { mode: batch ? 'batch' : MODES.has(mode) ? mode : 'cia' } };
}

export function doneEvent(set) {
  return { name: EVENT.done, data: { game: gameSet(set) } };
}

// `stage` is the last progress step the page saw. A worker that failed before
// posting any progress (script load, crash) is reported as 'worker'.
export function failEvent(set, stage) {
  return { name: EVENT.fail, data: { game: gameSet(set), stage: STAGES.has(stage) ? stage : 'worker' } };
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
