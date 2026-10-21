// zstd.wasm adapter (built by scripts/build_wasm.sh): malloc/compress/free in one place.
export async function loadZstd(url) {
  const init = (await import(url)).default;
  const mod = await init();
  return {
    compress(u8, level) {
      const bound = mod._zstd_compress_bound(u8.length);
      const pIn = mod._malloc(u8.length), pOut = mod._malloc(bound);
      try {
        mod.HEAPU8.set(u8, pIn);
        const n = mod._zstd_compress_simple(pIn, u8.length, pOut, bound, level);
        if (!n) throw new Error('zstd compress failed');
        return mod.HEAPU8.slice(pOut, pOut + n);
      } finally { mod._free(pIn); mod._free(pOut); }
    },
    decompress(u8, maxOut) {
      const pIn = mod._malloc(u8.length), pOut = mod._malloc(maxOut);
      try {
        mod.HEAPU8.set(u8, pIn);
        const n = mod._zstd_decompress_simple(pIn, u8.length, pOut, maxOut);
        if (!n) throw new Error('zstd decompress failed');
        return mod.HEAPU8.slice(pOut, pOut + n);
      } finally { mod._free(pIn); mod._free(pOut); }
    },
  };
}
