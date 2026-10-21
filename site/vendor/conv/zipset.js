// RomSet/ZipSet port (RomPack.cs:265-362) over fflate.
// Chips are found by CRC first, then by name — same rule as C#.
import { unzipSync } from './fflate.js';
import { crc32Bytes } from './job.js';

export class ZipFile {
  constructor(name, data) {
    this.zipName = name;
    this.entries = unzipSync(data);
    // Precompute CRCs (fflate doesn't expose them)
    this.crcs = new Map();
    for (const [n, d] of Object.entries(this.entries)) {
      if (d.length === 0) continue;
      this.crcs.set(n, crc32Bytes(d));
    }
  }

  static async fromFile(f) {
    return new ZipFile(f.name, new Uint8Array(await f.arrayBuffer()));
  }

  static fromData(name, data) {
    return new ZipFile(name, data);
  }
}

function baseName(p) {
  const i = p.lastIndexOf('/');
  return (i >= 0 ? p.slice(i + 1) : p).toLowerCase();
}

export class RomSet {
  constructor(zips) {
    // zips: [{name, data: Uint8Array}]
    this.files = zips.map((z) => new ZipFile(z.name, z.data));
    this.byCrc = new Map();
    this.byName = new Map();
    for (const z of this.files) {
      for (const [path, data] of Object.entries(z.entries)) {
        if (data.length === 0) continue;
        const crc = z.crcs.get(path);
        if (!this.byCrc.has(crc)) this.byCrc.set(crc, { zip: z, path });
        const bn = baseName(path);
        if (!this.byName.has(bn)) this.byName.set(bn, { zip: z, path });
      }
    }
    this.description = zips.map((z) => z.name).join(' + ');
  }

  static async open(pathsOrFiles) {
    // node (test): string paths; browser: File objects
    const list = [];
    for (const p of pathsOrFiles) {
      if (typeof p === 'string') {
        const { readFileSync } = await import('node:fs');
        const name = p.split('/').pop();
        list.push({ name, data: new Uint8Array(readFileSync(p)) });
      } else {
        list.push({ name: p.name, data: new Uint8Array(await p.arrayBuffer()) });
      }
    }
    return new RomSet(list);
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

  read(name, crc, game) {
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

  filesData({ zip, path }) { return zip.entries[path]; }
  filesCrc({ zip, path }) { return zip.crcs.get(path); }
}

export class BiosSet {
  constructor(zip) {
    this.zip = zip;
  }

  static async open(pathOrFile) {
    if (typeof pathOrFile === 'string') {
      const { readFileSync } = await import('node:fs');
      const name = pathOrFile.split('/').pop();
      return new BiosSet(new ZipFile(name, new Uint8Array(readFileSync(pathOrFile))));
    }
    return new BiosSet(await ZipFile.fromFile(pathOrFile));
  }

  find(f) {
    for (const [path, data] of Object.entries(this.zip.entries)) {
      if (data.length === 0) continue;
      if (this.zip.crcs.get(path) === (f.crc >>> 0) && data.length === f.size) return path;
    }
    for (const path of Object.keys(this.zip.entries)) {
      if (baseName(path) === f.name.toLowerCase()) return path;
    }
    return null;
  }

  read(f) {
    const p = this.find(f);
    if (p == null) throw new Error(`${this.zip.zipName} has no ${f.name} (CRC ${f.crc.toString(16)}).`);
    const data = this.zip.entries[p];
    if (this.zip.crcs.get(p) !== (f.crc >>> 0))
      throw new Error(`${f.name} has wrong CRC: a different romset version.`);
    return data;
  }

  has(f) {
    for (const [path, data] of Object.entries(this.zip.entries)) {
      if (data.length > 0 && this.zip.crcs.get(path) === (f.crc >>> 0) && data.length === f.size) return true;
    }
    return false;
  }

  firstPresent(candidates) {
    for (const f of candidates) if (this.find(f) != null) return f;
    throw new Error('No BIOS file: ' + candidates.map((c) => c.name).join(', '));
  }
}
