// Streaming ZIP writer (#387). The "download all" bundle used to be built by
// fflate's zipSync, which needs the whole archive in one ArrayBuffer: 159
// results (~7.5 GB for the full romset) is several times the browser's ~2 GiB
// Blob ceiling, so the download failed after a successful conversion.
//
// This writer produces the archive incrementally. Entries are already
// compressed (CIA / .neo3ds), so they are stored as-is, and each one takes two
// passes over its source: the first computes CRC32, the second streams the
// bytes. Knowing the CRC and size up front keeps data descriptors out of the
// archive, which every extractor reads without special cases.
//
// ZIP64 (8-byte sizes and offsets, ZIP64 end of central directory) is emitted
// whenever a field would not fit in 32 bits — with a 7.5 GB bundle the local
// header offsets cross 4 GiB, so this is the normal case, not an edge case.
import { crc32Update } from './crc32.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const ZIP64_EXTRA_ID = 0x0001;
// 4.5 is the version that introduced ZIP64; 2.0 is enough for a plain archive.
const VERSION_PLAIN = 20;
const VERSION_ZIP64 = 45;
const FLAG_UTF8 = 0x0800;

export class ZipSourceError extends TypeError {}

function w16(d, b, v) {
  d[b] = v & 0xff;
  d[b + 1] = (v >>> 8) & 0xff;
}

function w32(d, b, v) {
  d[b] = v & 0xff;
  d[b + 1] = (v >>> 8) & 0xff;
  d[b + 2] = (v >>> 16) & 0xff;
  d[b + 3] = (v >>> 24) & 0xff;
}

function w64(d, b, v) {
  w32(d, b, v >>> 0);
  w32(d, b + 4, Math.floor(v / 0x100000000) >>> 0);
}

// DOS date/time. ZIP stores year-1980 in 7 bits, so 1980..2107 is the range.
function dosStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// A source is whatever carries the entry bytes: a Blob/File (streamed, never
// buffered whole) or a Uint8Array (tests, callers that already have bytes).
// Any object with `size` and `stream()` counts, so Node tests can hand in a
// synthetic source larger than memory.
function sourceOf(entry) {
  const bytes = entry.bytes;
  if (bytes instanceof Uint8Array) {
    return { size: bytes.length, chunks: () => single(bytes) };
  }
  const source = entry.blob ?? entry.source;
  if (source && Number.isSafeInteger(source.size) && typeof source.stream === 'function')
    return { size: source.size, chunks: () => streamOf(source) };
  throw new ZipSourceError(
    `zip entry ${JSON.stringify(entry.name ?? '')} needs a Blob or a Uint8Array payload`);
}

async function* single(bytes) {
  if (bytes.length) yield bytes;
}

async function* streamOf(source) {
  const reader = source.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value?.length) yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

// Merge small reads (a Blob streams ~64 KiB at a time) into `size`-byte writes:
// a 7.5 GB archive would otherwise cost ~120k await round-trips.
async function* coalesce(chunks, size) {
  if (!size || size <= 0) { yield* chunks; return; }
  let buf = new Uint8Array(size);
  let n = 0;
  for await (const chunk of chunks) {
    if (chunk.length >= size) {
      if (n) { yield buf.slice(0, n); buf = new Uint8Array(size); n = 0; }
      yield chunk;
      continue;
    }
    if (n + chunk.length > size) {
      yield buf.slice(0, n);
      buf = new Uint8Array(size);
      n = 0;
    }
    buf.set(chunk, n);
    n += chunk.length;
  }
  if (n) yield buf.slice(0, n);
}

async function crcOf(chunks) {
  let crc = 0;
  for await (const chunk of chunks) crc = crc32Update(crc, chunk);
  return crc;
}

function localExtra(size, zip64Size) {
  if (!zip64Size) return null;
  const extra = new Uint8Array(20);
  w16(extra, 0, ZIP64_EXTRA_ID);
  w16(extra, 2, 16);
  w64(extra, 4, size);
  w64(extra, 12, size);
  return extra;
}

function centralExtra({ size, offset, zip64Size, zip64Offset }) {
  const fields = [];
  if (zip64Size) fields.push(size, size);
  if (zip64Offset) fields.push(offset);
  if (fields.length === 0) return null;
  const extra = new Uint8Array(4 + fields.length * 8);
  w16(extra, 0, ZIP64_EXTRA_ID);
  w16(extra, 2, fields.length * 8);
  for (let i = 0; i < fields.length; i++) w64(extra, 4 + i * 8, fields[i]);
  return extra;
}

function localHeader({ name, size, crc, zip64Size, stamp }) {
  const extra = localExtra(size, zip64Size);
  const head = new Uint8Array(30 + name.length + (extra ? extra.length : 0));
  w32(head, 0, SIG_LOCAL);
  w16(head, 4, zip64Size ? VERSION_ZIP64 : VERSION_PLAIN);
  w16(head, 6, FLAG_UTF8);
  w16(head, 8, 0); // stored: the payload is already compressed
  w16(head, 10, stamp.time);
  w16(head, 12, stamp.date);
  w32(head, 14, crc);
  w32(head, 18, zip64Size ? U32_MAX : size);
  w32(head, 22, zip64Size ? U32_MAX : size);
  w16(head, 26, name.length);
  w16(head, 28, extra ? extra.length : 0);
  head.set(name, 30);
  if (extra) head.set(extra, 30 + name.length);
  return head;
}

