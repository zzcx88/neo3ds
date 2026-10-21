// GameDb port (converter/Neo3dsConverter.Core/GameDb.cs).
// MAME romset records + support rules. JSON shape matches neogeo_games.json
// (see scripts/gen_gamedb.py); RomOp decoding mirrors GameDb.Load.
export const Region = Object.freeze({ Europe: 0, Japan: 1, Usa: 2 });

export function decodeOps(rawOps) {
  return rawOps.map((a) => {
    const kind = a[0];
    switch (kind) {
      case 'load': return { kind, flag: a[1], file: a[2], crc: a[3] == null ? null : parseInt(a[3], 16) >>> 0, a: a[4], b: a[5], c: 0, src: '' };
      case 'cont':
      case 'reload': return { kind, flag: '', file: '', crc: null, a: a[1], b: a[2], c: 0, src: '' };
      case 'ignore': return { kind, flag: '', file: '', crc: null, a: a[1], b: 0, c: 0, src: '' };
      case 'fill': return { kind, flag: '', file: '', crc: null, a: a[1], b: a[2], c: a[3], src: '' };
      case 'copy': return { kind, flag: '', file: '', crc: null, a: a[2], b: a[3], c: a[4], src: a[1] };
      default: throw new Error('unknown ROM op ' + kind);
    }
  });
}

// "Metal Slug X - Super Vehicle-001 (NGM-2500 ~ NGH-2500)" -> main title.
export function titleOf(g) {
  let t = g.desc.split(' / ')[0];
  t = t.replace(/\s*\([^)]*\)\s*$/, '');
  return t.trim();
}

const SUPPORTED_CARTS = new Set([
  'rom', 'rom_mslugx', 'cmc42', 'cmc50', 'sma', 'pcm2', 'kof2002',
  'pvc', 'pvc_al', 'boot_svc', 'boot_svcplus', 'boot_kof10th',
]);

export class GameDb {
  constructor(games) {
    this.games = games;
    this.byName = new Map(games.map((g) => [g.name.toLowerCase(), g]));
  }

  static async load(pathOrUrl) {
    let json;
    if (typeof process !== 'undefined' && pathOrUrl.includes('neogeo_games.json') && !pathOrUrl.startsWith('http')) {
      const { readFileSync } = await import('node:fs');
      json = JSON.parse(readFileSync(pathOrUrl, 'utf8'));
    } else {
      json = await (await fetch(pathOrUrl)).json();
    }
    return new GameDb(json.map((g) => ({
      name: g.name, parent: g.parent ?? null, year: g.year, maker: g.maker,
      desc: g.desc, machine: g.machine, cart: g.cart,
      regions: Object.entries(g.regions).map(([name, r]) => ({ name, size: r.size, ops: decodeOps(r.ops) })),
    })));
  }

  find(name) { return this.byName.get(name.toLowerCase()) ?? null; }

  clonesOf(name) {
    const n = name.toLowerCase();
    return this.games.filter((g) => g.parent != null && g.parent.toLowerCase() === n);
  }

  region(g, name) { return g.regions.find((r) => r.name === name) ?? null; }

  title(g) { return titleOf(g); }

  // Why the engine can't run this cart yet, or null when it can (GameDb.cs:49).
  unsupported(g) {
    if (g.machine === 'irrmaze') return 'needs a trackball';
    if (SUPPORTED_CARTS.has(g.cart)) return null;
    switch (g.cart) {
      case 'rom_kof98': return 'MVS version with a protection chip (the home version kof98h converts if its ROMs are in the zip)';
      case 'rom_fatfur2': return 'protection chip not supported';
      case 'rom_vliner':
      case 'cmc50_jockeygp': return 'gambling board';
      default:
        if (g.cart.startsWith('boot_')) return 'bootleg romsets are not supported';
        return 'protection chip not supported';
    }
  }

  static BIOS = [
    { name: 'neo-epo.bin', crc: 0xd27a71f1, size: 0x20000 },
    { name: 'neo-po.bin', crc: 0x16d0c132, size: 0x20000 },
    { name: 'sp-s2.sp1', crc: 0x9036d879, size: 0x20000 },
    { name: 'sp-s.sp1', crc: 0xc7f2fa45, size: 0x20000 },
    { name: 'asia-s3.rom', crc: 0x91b64be3, size: 0x20000 },
    { name: 'sp-45.sp1', crc: 0x03cc9f6a, size: 0x20000 },
    { name: 'vs-bios.rom', crc: 0xf0e8f27d, size: 0x20000 },
    { name: 'sp-j2.sp1', crc: 0xacede59c, size: 0x20000 },
    { name: 'sp1.jipan.1024', crc: 0x9fb0abe4, size: 0x20000 },
    { name: 'usa_2slt.bin', crc: 0xe72943de, size: 0x20000 },
    { name: 'sp-e.sp1', crc: 0x2723a5b5, size: 0x20000 },
  ];

  static isAesBios(f) { return f.name === 'neo-epo.bin' || f.name === 'neo-po.bin'; }

  static aesBios(r) {
    const [epo, po] = GameDb.BIOS;
    return r === Region.Japan ? [po, epo] : [epo, po];
  }

  static mvsBios(r) {
    const [, , ...mvs] = GameDb.BIOS;
    const eu = mvs.slice(0, 4), jp = mvs.slice(4, 7), us = mvs.slice(7, 9);
    if (r === Region.Japan) return [...jp, ...eu, ...us];
    if (r === Region.Usa) return [...us, ...eu, ...jp];
    return [...eu, ...jp, ...us];
  }

  static regionOf(f) {
    if (f.name === 'neo-po.bin' || ['vs-bios.rom', 'sp-j2.sp1', 'sp1.jipan.1024'].includes(f.name)) return Region.Japan;
    if (['usa_2slt.bin', 'sp-e.sp1'].includes(f.name)) return Region.Usa;
    return Region.Europe;
  }

  static needsMvsBios(g) { return g.cart === 'boot_svcplus'; }

  static BIOS_FIX = { name: 'sfix.sfix', crc: 0xc2ea0cfd, size: 0x20000 };
  static ZOOM_TABLE = { name: '000-lo.lo', crc: 0x5a86cff2, size: 0x20000 };
}

export function regionName(r, ko = true) {
  return r === Region.Japan ? (ko ? '일본' : 'Japan') : r === Region.Usa ? (ko ? '미국' : 'USA') : (ko ? '유럽·아시아' : 'Europe/Asia');
}
