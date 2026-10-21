#!/usr/bin/env bash
# Harness across all scheme representatives (#34): desktop KEEP vs web romfs.
# Usage: bash site/vendor/conv/diff-all.sh
# Prereqs: roms/*.zip (7 schemes + neogeo.zip), CLI built, npm i adm-zip zstd-codec (in conv/).
set -euo pipefail
cd "$(dirname "$0")/../../../"
CLI=converter/Neo3dsConverter.Cli/bin/Release/net10.0/neo3ds-converter.dll
if [[ ! -f "$CLI" ]]; then dotnet build -c Release converter/Neo3dsConverter.Cli > /dev/null; fi
# npm packages (adm-zip, zstd-codec): use the nearest node_modules, else install into conv/
if [[ ! -d site/vendor/conv/node_modules ]]; then
  (cd site/vendor/conv && npm i --no-save adm-zip zstd-codec > /dev/null 2>&1) || true
fi
pass=0; fail=0
for set in kof98h nam1975 kof99 sengoku3 kof2000 mslug4 kof2002 mslug5 svcplus; do
  NEO3DS_KEEP=1 dotnet "$CLI" "roms/$set.zip" out/ > /dev/null 2>&1 || { echo "FAIL $set (desktop build)"; fail=$((fail+1)); continue; }
  keep=$(ls -dt ${TMPDIR:-/tmp}/neo3ds/"$set"-* | head -1)
  if node site/vendor/conv/romfs-diff.mjs "$keep" > /tmp/diff-"$set".log 2>&1; then
    echo "PASS $set"; pass=$((pass+1))
  else
    echo "FAIL $set"; grep FAIL /tmp/diff-"$set".log | head -3; fail=$((fail+1))
  fi
done
echo "== $pass pass, $fail fail =="
exit $((fail > 0))
