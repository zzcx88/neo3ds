#!/usr/bin/env bash
# Build makerom + bannertool to WASM with Emscripten (#32 Phase 0).
# Usage: bash scripts/build_wasm.sh [--skip-existing]
# Prereqs: emsdk on PATH (source ~/emsdk/emsdk_env.sh), git, patch.
# Upstream (same pins as scripts/build_unix_tools.sh):
#   Project_CTR @ makerom-v0.19.0 (e8f5f52), bannertool @ 1.2.0 (16d8c5a).
# Shims (scripts/wasm-shim/): oschar iconv -> manual UTF-8<->UTF-16LE;
#   bannertool <codecvt> -> manual decode. mbedtls excludes net/entropy/timing/
#   thread/ssl/x509/havege (socket/signal/syscall blockers, unused by makerom).
# Sources/log: out/wasm-build.XXXXXX (kept for diagnosis, git-excluded).
# Outputs: site/vendor/{makerom,bannertool}.{js,wasm} (git-excluded build products).
set -euo pipefail

skip_existing=0
for arg in "$@"; do
  case "$arg" in --skip-existing) skip_existing=1;; *) echo "unknown arg: $arg" >&2; exit 1;; esac
done

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
for tool in git patch mktemp; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done
command -v emcc >/dev/null || { echo "emcc not on PATH — run: source ~/emsdk/emsdk_env.sh" >&2; exit 1; }

mkdir -p "$root/out" "$out"
if [[ "$skip_existing" == 1 && -s "$out/makerom.wasm" && -s "$out/bannertool.wasm" ]]; then
  echo "WASM tools already built, skipping."
  exit 0
fi
# Static assets the gate page fetches (copies of tracked sources)
cp "$root/engine/engine.elf" "$out/engine.elf"
cp "$root/converter/assets/neo3ds.rsf" "$out/neo3ds.rsf"
cp "$root/converter/assets/neogeo_games.json" "$out/neogeo_games.json"
work=$(mktemp -d "$root/out/wasm-build.XXXXXX")
echo "work dir: $work"

makerom_ref=makerom-v0.19.0 # e8f5f52 (same as build_unix_tools.sh)
bannertool_ref=1.2.0 # 16d8c5a (same as build_unix_tools.sh)
git -C "$work" clone --quiet --depth 1 --branch "$makerom_ref" https://github.com/3DSGuy/Project_CTR Project_CTR
git -C "$work" clone --quiet --depth 1 --branch "$bannertool_ref" https://github.com/diasurgical/bannertool bannertool
git -C "$work/bannertool" submodule update --quiet --init --depth 1

# Shims: iconv guard + wasm converter, codecvt replacement
patch -s -d "$work" -p1 < "$root/scripts/wasm-shim/makerom-iconv.patch"
cp "$root/scripts/wasm-shim/oschar_wasm.c" "$work/Project_CTR/makerom/src/oschar_wasm.c"
patch -s -d "$work" -p1 < "$root/scripts/wasm-shim/bannertool-codecvt.patch"

cd "$work"
echo "== bannertool =="
em++ -std=c++11 -O2 -Wno-deprecated-declarations \
  -DVERSION_MAJOR=1 -DVERSION_MINOR=2 -DVERSION_MICRO=0 \
  -Ibannertool/source \
  bannertool/source/main.cpp bannertool/source/cmd.cpp \
  bannertool/source/pc/wav.cpp bannertool/source/pc/stb_image.c bannertool/source/pc/stb_vorbis.c \
  bannertool/source/3ds/lz11.cpp bannertool/source/3ds/cwav.cpp bannertool/source/3ds/cbmd.cpp \
  -o "$out/bannertool.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS='["FS","callMain"]' -sEXIT_RUNTIME=1 -sINVOKE_RUN=0

echo "== makerom =="
CTR=Project_CTR/makerom
MBED="$CTR/deps/libmbedtls/src"
MBED_EXCLUDE="net_sockets entropy entropy_poll timing threading havege ssl_cache ssl_ciphersuites ssl_cli ssl_cookie ssl_srv ssl_ticket ssl_tls x509 x509_create x509_crl x509_crt x509_csr x509write_crt x509write_csr"
MBED_SRCS=""
for f in "$MBED"/*.c; do
  base=$(basename "$f" .c)
  case " $MBED_EXCLUDE " in *" $base "*) continue;; esac
  MBED_SRCS="$MBED_SRCS $f"
done
emcc -std=c11 -O2 -D_GNU_SOURCE \
  -I$CTR/src -I$CTR/include \
  -I$CTR/deps/libyaml/include -I$CTR/deps/libblz/include -I$CTR/deps/libmbedtls/include \
  $CTR/src/*.c \
  $CTR/deps/libyaml/src/{api,loader,parser,reader,scanner,emitter,dumper,writer}.c \
  $CTR/deps/libblz/src/blz.c \
  $MBED_SRCS \
  -o "$out/makerom.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS='["FS","callMain"]' -sEXIT_RUNTIME=1 -sINVOKE_RUN=0
echo "WASM_BUILD_OK (sources kept: $work)"
