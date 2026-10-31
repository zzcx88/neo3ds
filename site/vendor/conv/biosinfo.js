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

const matchesEntry = (e, f) => e.usize > 0 && e.usize === f.size && e.crc === (f.crc >>> 0);
const matches = (entries, f) => entries.some((e) => matchesEntry(e, f));
const baseName = (p) => String(p).split('/').pop().toLowerCase();
// Name presence is enough to call a slot present-but-wrong even at size 0;
// CRC matching keeps its size>0 guard (a zero-byte chip is never a valid ROM).
const nameMatches = (entries, f) => entries.some((e) => baseName(e.name) === f.name.toLowerCase());
const UNIBIOS = /^uni-bios.*\.rom$/i;
const isUnibios = (e) => UNIBIOS.test(baseName(e.name));

const slotStatus = (entries, f) => {
  if (f == null) return 'missing';
  if (matches(entries, f)) return 'ok';
  return nameMatches(entries, f) ? 'mismatch' : 'missing';
};

export function biosProfile(zip, table = BIOS_TABLE) {
  const entries = zip.meta();
  const chips = table.chips ?? [];
  const present = [];
  const mismatch = [];
  for (const f of chips) {
    const status = slotStatus(entries, f);
    if (status === 'missing') continue;
    const item = { name: f.name, region: regionName(GameDb.regionOf(f), false) };
    if (status === 'ok') present.push(item);
    else mismatch.push(item);
  }
  const slots = [...chips, table.fix, table.zoom].filter(Boolean);
  const knownNames = new Set(slots.map((f) => f.name.toLowerCase()));
  // Unknown = entries this table cannot name at all. Known slot names with a
  // wrong CRC and UniBIOS files have their own rows, so they are not counted.
  const unknown = entries.filter((e) => e.usize > 0 && !isUnibios(e) &&
    !slots.some((f) => matchesEntry(e, f)) && !knownNames.has(baseName(e.name))).length;
  return {
    present: true,
    error: null,
    aes: present.filter((f) => GameDb.isAesBios(f)),
    mvs: present.filter((f) => !GameDb.isAesBios(f)),
    mismatch,
    sfix: slotStatus(entries, table.fix),
    lo: slotStatus(entries, table.zoom),
    unknown,
    unibios: entries.some(isUnibios),
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
