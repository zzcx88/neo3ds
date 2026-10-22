// Preflight judgment for the batch list (#74): which dropped zips are
// convertible, using the same GameDb/pickGame rules as conversion. Kept out of
// worker.js so Node tests can exercise it against real romsets: callers pass
// the loaded GameDb and the RomSet class; files are File-like
// ({name, arrayBuffer()}).
import { pickGame } from './job.js';

export const BIOS_MISSING = 'neogeo.zip (BIOS) not found. Drop it together with the game zip.';

// One row per game zip: {name, ok, title, problem}. The problem text is what
// conversion would throw, so the list and the log tell the same story.
// `onProgress(done, total, name)` (#81) drives the recognition bar; `total` is
// the number of game zips judged (neogeo.zip is checked once, not a row).
export async function preflight(db, RomSet, files, onProgress = null) {
  const bios = files.some((f) => f.name.toLowerCase() === 'neogeo.zip');
  const games = files.filter((f) => f.name.toLowerCase() !== 'neogeo.zip');
  const rows = [];
  onProgress?.(0, games.length, null);
  for (const f of games) {
    const zipName = f.name.replace(/\.zip$/i, '').toLowerCase();
    const known = db.find(zipName);
    const row = { name: f.name, ok: false, title: null, problem: null };
    try {
      const { game, problem } = await pickGame(db, RomSet, files, zipName);
      const label = game ?? known;
      if (label) row.title = db.title(label);
      if (!game) row.problem = problem;
      else if (!bios) row.problem = BIOS_MISSING;
      else row.ok = true;
    } catch (err) {
      if (known) row.title = db.title(known);
      row.problem = String(err?.message ?? err);
    }
    rows.push(row);
    onProgress?.(rows.length, games.length, f.name);
  }
  return rows;
}
