// zstd.wasm adapter (built by scripts/build_wasm.sh): malloc/compress/free in one place.
import { coded } from './errors.js';

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
      const bound = mod._zstd_compress_bound(u8.length);
      const pIn = mod._malloc(u8.length), pOut = mod._malloc(bound);
      try {
        mod.HEAPU8.set(u8, pIn);
        const n = mod._zstd_compress_simple(pIn, u8.length, pOut, bound, level);
        if (!n) throw coded('wasm', 'zstd compress failed');
        return mod.HEAPU8.slice(pOut, pOut + n);
      } finally { mod._free(pIn); mod._free(pOut); }
    },
    decompress(u8, maxOut) {
      const pIn = mod._malloc(u8.length), pOut = mod._malloc(maxOut);
      try {
        mod.HEAPU8.set(u8, pIn);
        const n = mod._zstd_decompress_simple(pIn, u8.length, pOut, maxOut);
        if (!n) throw coded('wasm', 'zstd decompress failed');
        return mod.HEAPU8.slice(pOut, pOut + n);
      } finally { mod._free(pIn); mod._free(pOut); }
    },
  };
}
