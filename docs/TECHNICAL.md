# How neo3ds runs Neo Geo games at full speed on an Old 3DS

[한국어](TECHNICAL.ko.md)

This is the long version of the "64 MB mode and the optimizations" section of the README: what the
Old 3DS gives you, where the time and memory go, and what was tried and thrown away. The numbers are
from a real Old 3DS unless they say otherwise.

## The budget

| | Old 3DS | Neo Geo game |
|---|---|---|
| CPU | 2 × ARM11 MPCore at 268 MHz | 68000 at 12 MHz + Z80 at 4 MHz |
| Memory for the app | 64 MB in the default mode | KOF99 / Metal Slug 3: 64 MB sprites + 16 MB sound + 8 MB program |
| Storage | SD card through RomFS | – |
| Frame | 16.7 ms (59.8 Hz LCD) | 59.185 Hz |

Three things shaped everything else:

- **Memory.** The big games are about 90 MB unpacked. The 80 MB mode fits more, but the system tears
  down and rebuilds the HOME menu every time a game starts or exits, which takes a long time. The
  96 MB mode crashed the HOME menu process. So the target became the default 64 MB mode
  (58 MB heap + 2 MB linear memory for the screen).
- **Streaming from SD is out.** RomFS on the Old 3DS managed about 7.5 MB/s sequentially but only
  30-40 random reads a second, far too slow to fetch sprite tiles on demand. Everything has to be
  in RAM.
- **The second core is not free.** The system services (GSP for graphics, DSP for sound) run on
  core 1, and an application only gets a share of it (`APT_SetAppCpuTimeLimit(80)`). Any call that
  goes through a service from a busy core 1 can wait several milliseconds.

## Starting point

The emulation core is [gngeo](https://github.com/pepone42/gngeo), the GP2X-era Neo Geo emulator, with
its ARM assembly CPU cores: Cyclone (68000) and DrZ80 (Z80). Both are fast, but they call back into C
for memory access without clearing the upper bits of the argument registers, so every callback takes
`unsigned int` and masks for itself. Getting that wrong was the single biggest bug of the port.

The PC side is a C# converter that reads a MAME romset zip, decrypts it and builds a CIA. All the
protection schemes (CMC42/CMC50 sprite and sound encryption, SMA and PVC program encryption, PCM2,
the KOF2002-type program shuffle, the SVC Chaos Plus bootleg) are undone on the PC, following MAME.
The 3DS never spends memory or time on decryption.

## Memory: 64 MB of sprites in 58 MB of heap

- **Block compression.** The sprite ROM is cut into 4 KB blocks and each block is compressed with
  zstd at level 19. KOF98's 64 MB: LZ4 HC 32.3 MB, zstd 22.1 MB (16 KB blocks would give 19.9 MB, a
  dictionary did not help). KOF99 64 MB → 19.6 MB.
- **8 MB block cache.** Blocks are unpacked into a pool of slots when a tile in them is drawn
  (round-robin replacement). On hardware the miss count is a handful per second even in busy scenes.
- **Transparency table.** The converter stores two bits per tile; fully transparent tiles are skipped
  without touching their block.
- **Result.** KOF99 and Metal Slug 3 use about 53.5 MB of the 58 MB.

## Two cores

```
core 0: | 68k + Z80 + timers, frame N+1 (264 scanline slices)  | snapshot |
core 1:                          | sound N | draw N into the framebuffer |
```

- **Core 0** runs the 68000, the Z80 and the timers interleaved scanline by scanline (264 slices a
  frame). At the end of the frame it copies the state the renderer needs (0x10c00 bytes of video RAM,
  the palette, the frame counter) and hands it to core 1.
- **Core 1** synthesizes that frame's sound and draws it while core 0 already emulates the next one.
  Picture and sound come out one frame late.

### The sound chip, twice

The YM2610 is emulated by two copies of the same code.

- The **control copy** on core 0 takes the Z80's writes immediately. The sound driver polls its
  timers, interrupts and status, so those must be exact and on time.
- Every write is also logged. At the end of the frame the log goes to the **synthesis copy** on core 1,
  which replays it and generates the samples for ndsp.
- The ADPCM "end of sample" flags only exist in the synthesis copy, so status reads come from there,
  with flags the Z80 has just cleared masked until the clear has been replayed.
- The log records the scanline of each write, and core 1 synthesizes up to that point before applying
  it. Before that, all of a frame's writes were applied at the start of the frame, which turned fast
  pitch sweeps into 60 Hz steps (Metal Slug 3's continue countdown changes an SSG pitch several times
  a frame).

## Drawing without the GPU

The first versions used citro3d to scale and rotate the picture. Every GPU step goes through the GSP
service on core 1, and the frame missed its vblank almost every time. Copying a finished picture into
the rotated framebuffer with the CPU cost 7.5 ms on core 1 (4.3 ms on core 0). So the renderer now
draws straight into the top screen's framebuffer, which is stored rotated (one column of 240 pixels
after another): one pixel to the right is +240, one line down is -1.

- **Triple buffering** with `gspPresentBuffer`, and its return value tells which buffer is on screen.
- **Cache flushes** use `svcStoreProcessDataCache` directly, never `GSPGPU_FlushDataCache` (5.6 ms when
  core 1 is busy).
