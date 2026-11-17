// ZIP bundling for the multi-game "download all" button (#81, streaming #387).
// Pure: no DOM, no File APIs, so Node tests can verify the exact entry names,
// bytes and ZIP records.
//
// The bundled files are finished CIA / .neo3ds outputs, already compressed, so
// they are stored as-is (level 0): deflating them again only costs time.
//
// #387: the old path built the whole archive in one Uint8Array. A successful
// 159-game run is ~7.5 GB, well past the ~2 GiB ceiling a browser puts on a
// single Blob/ArrayBuffer, so every large bundle failed at the last step. The
// archive is now produced incrementally (zipwrite.js) and either written
// straight to a file the user picks, or split into complete ZIPs below the
// ceiling on browsers without the save picker.
import { zipChunks, entrySize } from './zipwrite.js';

// Entry names come from row download names, but the bundler still refuses
// anything that could escape the archive or collide with another entry.
function checkName(name) {
  if (typeof name !== 'string' || name.length === 0)
    throw new Error('zip entry name must be a non-empty string');
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name))
    throw new Error(`zip entry name must be relative: ${name}`);
  if (name.includes('\\'))
    throw new Error(`zip entry name must not contain backslashes: ${name}`);
  if (/[\u0000-\u001f]/.test(name))
    throw new Error(`zip entry name must not contain control characters: ${JSON.stringify(name)}`);
  if (name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..'))
    throw new Error(`zip entry name is unsafe: ${name}`);
  return name;
}

// Keeps ZIP entry names unique when two results share a name (e.g. the same
// zip dropped twice, or two folders with the same file). `used` is owned by the
// caller: the first call adds `name`, later calls add " (2)", " (3)"… before the
// last extension. Pure so conv.test.mjs can pin the naming rule.
export function uniqueEntryName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const m = /^(.*?)(\.[^./]*)?$/.exec(name);
  const base = m[1];
  const ext = m[2] ?? '';
  for (let n = 2; ; n++) {
    const next = `${base} (${n})${ext}`;
    if (!used.has(next)) { used.add(next); return next; }
  }
}

// #387: browsers refuse a single Blob/ArrayBuffer above ~2 GiB (Chrome's blob
// quota is exactly 2 GiB; Firefox and Safari are memory-bound). A part is built
// as one Blob for the fallback download, so 1 GiB leaves room for the browser's
// own copies on a phone or a low-memory laptop.
export const PART_BYTES = 1024 * 1024 * 1024;

// entries: [{ name, blob|bytes|source }] -> [{ entries, bytes }]
// A part is a complete ZIP: splitting the *archive* by byte offset would hand
// the user unusable fragments, and every extractor needs the central directory.
// Order is preserved and each part gets at least one entry, so a single entry
// larger than `limit` still lands in its own part instead of looping.
export function splitPlan(entries, limit = PART_BYTES) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  if (entries.length === 0) throw new Error('at least one file is required');
  if (!(Number.isFinite(limit) && limit > 0)) throw new RangeError(`invalid part limit: ${limit}`);
  const parts = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    const bytes = entrySize(entry);
    if (current.length > 0 && size + bytes > limit) {
      parts.push({ entries: current, bytes: size });
      current = [];
      size = 0;
    }
    current.push(entry);
    size += bytes;
  }
  if (current.length) parts.push({ entries: current, bytes: size });
  return parts;
}

// Validates names/payloads and hands the list to the writer. Rejects an empty
// list, duplicate names, unsafe names and objects that carry no bytes.
function normalize(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('at least one file is required');
  const seen = new Set();
  return entries.map((entry) => {
    const name = checkName(entry?.name);
    if (seen.has(name)) throw new Error(`duplicate entry name: ${name}`);
    seen.add(name);
    if (!(entry.blob || entry.source || entry.bytes instanceof Uint8Array))
      throw new Error(`${name} needs Blob bytes`);
    return {
      name,
      blob: entry.blob ?? entry.source ?? null,
      bytes: entry.bytes instanceof Uint8Array ? entry.bytes : null,
    };
  });
}

// entries -> async iterable of Uint8Array chunks. `onProgress(done, total)` fires
// per written chunk; `chunkSize` coalesces small source reads.
export async function* zipBundle(entries, { chunkSize, onProgress, mtime } = {}) {
  yield* zipChunks(normalize(entries), { chunkSize, onProgress, mtime });
}

// The whole bundle as one Blob. `new Blob(parts)` copies references, not bytes,
// so this is only the browser's own blob storage: fine up to PART_BYTES, which
// is why the page asks for `splitPlan` first. Kept small and pure for tests.
export async function zipBlob(entries, options = {}) {
  const chunks = [];
  for await (const chunk of zipBundle(entries, options)) chunks.push(chunk);
  return new Blob(chunks, { type: 'application/zip' });
}

// Streams the bundle into an already-open FileSystemWritableFileStream
// (showSaveFilePicker / OPFS). Nothing larger than one chunk is ever held.
export async function writeZip(writable, entries, options = {}) {
  let written = 0;
  for await (const chunk of zipBundle(entries, options)) {
    await writable.write(chunk);
    written += chunk.length;
  }
  await writable.close();
  return written;
}

// File name for one part of a split bundle: bundle.zip, or bundle-part1of3.zip.
export function partName(base, index, count) {
  const safe = checkName(base);
  if (count <= 1) return safe;
  const m = /^(.*?)(\.[^./]*)?$/.exec(safe);
  return `${m[1]}-part${index + 1}of${count}${m[2] ?? ''}`;
}
