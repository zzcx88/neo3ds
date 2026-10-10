#!/usr/bin/env bash
# Dev loop: rebuild the engine, repack a game as CXI and (re)launch it in Azahar.
# usage: scripts/azahar_test.sh [rom.zip]   (default roms/kof98.zip)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
rom="${1:-$root/roms/kof98.zip}"
name="$(basename "$rom" .zip)"

if ! /c/devkitPro/msys2/usr/bin/bash.exe -lc "cd '$root/engine' && LANG=C make >'$root/out/build.log' 2>&1"; then
  grep -E "error|undefined" "$root/out/build.log" | head -20
  echo "BUILD FAILED (see out/build.log)"
  exit 1
fi
cp "$root/engine/engine.elf" "$root/dist/converter/tools/engine.elf"
NEO3DS_CXI=1 "$root/dist/converter/Neo3dsConverter.exe" "$rom" "$root/out" | tail -1

powershell -NoProfile -Command "Stop-Process -Name azahar -ErrorAction SilentlyContinue" || true
powershell -NoProfile -Command "Start-Process '$(cygpath -w "$root/tools/azahar/azahar-windows-msvc-2126.2/azahar.exe")' -ArgumentList '\"$(cygpath -w "$root/out/$name.cxi")\"'"
echo "launched $name.cxi"
