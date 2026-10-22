// Preflight judgment for the batch list (#74): which dropped zips are
// convertible, using the same GameDb/pickGame rules as conversion. Kept out of
// worker.js so Node tests can exercise it against real romsets: callers pass
// the loaded GameDb and the RomSet class; files are File-like
// ({name, arrayBuffer()}).
import { L } from './lang.js';
import { pickGame } from './job.js';

// CiaBuilder.cs:129 is folder-based ("put it in the same folder"); the page
// drops files, so the KO wording says "drop it together with the game zip".
export const BIOS_MISSING = 'neogeo.zip (BIOS) not found. Drop it together with the game zip.';
const BIOS_MISSING_KO = 'neogeo.zip(바이오스)이 없습니다. 게임 zip과 함께 올리세요.';
export const biosMissing = (lang) => L(lang, BIOS_MISSING_KO, BIOS_MISSING);

// One row per game zip: {name, ok, title, problem}. The problem text is what
// conversion would throw, so the list and the log tell the same story.
// `lang` picks the reason text (KO page → KO reasons, #79).
// `onProgress(done, total, name)` (#81) drives the recognition bar; `total` is
// the number of game zips judged (neogeo.zip is checked once, not a row).
export async function preflight(db, RomSet, files, { lang = 'en', onProgress = null } = {}) {
  const bios = files.some((f) => f.name.toLowerCase() === 'neogeo.zip');
  const games = files.filter((f) => f.name.toLowerCase() !== 'neogeo.zip');
  const rows = [];
  onProgress?.(0, games.length, null);
  for (const f of games) {
    const zipName = f.name.replace(/\.zip$/i, '').toLowerCase();
    const known = db.find(zipName);
    const row = { name: f.name, ok: false, title: null, problem: null };
    try {
      const { game, problem } = await pickGame(db, RomSet, files, zipName, { lang });
      const label = game ?? known;
      if (label) row.title = db.title(label);
      if (!game) row.problem = problem;
      else if (!bios) row.problem = biosMissing(lang);
      else row.ok = true;
    } catch (err) {
      // Broken/unreadable zip: keep the technical detail but say it in the page language.
      if (known) row.title = db.title(known);
      const message = String(err?.message ?? err);
      row.problem = L(lang, `롬 zip을 읽지 못했습니다: ${message}`, message);
    }
    rows.push(row);
    onProgress?.(rows.length, games.length, f.name);
  }
  return rows;
}