- **Only the visible 304×224** is drawn, as on a TV (the outer 8 columns are overscan games don't keep
  clean).

### The sprite renderer

The Neo Geo has no background layer: everything except the fixed text layer is sprites, 16 pixels
wide and up to 512 lines tall, with hardware shrinking. The renderer follows MAME's per-scanline logic
and adds fast paths:

- **Unzoomed sprites** (most of them) are drawn a tile at a time, so the tile lookup happens once per
  16 lines instead of once per line.
- **Opaque runs.** Each 8-pixel half of a tile row is tested: fully transparent halves are skipped,
  fully opaque ones are written by an ARM assembly block (one `and` with a shifted register gives the
  palette offset, then `ldr` and `strh` with the column stride). In KOF98 and Metal Slug 2, over 90% of
  the halves are fully opaque. A C version of the same idea was slower: GCC spilled the eight indices
  to the stack.
- **Shrunk rows.** Rows narrowed by horizontal zoom use straight-line code generated at compile time
  for each of the 16 zoom steps and both flips (`put_row_zoom_k`). A zoomed-out Samurai Shodown V
  Special frame went from 12.1 ms to 7.0 ms, enough for full speed.

## Frame pacing

The main loop waited for the vblank with `gspWaitForVBlank()`, which always waits for the *next*
vblank. A frame that took 17 ms therefore missed one vblank and waited for the following one: 33 ms.
In Metal Slug 3's heavy scenes both cores averaged about 14.5 ms, yet the game ran at 53-55 fps, because
the occasional slow frame cost a whole extra frame.

`gspWaitForEvent(GSPGPU_EVENT_VBlank0, false)` returns at once if the vblank already happened. A frame
that runs a little long now costs a little time, and the next one catches up.

Automatic frame skip was tried as well: when the loop fell behind, the next frame was emulated and
its sound made, but not drawn. The game speed held better, but scrolling visibly jumped, which looked
worse than a slight slowdown. It was removed.

## Skipping the sound driver's idle loop

The Metal Slug 2, X and 3 sound driver spends about half of the Z80's time in

```
s:    ld   a,(hl)      ; 7 cycles   (hl = $F801, bumped by the timer interrupt)
s+1:  and  a           ; 4
s+2:  jp   z,s         ; 10
```

Nothing changes inside that loop until an interrupt arrives, and interrupts only arrive between
slices. So when a slice starts in the loop with the byte still 0 and no interrupt pending, the Z80 is
not run. An earlier attempt (stopping the Z80 until the next interrupt) changed the sound, so this
one is careful to leave the CPU exactly as DrZ80 would have:

- DrZ80 runs instructions while its cycle count stays at or above 0, so the code walks the loop's
  cycle costs to find the instruction it would have stopped on, and sets PC there.
- It sets A = 0 and F to what `and a` (or `or a`) leaves for 0, as DrZ80 stores it.
- The loop is found by its bytes, not by a per-game address.

The first version left PC where it was. After 2400 frames of the attract mode its Z80 had made 50,928
YM2610 writes against 50,992 without the skip: interrupts returned to a slightly different place in
the loop, and the timing drifted. With PC advanced, both builds end with the same write count and the
same Z80 RAM checksum, in Metal Slug 3 and Metal Slug 2 alike (the attract mode needs no input, so a
run is repeatable).

## Measurements

A busy Metal Slug 3 scene (heavy machine gun, explosions) on hardware, before the pacing fix, in ms
per frame:

| Core 0 | | Core 1 | |
|---|---|---|---|
| 68000 | 10.45 | sound synthesis | 3.63 |
| Z80 | 3.22 | drawing (11,510 sprite lines) | 10.92 |
| timers | 0.53 | | |

How it got there, KOF98 / Metal Slug 2:

| Version | Result |
|---|---|
| Single core | KOF98 29.9 fps (CPU 7.6 + draw 10.4 + copy 4.3 + sound 4.6 ms) |
| Drawing on core 1 with citro3d or a CPU rotate | 30-50 fps (GSP waits, rotate copy) |
| Drawing straight into the rotated framebuffer, triple buffered | 59 fps, no tearing |
| ARM assembly runs, sound synthesis on core 1 | Metal Slug 2 playable |

Metal Slug 2, X and 3 also slow down on the original arcade board in their busiest scenes. neo3ds
drops frames in the same places, and so do PC emulators.

## How bugs were found

- **MAME as ground truth.** Official MAME, headless, with a Lua script that taps the 68000's sound
  command port and the Z80's YM2610 ports, gives a log of every command and register write. The same
  log from neo3ds, compared per command, found a corrupted sound ROM layout and the sound timing bug
  above. A script that inserts a coin and lets the timer run out reaches the continue screen without
  playing.
- **Determinism checks.** With no input the emulation is repeatable, so a checksum at a fixed frame
  shows whether an optimization changed anything.
- **Azahar** (3DS emulator) for quick runs. It counts instructions rather than modelling the ARM11's
  memory timings, so it is good for comparing how much work code does, not for absolute speed.

## Credits

gngeo (Peponas Mathieu and contributors), Cyclone 68000 (Dave, notaz), DrZ80 (Reesy), the YM2610
core from MAME, MAME (decryption and hardware reference), zstd and LZ4, libctru and devkitPro. Full list in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
