#!/usr/bin/env bash
# Builds engine/engine.elf with devkitPro's msys2 shell (Git Bash has no make on PATH).
# usage: bash scripts/build_engine.sh [make args...]
root="$(cd "$(dirname "$0")/.." && pwd)"
exec /c/devkitPro/msys2/usr/bin/bash.exe -lc "cd '$root/engine' && export DEVKITPRO=/opt/devkitpro DEVKITARM=/opt/devkitpro/devkitARM && LANG=C make $*"
