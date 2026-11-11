// zstd.wasm adapter (built by scripts/build_wasm.sh): malloc/compress/free in one place.
import { coded, allocCopy } from './errors.js';

// A WASM trap (including WebAssembly.RuntimeError) or any other uncoded throw
// means the module failed; the page must see 'wasm', not 'unknown'. A coded
// error keeps its own reason: the first throw wins (#341).
function asWasm(fn) {
  try {
    return fn();
  } catch (err) {
    if (typeof err?.code === 'string') throw err;
    throw coded('wasm', String(err?.message ?? err));
  }
}

function malloc(mod, size) {
  const p = mod._malloc(size);
  if (!p) throw coded('oom', `zstd malloc failed: ${size} bytes`);
  return p;
}

export async function loadZstd(url) {
  let mod;
  try {
    const init = (await import(url)).default;
    mod = await init();
  } catch (err) {
    throw coded('wasm', String(err?.message ?? err));
  }
  return {
    compress(u8, level) {
      return asWasm(() => {
        const bound = mod._zstd_compress_bound(u8.length);
        const pIn = malloc(mod, u8.length);
        let pOut = 0;
        try {
          pOut = malloc(mod, bound);
          mod.HEAPU8.set(u8, pIn);
          const n = mod._zstd_compress_simple(pIn, u8.length, pOut, bound, level);
          if (!n) throw coded('wasm', 'zstd compress failed');
          return allocCopy(mod.HEAPU8, pOut, pOut + n);
        } finally {
          if (pIn) mod._free(pIn);
          if (pOut) mod._free(pOut);
        }
      });
    },
    decompress(u8, maxOut) {
      return asWasm(() => {
        const pIn = malloc(mod, u8.length);
        let pOut = 0;
        try {
          pOut = malloc(mod, maxOut);
          mod.HEAPU8.set(u8, pIn);
          const n = mod._zstd_decompress_simple(pIn, u8.length, pOut, maxOut);
          if (!n) throw coded('wasm', 'zstd decompress failed');
          return allocCopy(mod.HEAPU8, pOut, pOut + n);
        } finally {
          if (pIn) mod._free(pIn);
          if (pOut) mod._free(pOut);
        }
      });
    },
  };
}
