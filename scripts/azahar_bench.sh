#!/usr/bin/env bash
# Repack + launch in Azahar, screenshot the attract demo, then play into a fight and screenshot again.
# Output: $TEMP/claude/s/demo.png and fight.png
S="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$S/.." && pwd)"
mkdir -p "$TEMP/claude/s"
shot() {
  local pid; pid=$(powershell -NoProfile -Command "(Get-Process azahar -ErrorAction SilentlyContinue).Id")
  powershell -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$S/azahar_shot.ps1")" -ProcessId "$pid" -Out "$(cygpath -w "$TEMP/claude/s/$1.png")" > /dev/null
}
keys() { powershell -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$S/azahar_keys.ps1")" -Seq "$1"; }

cp "$root/engine/engine.elf" "$root/dist/converter/tools/engine.elf"
NEO3DS_CXI=1 "$root/dist/converter/Neo3dsConverter.exe" "$root/roms/kof98.zip" "$root/out" | tail -1
powershell -NoProfile -Command "Stop-Process -Name azahar -ErrorAction SilentlyContinue; Wait-Process -Name azahar -ErrorAction SilentlyContinue"
powershell -NoProfile -Command "Start-Process '$(cygpath -w "$root/tools/azahar/azahar-windows-msvc-2126.2/azahar.exe")' -ArgumentList '\"$(cygpath -w "$root/out/kof98.cxi")\"'"
sleep 40
shot demo
# START (M) x2 -> mode select, Neo Geo A (S) -> team play, controls, ADVANCED, 3 characters, order x3, fight
keys "M:250,wait:3000,M:250,wait:3000,S:250,wait:11000,S:250,wait:5000,S:250,wait:1500,H:200,wait:500,S:250,wait:1500,H:200,wait:500,S:250,wait:4000,S:250,wait:15000,S:250,wait:800,S:250,wait:800,S:250,wait:20000"
shot fight
echo bench-done
