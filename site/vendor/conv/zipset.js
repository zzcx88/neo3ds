// RomSet/ZipSet port (RomPack.cs:265-362) over the ZIP central directory (#121).
// Chips are found by CRC first, then by name — same rule as C#. The C# side reads
// `ZipArchiveEntry.Crc32`, i.e. the central directory; this port used to inflate
// every entry and recompute the CRC in JS (92 MB -> 1.75s per zip). Now the
// directory alone builds the index and entry bytes are inflated on first read.
import { inflateSync } from './fflate.js';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_READ = 22 + 0xFFFF + 1; // EOCD + longest comment

// A zip source is {name, size, read(offset, length) -> Uint8Array|Promise<Uint8Array>}.
// In the browser that is a File (only the tail and the central directory are
// read); node and tests pass bytes.
export function bytesSource(name, bytes) {
  return { name, size: bytes.length, read: (offset, length) => bytes.subarray(offset, offset + length) };
}

// File objects answer slice()/arrayBuffer(): the browser path never loads the
// whole zip unless an entry is actually read.
function fileSource(f) {
  return {
    name: f.name,
    size: f.size,
    read: async (offset, length) => new Uint8Array(await f.slice(offset, offset + length).arrayBuffer()),
  };
}

async function sourceOf(p) {
  if (typeof p === 'string') {
    const { readFileSync } = await import('node:fs');
    return bytesSource(p.split('/').pop(), new Uint8Array(readFileSync(p)));
  }
  if (typeof p?.size === 'number' && typeof p.slice === 'function') return fileSource(p);
  if (typeof p?.arrayBuffer === 'function') return bytesSource(p.name, new Uint8Array(await p.arrayBuffer()));
  if (p?.bytes instanceof Uint8Array) return bytesSource(p.name, p.bytes);
  if (p?.data instanceof Uint8Array) return bytesSource(p.name, p.data);
  throw new Error(`${p?.name ?? p}: not a zip source`);
}

function zipError(name, what) {
  return new Error(`${name}: ${what}`);
}

// Central directory -> [{name, crc, csize, usize, method, flags, localOffset}].
// Throws on anything this reader will not handle (zip64, multi-disk, no EOCD),
// which preflight surfaces as "cannot read the rom zip".
async function readIndex(source) {
  const { name, size } = source;
  if (size < EOCD_MIN) throw zipError(name, 'not a zip archive');
  const tailLen = Math.min(size, EOCD_READ);
  const tailStart = size - tailLen;
  const tail = await source.read(tailStart, tailLen);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.length);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (dv.getUint32(i, true) !== SIG_EOCD) continue;
    // the record must end the file: comment length has to account for the rest
    if (i + EOCD_MIN + dv.getUint16(i + 20, true) === tail.length) { eocd = i; break; }
  }
  if (eocd < 0) throw zipError(name, 'not a zip archive (no end of central directory)');
  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0) throw zipError(name, 'multi-disk zips are not supported');
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF)
    throw zipError(name, 'zip64 is not supported');
  if (cdOffset + cdSize > size) throw zipError(name, 'central directory is truncated');

  let cd;
  const tailCoversCd = cdOffset >= tailStart && cdOffset + cdSize <= size;
  if (tailCoversCd) {
    const from = cdOffset - tailStart;
    cd = tail.subarray(from, from + cdSize);
  } else {
    cd = await source.read(cdOffset, cdSize);
  }
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.length);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== SIG_CENTRAL)
      throw zipError(name, 'central directory is corrupt');
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true);
    const csize = cv.getUint32(p + 20, true);
    const usize = cv.getUint32(p + 24, true);
    const nlen = cv.getUint16(p + 28, true);
    const elen = cv.getUint16(p + 30, true);
    const clen = cv.getUint16(p + 32, true);
    const localOffset = cv.getUint32(p + 42, true);
    if (p + 46 + nlen > cd.length) throw zipError(name, 'central directory is corrupt');
    const entryName = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
    entries.push({ name: entryName, crc, csize, usize, method, flags, localOffset });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

export class ZipFile {
  constructor(source, entries) {
    this.zipName = source.name;
    this.source = source;
    this.entries = entries; // central-directory metadata; use meta() to read it
    this.byName = new Map(entries.map((e) => [e.name, e]));
    this.cache = new Map();
  }

  static async open(source) {
    return new ZipFile(source, await readIndex(source));
  }

  meta() {
    return this.entries;
  }