function centralRecord({ name, size, crc, offset, zip64Size, zip64Offset, stamp }) {
  const extra = centralExtra({ size, offset, zip64Size, zip64Offset });
  const rec = new Uint8Array(46 + name.length + (extra ? extra.length : 0));
  w32(rec, 0, SIG_CENTRAL);
  // "Made by" stays a plain 2.0 writer: the archive is produced by the simplest
  // implementation that can express it, and ZIP64 is only claimed where needed.
  w16(rec, 4, VERSION_PLAIN);
  w16(rec, 6, zip64Size || zip64Offset ? VERSION_ZIP64 : VERSION_PLAIN);
  w16(rec, 8, FLAG_UTF8);
  w16(rec, 10, 0);
  w16(rec, 12, stamp.time);
  w16(rec, 14, stamp.date);
  w32(rec, 16, crc);
  w32(rec, 20, zip64Size ? U32_MAX : size);
  w32(rec, 24, zip64Size ? U32_MAX : size);
  w16(rec, 28, name.length);
  w16(rec, 30, extra ? extra.length : 0);
  w16(rec, 32, 0); // comment length
  w16(rec, 34, 0); // disk number start
  w16(rec, 36, 0); // internal attributes
  w32(rec, 38, 0); // external attributes
  w32(rec, 42, zip64Offset ? U32_MAX : offset);
  rec.set(name, 46);
  if (extra) rec.set(extra, 46 + name.length);
  return rec;
}

function zip64End(count, cdSize, cdOffset) {
  const rec = new Uint8Array(56);
  w32(rec, 0, SIG_ZIP64_EOCD);
  w64(rec, 4, 44); // size of the record from this field to the end
  w16(rec, 12, VERSION_ZIP64);
  w16(rec, 14, VERSION_ZIP64);
  w32(rec, 16, 0); // this disk
  w32(rec, 20, 0); // disk with the central directory
  w64(rec, 24, count);
  w64(rec, 32, count);
  w64(rec, 40, cdSize);
  w64(rec, 48, cdOffset);
  return rec;
}

function zip64Locator(eocdOffset) {
  const rec = new Uint8Array(20);
  w32(rec, 0, SIG_ZIP64_LOCATOR);
  w32(rec, 4, 0); // disk with the ZIP64 EOCD
  w64(rec, 8, eocdOffset);
  w32(rec, 16, 1); // total disks
  return rec;
}

function endRecord({ count, cdSize, cdOffset, zip64 }) {
  const rec = new Uint8Array(22);
  w32(rec, 0, SIG_EOCD);
  w16(rec, 4, 0); // this disk
  w16(rec, 6, 0); // disk with the central directory
  w16(rec, 8, zip64 ? U16_MAX : count);
  w16(rec, 10, zip64 ? U16_MAX : count);
  w32(rec, 12, zip64 ? U32_MAX : cdSize);
  w32(rec, 16, zip64 ? U32_MAX : cdOffset);
  w16(rec, 20, 0); // comment length
  return rec;
}

// Entry names are UTF-8 and the header says so in both records. CP437 is a
// subset of UTF-8 for the names in play, so the flag is always safe to set.
function nameBytes(name) {
  return new TextEncoder().encode(name);
}

// Estimated archive bytes for one entry: local header + payload + central
// record, plus a little slack for the end records. `splitPlan` uses it to keep
// each part under a Blob ceiling, so over-estimating is the safe direction.
const END_SLACK = 98; // ZIP64 EOCD (56) + locator (20) + EOCD (22)
export function entrySize(entry) {
  const { size } = sourceOf(entry);
  const name = nameBytes(String(entry.name ?? '')).length;
  return size + 30 + name + 46 + name + END_SLACK;
}

// entries: [{ name, blob|file|source|bytes }] -> async iterable of Uint8Array.
//
// onProgress(doneBytes, totalBytes) fires while the payload streams; `chunkSize`
// is the coalesced write size (0 passes the source chunks through untouched).
export async function* zipChunks(entries, {
  chunkSize = 4 * 1024 * 1024,
  mtime = null,
  onProgress = null,
} = {}) {
  if (!Array.isArray(entries)) throw new ZipSourceError('zip entries must be an array');
  const stamp = dosStamp(mtime);
  const records = [];
  let offset = 0;
  const total = entries.reduce((n, entry) => n + sourceOf(entry).size, 0);
  let done = 0;

  for (const entry of entries) {
    const name = nameBytes(String(entry.name ?? ''));
    if (name.length === 0) throw new ZipSourceError('zip entry name must not be empty');
    if (name.length > 0xffff) throw new ZipSourceError(`zip entry name is too long: ${name.length} bytes`);
    const src = sourceOf(entry);
    const size = src.size;
    const crc = await crcOf(src.chunks());
    const zip64Size = size > U32_MAX;
    const head = localHeader({ name, size, crc, zip64Size, stamp });
    const start = offset;
    yield head;
    offset += head.length;
    for await (const chunk of coalesce(src.chunks(), chunkSize)) {
      yield chunk;
      offset += chunk.length;
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    }
    records.push({ name, size, crc, start, zip64Size });
    if (onProgress) onProgress(done, total);
  }

  const cdOffset = offset;
  for (const record of records) {
    const rec = centralRecord({
      name: record.name,
      size: record.size,
      crc: record.crc,
      offset: record.start,
      zip64Size: record.zip64Size,
      zip64Offset: record.start > U32_MAX,
      stamp,
    });
    yield rec;
    offset += rec.length;
  }
  const cdSize = offset - cdOffset;
  const count = records.length;
  const zip64 = count > U16_MAX || cdSize > U32_MAX || cdOffset > U32_MAX
    || records.some((r) => r.zip64Size || r.start > U32_MAX);
  if (zip64) {
    const eocd64 = zip64End(count, cdSize, cdOffset);
    yield eocd64;
    offset += eocd64.length;
    const locator = zip64Locator(offset - eocd64.length);
    yield locator;
    offset += locator.length;
  }
  yield endRecord({ count, cdSize, cdOffset, zip64 });
}
