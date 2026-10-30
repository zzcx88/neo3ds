// BIOS profile for anonymous reports (#202). Index-only: matches the known
// chips in neogeo.zip by CRC+size from the central directory, never inflates
// an entry. The table is injectable so Node tests can use synthetic bytes;
// production uses GameDb's fixed BIOS list.
import { GameDb, regionName } from './gamedb.js';
import { openZipIndex } from './zipset.js';

export const BIOS_FILE = 'neogeo.zip';

export const BIOS_TABLE = Object.freeze({
  chips: GameDb.BIOS,
  fix: GameDb.BIOS_FIX,
  zoom: GameDb.ZOOM_TABLE,
});

const matches = (entries, f) => entries.some((e) =>
  e.usize > 0 && e.usize === f.size && e.crc === (f.crc >>> 0));

export function biosProfile(zip, table = BIOS_TABLE) {
  const entries = zip.meta();
  const present = (table.chips ?? [])
    .filter((f) => matches(entries, f))
    .map((f) => ({ name: f.name, region: regionName(GameDb.regionOf(f), false) }));
  const state = (f) => (f != null && matches(entries, f) ? 'ok' : 'missing');
  return {
    present: true,
    error: null,
    aes: present.filter((f) => GameDb.isAesBios(f)),
    mvs: present.filter((f) => !GameDb.isAesBios(f)),
    sfix: state(table.fix),
    lo: state(table.zoom),
  };
}

// files: dropped File-like objects. No BIOS → present:false; a corrupt zip is
// reported as present:true/error:'zip' instead of failing the whole preflight.
export async function readBiosProfile(files, table = BIOS_TABLE) {
  const file = (Array.isArray(files) ? files : [])
    .find((f) => String(f?.name ?? '').toLowerCase() === BIOS_FILE);
  if (!file) return { present: false };
  try {
    return biosProfile(await openZipIndex(file), table);
  } catch {
    return { present: true, error: 'zip' };
  }
}