  // Entry bytes, inflated once and cached. The local header carries its own
  // name/extra lengths, so the data offset comes from there rather than the
  // central directory copy.
  async read(path) {
    const e = this.byName.get(path);
    if (!e) throw new Error(`${this.zipName}: no ${path}`);
    const hit = this.cache.get(path);
    if (hit) return hit;
    if (e.flags & 1) throw zipError(this.zipName, `${path}: encrypted entries are not supported`);
    const lh = await this.source.read(e.localOffset, 30);
    const dv = new DataView(lh.buffer, lh.byteOffset, lh.length);
    if (lh.length < 30 || dv.getUint32(0, true) !== SIG_LOCAL)
      throw zipError(this.zipName, `${path}: local header is corrupt`);
    const start = e.localOffset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
    if (start + e.csize > this.source.size) throw zipError(this.zipName, `${path}: data is truncated`);
    const raw = await this.source.read(start, e.csize);
    let out;
    if (e.method === 0) out = raw.slice();
    else if (e.method === 8) out = inflateSync(raw);
    else throw zipError(this.zipName, `${path}: unsupported compression method ${e.method}`);
    if (out.length !== e.usize) throw zipError(this.zipName, `${path}: size mismatch`);
    this.cache.set(path, out);
    return out;
  }
}

function baseName(p) {
  const i = p.lastIndexOf('/');
  return (i >= 0 ? p.slice(i + 1) : p).toLowerCase();
}

// Index-only open (#202): the central directory is enough to match BIOS chips;
// callers that need bytes call ZipFile.read(). Node paths and browser Files both work.
export async function openZipIndex(pathOrFile) {
  return ZipFile.open(await sourceOf(pathOrFile));
}

export class RomSet {
  constructor(zips) {
    // zips: ZipFile[] — index only; entry bytes are inflated by read()
    this.files = zips;
    this.byCrc = new Map();
    this.byName = new Map();
    for (const z of zips) {
      for (const e of z.meta()) {
        if (e.usize === 0) continue;
        if (!this.byCrc.has(e.crc)) this.byCrc.set(e.crc, { zip: z, path: e.name });
        const bn = baseName(e.name);
        if (!this.byName.has(bn)) this.byName.set(bn, { zip: z, path: e.name });
      }
    }
    this.description = zips.map((z) => z.zipName).join(' + ');
  }

  // node (test/scripts): string paths. browser: File objects (index-only reads)
  // or {name, arrayBuffer()} fakes.
  static async open(pathsOrFiles) {
    const zips = [];
    for (const p of pathsOrFiles) zips.push(await openZipIndex(p));
    return new RomSet(zips);
  }

  has(name, crc) {
    return crc == null || this.byCrc.has(crc >>> 0);
  }

  missing(g) {
    const out = [];
    for (const r of g.regions) {
      for (const o of r.ops) {
        if (o.kind === 'load' && !this.has(o.file, o.crc)) out.push(o.file);
      }
    }
    return out;
  }

  async read(name, crc, game) {
    if (crc == null) {
      const n = this.byName.get(name.toLowerCase());
      return n ? this.filesData(n) : new Uint8Array(0);
    }
    const e = this.byCrc.get(crc >>> 0);
    if (e) return this.filesData(e);
    const wrong = this.byName.get(name.toLowerCase());
    if (wrong) {
      const actual = this.filesCrc(wrong);
      throw new Error(`${name} has CRC ${actual.toString(16)}, expected ${(crc >>> 0).toString(16)}: not the ${game} romset version.`);
    }
    throw new Error(`${this.description} has no ${name} (CRC ${(crc >>> 0).toString(16)}).`);
  }

  filesData({ zip, path }) { return zip.read(path); }
  filesCrc({ zip, path }) { return zip.byName.get(path).crc; }
}

export class BiosSet {
  constructor(zip) {
    this.zip = zip;
  }

  // neogeo.zip is ~1.7MB: load it whole so read() stays synchronous.
  static async open(pathOrFile) {
    const zip = await openZipIndex(pathOrFile);
    await Promise.all(zip.meta().filter((e) => e.usize > 0).map((e) => zip.read(e.name)));
    return new BiosSet(zip);
  }

  find(f) {
    for (const e of this.zip.meta()) {
      if (e.usize === 0) continue;
      if (e.crc === (f.crc >>> 0) && e.usize === f.size) return e.name;
    }
    for (const e of this.zip.meta()) {
      if (baseName(e.name) === f.name.toLowerCase()) return e.name;
    }
    return null;
  }

  read(f) {
    const p = this.find(f);
    if (p == null) throw new Error(`${this.zip.zipName} has no ${f.name} (CRC ${f.crc.toString(16)}).`);
    const e = this.zip.byName.get(p);
    if (e.crc !== (f.crc >>> 0))
      throw new Error(`${f.name} has wrong CRC: a different romset version.`);
    return this.zip.cache.get(p);
  }

  has(f) {
    for (const e of this.zip.meta()) {
      if (e.usize > 0 && e.crc === (f.crc >>> 0) && e.usize === f.size) return true;
    }
    return false;
  }

  firstPresent(candidates) {
    for (const f of candidates) if (this.find(f) != null) return f;
    throw new Error('No BIOS file: ' + candidates.map((c) => c.name).join(', '));
  }
}
