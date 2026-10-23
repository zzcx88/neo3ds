# Third-party notices

neo3ds builds on the following work. Each part keeps its own license; the copyright notices also
remain in the source files.

| Part | Where | Authors | License |
|---|---|---|---|
| gngeo (Neo Geo emulation core: memory map, video, timers, BIOS glue) | `engine/source/neo/` | Peponas Mathieu and gngeo contributors | GPL-2.0-or-later |
| Cyclone 68000 (68000 CPU core, ARM assembly) | `engine/source/neo/cyclone/` | Dave, notaz | Free for non-commercial use |
| DrZ80 (Z80 CPU core, ARM assembly) | `engine/source/neo/drz80/` | Reesy | Free for non-commercial use |
| YM2610 sound core (fm.c / ym2610.c) | `engine/source/neo/ym2610/` | Jarek Burczynski, Tatsuyuki Satoh (MAME), via NJ pspmvs and gngeo | as distributed with gngeo |
| MAME Neo Geo romset data (`neogeo_games.json`, generated from `src/mame/snk/neogeo.cpp`) | `converter/assets/` | Bryan McPhail, Ernesto Corvi, Andrew Prime, Zsolt Vasvari and MAME contributors | BSD-3-Clause |
| MAME Neo Geo cart decryption (CMC42/CMC50, SMA, PCM2, KOF2002-type, PVC), ported to C#; PVC cart RAM logic | `converter/Neo3dsConverter.Core/Protection.cs`, `CmcTables.cs`, `engine/source/neo/memory.c` (pvc_write) | S. Smith, David Haywood, Fabio Priuli, Razoola, Mr.K | BSD-3-Clause |
| Zstandard (decompressor) | `engine/source/zstd/` | Meta Platforms, Inc. and affiliates | BSD-3-Clause (see `engine/source/zstd/LICENSE`) |
| LZ4 | `engine/source/lz4/` | Yann Collet | BSD-2-Clause |
| libctru | linked into the engine | devkitPro / 3DS homebrew contributors | zlib |
| ZstdSharp.Port (converter, NuGet) | converter build | Oleg Stepanischev | MIT |
| SkiaSharp (converter icon/banner drawing, NuGet) | converter build, native library `libSkiaSharp` | Microsoft Corporation | MIT |
| Skia (inside `libSkiaSharp`; its own third-party parts are listed in SkiaSharp's THIRD-PARTY-NOTICES) | converter build | Google Inc. | BSD-3-Clause |
| makerom (bundled in the release) | `tools\makerom.exe`, `tools/{rid}/makerom` | 3DSGuy, applestash, Jakcron | MIT |
| bannertool (bundled in the release) | `tools\bannertool.exe`, `tools/{rid}/bannertool` | Steveice10 | MIT |
| fflate 0.8.3 (browser zip reading) | `site/vendor/conv/fflate.js` (verbatim ESM bundle) | Arjun Barrett (101arrowz) | MIT |
| Zstandard 1.5.6 (web converter compression, Emscripten build) | `site/vendor/zstd.{js,wasm}` (built by `scripts/build_wasm.sh`) | Meta Platforms, Inc. and affiliates | BSD-3-Clause |
| Avalonia (cross-platform GUI, NuGet) | converter build | AvaloniaUI OÜ | MIT |
| Noto Sans KR (bundled Korean UI font subset, Linux only) | `converter/Neo3dsConverter.Desktop/Assets/Fonts/`, full text in `converter/assets/fonts/OFL.txt` | Google Fonts, Sandoll | OFL-1.1 |
Because Cyclone 68000 and DrZ80 are only free for non-commercial use, **neo3ds as a whole may only
be used and distributed non-commercially.** gngeo itself has shipped with these two cores for years
under the same arrangement.

## BSD-3-Clause (MAME parts, Skia)

```
Copyright (c) the MAME authors listed above. All rights reserved.
Skia: Copyright (c) 2011 Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions
   and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of
   conditions and the following disclaimer in the documentation and/or other materials provided
   with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific prior written
   permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## MIT (makerom, bannertool, ZstdSharp.Port, SkiaSharp, fflate, Avalonia)

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Trademarks

NEOGEO and SNK are trademarks of SNK CORPORATION. Nintendo 3DS is a trademark of Nintendo.
neo3ds is an independent fan project and is not affiliated with, endorsed or sponsored by either.
