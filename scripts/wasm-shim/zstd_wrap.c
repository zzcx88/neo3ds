// Minimal zstd compress/decompress for the web converter (#33).
// One-shot API over ZSTD_compress / ZSTD_decompress (zstd v1.5.6).
// Built with build_wasm.sh (same emsdk): -sMODULARIZE -sEXPORT_ES6,
// EXPORTED_FUNCTIONS _zstd_compress_simple, _zstd_decompress_simple, _malloc, _free.
#include <stdlib.h>
#include <string.h>
#include "zstd.h"

size_t zstd_compress_simple(const unsigned char* src, size_t srcSize,
                            unsigned char* dst, size_t dstCap, int level) {
  size_t r = ZSTD_compress(dst, dstCap, src, srcSize, level);
  if (ZSTD_isError(r)) return 0;
  return r;
}

size_t zstd_decompress_simple(const unsigned char* src, size_t srcSize,
                              unsigned char* dst, size_t dstCap) {
  size_t r = ZSTD_decompress(dst, dstCap, src, srcSize);
  if (ZSTD_isError(r)) return 0;
  return r;
}

size_t zstd_compress_bound(size_t srcSize) { return ZSTD_compressBound(srcSize); }
