import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import initMakerom from './makerom.js';
import initBannertool from './bannertool.js';

// Seam A: WASM CLI equivalence.
// Replays the exact argv CiaBuilder used (from NEO3DS_KEEP dir) inside WASM
// MEMFS, then byte-compares the CIA against the native build.
// Usage: node wasm-compare.mjs <keepDir> <nativeCia> [toolsDir]
const [keep, nativeCia, toolsDir = new URL('.', import.meta.url).pathname + '/../../converter/Neo3dsConverter.Cli/bin/Release/net10.0/tools'] = process.argv.slice(2);
if (!keep || !nativeCia) { console.error('usage: node wasm-compare.mjs <keepDir> <nativeCia>'); process.exit(2); }

const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const meta = Object.fromEntries(readFileSync(join(keep, 'romfs/meta.txt'), 'utf8').trim().split('\n').map(l => l.split(/: (.+)/)));
const rom = meta['rom'], titleId = meta['title id'], set = meta['set'] || rom;
const uniqueId = parseInt(titleId.slice(-8), 16) >>> 8;
let product = ('NEO3DS-' + rom.toUpperCase()).slice(0, 16);
const dbPath = new URL('.', import.meta.url).pathname + '/../../converter/assets/neogeo_games.json';
const publisher = JSON.parse(readFileSync(dbPath, 'utf8')).find((x) => x.name === set)?.maker ?? 'SNK';

// MEMFS readdir returns creation order; makerom's romfs_fs.c:73 uses readdir
// order unsorted, so stage in the NATIVE readdir order (ls -U) for byte parity.
// Node sorts readdirSync, so capture raw order via ls -U (POSIX testing only).
import { execFileSync as sh } from 'node:child_process';
const rawOrder = (d) => sh('ls', ['-U', d], { encoding: 'utf8' }).trim().split('\n');
const ls = (d, base = d) => rawOrder(d).flatMap(name => {
  const p = join(d, name);
  return statSync(p).isDirectory() ? ls(p, base) : [[relative(base, p), readFileSync(p)]];
});
const stage = (FS, files, root) => { for (const [rel, buf] of files) { FS.writeFile(join(root, rel), buf); } };

const romfsFiles = ls(join(keep, 'romfs'));
const mkdirs = new Set(romfsFiles.map(([rel]) => join('/work/romfs', rel.split('/').slice(0, -1).join('/'))));

// --- bannertool: makebanner + makesmdh (CiaBuilder.cs:188-190) ---
const bt = await initBannertool();
bt.FS.mkdirTree('/work');
for (const m of mkdirs) bt.FS.mkdirTree(m);
for (const f of ['icon.png', 'banner.png', 'banner.wav'])
  bt.FS.writeFile('/work/' + f, readFileSync(join(keep, f)));
const smdh = (s, max) => s.replaceAll('"', "'").slice(0, max);
const run = (mod, args) => { try { mod.callMain(args); } catch (e) { if (e.code !== 0 && e.status !== 0 && e.message !== 'Program terminated with exit(0)') throw e; } };
run(bt, ['makebanner', '-i', '/work/banner.png', '-a', '/work/banner.wav', '-o', '/work/banner.bnr']);
run(bt, ['makesmdh', '-s', smdh(meta['title'], 64), '-l', smdh(meta['title'] + ' (neo3ds)', 128),
  '-p', smdh(publisher, 64), '-i', '/work/icon.png', '-o', '/work/icon.icn']);
const iconEq = Buffer.compare(Buffer.from(bt.FS.readFile('/work/icon.icn')), readFileSync(join(keep, 'icon.icn'))) === 0;
const bannerEq = Buffer.compare(Buffer.from(bt.FS.readFile('/work/banner.bnr')), readFileSync(join(keep, 'banner.bnr'))) === 0;
console.log(`icon.icn: ${iconEq ? 'IDENTICAL' : 'DIFFER'}  banner.bnr: ${bannerEq ? 'IDENTICAL' : 'DIFFER'}`);

// --- makerom: same argv as MakeCia (CiaBuilder.cs:196-202) ---
const mr = await initMakerom();
mr.FS.mkdirTree('/work');
// Exact native order: interleave mkdir + writeFile following ls -U per dir.
// romfs root order first (meta.txt vs game), then game files.
for (const name of rawOrder(join(keep, 'romfs'))) {
  const p = join(keep, 'romfs', name);
  if (statSync(p).isDirectory()) {
    mr.FS.mkdirTree('/work/romfs/' + name);
    for (const sub of rawOrder(p))
      mr.FS.writeFile('/work/romfs/' + name + '/' + sub, readFileSync(join(p, sub)));
  } else {
    mr.FS.writeFile('/work/romfs/' + name, readFileSync(p));
  }
}
mr.FS.writeFile('/work/icon.icn', bt.FS.readFile('/work/icon.icn'));
mr.FS.writeFile('/work/banner.bnr', bt.FS.readFile('/work/banner.bnr'));
mr.FS.writeFile('/work/neo3ds.rsf', readFileSync(join(toolsDir, 'neo3ds.rsf')));
mr.FS.writeFile('/work/engine.elf', readFileSync(join(toolsDir, 'engine.elf')));
const baseArgs = ['-target', 't', '-exefslogo',
  '-rsf', '/work/neo3ds.rsf', '-elf', '/work/engine.elf',
  '-icon', '/work/icon.icn', '-banner', '/work/banner.bnr',
  '-DAPP_TITLE=neo3ds', `-DAPP_PRODUCT_CODE=${product}`, `-DAPP_UNIQUE_ID=0x${uniqueId.toString(16).toUpperCase().padStart(5, '0')}`,
  '-DAPP_ROMFS=/work/romfs'];
// CIA: expected DIFFER — content IDs are u32GetRand (cia.c:217,416,580),
// so even native-vs-native differs. Size parity is the check here.
run(mr, ['-f', 'cia', '-o', '/work/out.cia', ...baseArgs]);
const wasmCia = Buffer.from(mr.FS.readFile('/work/out.cia'));
const native = readFileSync(nativeCia);
console.log(`wasm cia: ${wasmCia.length} bytes sha=${sha16(wasmCia)}`);
console.log(`native  : ${native.length} bytes sha=${sha16(native)}`);
console.log(`CIA size: ${wasmCia.length === native.length ? 'EQUAL' : 'DIFFER'} (content expected DIFFER: random content IDs)`);
writeFileSync(join(keep, '..', 'wasm-out.cia'), wasmCia);
// CXI: deterministic (no content IDs) — byte parity proves WASM equivalence.
run(mr, ['-f', 'cxi', '-o', '/work/out.cxi', ...baseArgs]);
const wasmCxi = Buffer.from(mr.FS.readFile('/work/out.cxi'));
const nativeCxi = readFileSync(nativeCia.replace(/\.cia$/, '.cxi'));
const cxiEq = Buffer.compare(wasmCxi, nativeCxi) === 0;
console.log(`wasm cxi: ${wasmCxi.length} bytes sha=${sha16(wasmCxi)}`);
console.log(`native  : ${nativeCxi.length} bytes sha=${sha16(nativeCxi)}`);
console.log(`CXI: ${cxiEq ? 'IDENTICAL' : 'DIFFER'}`);
writeFileSync(join(keep, '..', 'wasm-out.cxi'), wasmCxi);
process.exit(iconEq && bannerEq && cxiEq && wasmCia.length === native.length ? 0 : 1);
