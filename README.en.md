# neo3ds - NeoGeo emulator for Nintendo 3DS

**A NeoGeo (Neo Geo) emulator and converter that turns Neo Geo games into full-speed 3DS titles, even on the original (Old) 3DS.**
Give it a Neo Geo ROM zip on your PC and it builds a 3DS install file (CIA) with the emulator inside.
Each game gets its own HOME menu icon and starts straight away. New 3DS models run it with room to spare.

[Project page](https://zzcx88.github.io/neo3ds/) · [한국어](README.md) · [Web converter](https://zzcx88.github.io/neo3ds/convert.html)

| Metal Slug 3 (Old 3DS hardware) | KOF '99 (Old 3DS hardware) |
|---|---|
| [![Metal Slug 3 on hardware](docs/images/thumb_mslug3_black.jpg)](https://youtube.com/shorts/tM-fU44WTpA) | [![KOF99 on hardware](docs/images/thumb_kof99_black.jpg)](https://youtube.com/shorts/EF6eDKhlq-E) |
| Click to watch on YouTube (41 s) | Click to watch on YouTube (66 s) |

## Features

- **60 fps on an Old 3DS (268 MHz)**: verified on hardware with KOF98, KOF99, KOF2000, KOF2002, Metal Slug, Metal Slug X, Metal Slug 3, SVC Chaos and Samurai Shodown V Special.
- **One CIA per game** with its own HOME menu icon. No launcher in between.
- **Launcher (1.1.0)**: or install one launcher app and pick games from the game files on the SD card.
- **Quick save (1.1.0)**: three slots per game, from the bottom screen or SELECT + L/R.
- **Service menu and backup RAM (1.1.0)**: open the arcade (MVS) BIOS settings menu; settings and high scores the board saves are kept on the SD card.
- **Region (1.1.0)**: Europe/Asia, Japan or USA. Japan gives the Japanese versions' content, such as the blood in Metal Slug.
- **Batch conversion (1.1.0)**: drop several zips and they are converted one after the other.
- **Fast start and exit**: runs in the 3DS's default 64 MB memory mode, so there is no system reload when a game starts or quits.
- **Plain MAME romsets**: knows all 282 MAME Neo Geo romsets and converts 242 of them. Encrypted later games (KOF99, Garou, Metal Slug 3-5, KOF2000-2003, SVC Chaos...) are decrypted during conversion.
- **Bottom screen GUI**: touch buttons for key config, turbo, system (AES/MVS), diagnostics, restart, the service menu and quick save, with the current key layout in the Neo Geo button colours.
- **Key config**: map each button to a Neo Geo button or a combination (A+B...), saved per game.
- **Turbo (rapid fire)**: R + a face button toggles it; 20 presses a second.
- **Restart**: hold SELECT + START for a second to restart the game.
- **Generated icon and banner** from the game title, or use your own pictures.
- Converter in **English and Korean**.

## What you need

| | |
|---|---|
| 3DS | Old 3DS / 2DS / New 3DS / New 2DS XL with [Luma3DS](https://github.com/LumaTeam/Luma3DS) custom firmware and a CIA installer such as [FBI](https://github.com/lifehackerhansol/FBI). |
| PC | A web browser (Chrome, Edge, Firefox, Safari). Roms stay inside the browser and are never uploaded. |
| ROMs | **MAME romset zips** of games you own, plus **neogeo.zip (BIOS)**. No ROMs are included here. |
| Sound | `/3ds/dspfirm.cdc` on the SD card (dump it once with DSP1). |

## How to use

### 1. Open the web converter
Open the [web converter](https://zzcx88.github.io/neo3ds/convert.html). Nothing to install.

### 2. Build a CIA

1. Drop the game zip together with `neogeo.zip`. Keep the MAME file names (`kof99.zip`, `mslug3.zip`...). For merged sets, drop the game + parent zips together.
2. If the game is recognised, it can be converted. If it is red, the reason is shown.
3. Change the **System** or **Region** if you like.
   - **System** is the BIOS the game starts on (Automatic = home AES, MVS only for games modified for arcade boards); it can be switched on the 3DS too.
   - **Region** is the console region the game sees. The default is Europe/Asia; **Japan** gives content only the Japanese versions have, such as the blood in Metal Slug, and Japanese text (varies by game). If neogeo.zip has no BIOS for that region, another region's BIOS is used and the log says so.
4. Press **[Build CIA]**. A game takes tens of seconds to a minute or two (graphics compression).
5. When done, save it with **[Get the CIA]**. The CIA size, browser memory and estimated 3DS memory are shown below.

Drop **several** game zips at once to convert them one after the other; each finished file gets its own download link.

The **KO/EN** buttons at the top right switch the language.

Examples of the generated icons (abbreviation + series number) and banners (game title), sized so no text is cut off:

<img src="docs/images/art_examples.png" width="760" alt="Generated icon and banner examples">

### 3. Install on the 3DS
Copy the `.cia` to the SD card, then in FBI: SD → pick the file → **Install CIA**. The game appears on the HOME menu.

### Use the launcher (game list app)

<img src="docs/images/launcher.png" width="400" alt="Launcher game list">

Instead of installing a CIA per game, pick games from one app. Only one HOME menu icon is added.

1. Install `neo3ds-launcher.cia`, built in **[Launcher CIA]** mode of the web converter, with FBI, **once**.
2. Convert a game zip in **[Launcher file]** mode to get a `.neo3ds` file. The settings (system, region) work as for a CIA.
3. Copy the `.neo3ds` files to `/neo3ds/games/` on the SD card.
4. Start the launcher: pick a game with Up/Down (L/R for a page) or by touch, and start it with **A** or **a double tap**.
5. In a game, tap **[Game list]** on the bottom screen twice to go back to the list.

The same game shares its key config, backup RAM and quick saves whether it runs as a CIA or from the launcher.

### The desktop converter (Windows)
Prefer a PC program over the browser? Grab `neo3ds-converter.zip` from the releases and unpack it (keep the exe and the `tools\` folder together). It runs the same logic as the web converter; see [build.md](docs/build.md) §3 for usage.

## Controls

<img src="docs/images/main_kof99.png" width="400" alt="Game on the top screen, buttons on the bottom screen">

These are the defaults. Buttons can be changed per game in [Key config](#key-config), and the bottom screen shows the current layout.

| 3DS | Neo Geo |
|---|---|
| D-pad | Joystick |
| B / A / Y / X | A / B / C / D |
| SELECT | Coin |
| START | Start |
| R + B/A/Y/X | Turbo on/off (see below) |
| SELECT + L / SELECT + R | Quick save / quick load (see below) |
| Hold SELECT + START for 1 s | Restart the game |

### Bottom screen

| Button | What it does |
|---|---|
| **Key config** | Opens the key config screen (see below) |
| **Turbo** | Each tap moves turbo off → A → B → X → Y, saved at once |
| **System** | Switches between the home (AES) and arcade (MVS) BIOS. Tap twice (to avoid accidents); the game restarts on it |
| **Diagnostics** | Opens the diagnostics; touch anywhere to go back |
| **Restart** | Hold it until the yellow bar fills to restart the game |
| **Service** | Opens the MVS BIOS service menu (see below). Shows `Service: MVS only` on AES (`(MVS only)` in the launcher) |
| **Slot / Save / Load** | Pick a quick save slot / save / load (tap twice) (see below) |
| **Game list** | Only when started from the launcher: tap twice to go back to the game list. Restart then reads `Hold: reset` |

Below them is the current key layout as `3DS button > Neo Geo button`, in the colours of the arcade panel (A red, B yellow, C green, D blue); START and SELECT are left out while they are Start and Coin. The game title and fps are at the top.

**Restart**: starts the game over as if the console were switched off and on (the cartridge's save data is kept). Holding SELECT and START together for a second does the same; while both are held, they don't reach the game as coin and start.

## Key config

<img src="docs/images/keyconfig3_kof99.png" width="400" alt="Key config screen (L = A+B, R = C+D)">

Tap **Key config** on the bottom screen; the game pauses and the config screen opens.

- Each of A / B / X / Y / L / R / ZL / ZR / START / SELECT can press **Neo Geo A-D, a combination (A+B, C+D, B+C, A+B+C, B+C+D, A+B+C+D), Start or Coin**. For example in KOF: L = A+B (dodge), R = C+D (blowback).
- Tap the `<` `>` at the end of a line, or pick a line with Up/Down and change it with Left/Right (or A). The **turbo button** can be set here too.
- **B** or `Save (B)` saves and returns to the game. `Default` restores the default layout.
- **System** switches between the home (AES) and arcade (MVS) BIOS (like the System button on the bottom screen); saving restarts the game on it. On MVS, press SELECT to insert a coin before starting, and the BIOS's green test screen shows briefly at boot. If neogeo.zip had only one BIOS, it says `only` and can't be changed.
- Settings are saved **per game** on the SD card in `/3ds/neo3ds/keys/` and kept across launches.

## Turbo (rapid fire)

<img src="docs/images/turbo2_kof99.png" width="400" alt="Turbo enabled (Turbo: A)">

- Use the **Turbo** button on the bottom screen (saved), or **hold R and press A, B, X or Y** to make that button the turbo button.
- Hold R and press **the same button again** to turn turbo off, or **another button** to move turbo there. Only one button has turbo at a time.
- **While you hold** the turbo button it is pressed and released 20 times a second. Single taps still fire once.
- The bottom screen shows the state: `Turbo: A` or `Turbo: off`.
- While R is held, A/B/X/Y don't reach the game, so setting turbo never makes your character act.
- Turbo set with R + button lasts for this session; set it in Key config to keep it. If R is mapped to something, turbo can only be changed in Key config.

## Quick save

Three slots per game hold the exact state of the game.

- **Slot** moves through slots 1 → 2 → 3, and the status line shows when that slot was saved (`Slot 2: 10-18 14:05 AES`, or `empty`).
- **Save** saves to the slot. **Load** needs two taps, to avoid accidents.
- **SELECT + L** (save) and **SELECT + R** (load) do the same; those buttons don't reach the game then.
- A slot saved on the other BIOS (AES/MVS) switches to that BIOS before it loads.
- Slots survive restarts, but **slots from another neo3ds version can't be loaded** (`from another version`). Backup RAM (below) is kept across versions.

## Service menu and backup RAM

- On the arcade (MVS) BIOS, **Service** on the bottom screen acts as the board's test switch and opens the BIOS service menu (game settings such as difficulty and credits, hardware tests and more).
- The MVS board's **backup RAM** (game settings, high scores, ranking initials...) is saved to the SD card: only when it changes, and straight away when you go to the HOME menu, close the game or the console sleeps.

## Where things are saved

| File | SD card path |
|---|---|
| Key config | `/3ds/neo3ds/keys/<title ID>.bin` |
| Backup RAM | `/3ds/neo3ds/saves/<title ID>.sram` |
| Quick saves | `/3ds/neo3ds/states/<title ID>.1` to `.3` |
| Launcher game files | `/neo3ds/games/*.neo3ds` |

The title ID comes from the romset (zip) name, so rebuilding from the same zip or starting the game from the launcher uses the same files.

## Diagnostics

<img src="docs/images/diag2_kof99.png" width="400" alt="Diagnostics screen">

Tap **Diagnostics** on the bottom screen for a once-a-second report: fps, main-core time (68000, Z80, timers), second-core time (sound, drawing) and memory use. Touch anywhere to go back to the buttons.

## Compatibility

<img src="docs/images/mslug3_play.png" width="480" alt="Metal Slug 3 in game">

### Verified on an Old 3DS

| Game | Romset | Result |
|---|---|---|
| The King of Fighters '98 | `kof98` (converted as the home version `kof98h`) | Full speed, no drops in fights |
| The King of Fighters '99 | `kof99` (SMA + CMC42 decrypted) | Full speed |
| Metal Slug | `mslug` | Full speed (music that dragged fixed in 1.1.0) |
| Metal Slug 2 | `mslug2` | Playable; slows down where the original board does |
| Metal Slug X | `mslugx` (protection checks patched) | Full speed; slows down where the original board does |
| Metal Slug 3 | `mslug3` (SMA + CMC42 decrypted) | Full speed; slows down where the original board does |
| The King of Fighters 2000 | `kof2000` (SMA + CMC50 decrypted) | Full speed |
| The King of Fighters 2002 | `kof2002` (PCM2 + CMC50 decrypted) | Full speed |
| SNK vs. Capcom: SVC Chaos | `svc` (PVC + PCM2 + CMC50 decrypted) | Full speed |
| SNK vs. Capcom: SVC Chaos Plus | `svcplus` (bootleg; the set Fightcade players use) | Full speed; starts on the MVS BIOS |
| Samurai Shodown V Special | `samsh5sp` (KOF2002 type + PCM2 + CMC50 decrypted) | Full speed (from 1.0.5, zoomed-out scenes optimized) |
| Aero Fighters 3 | `sonicwi3` | Playable (music that stopped after a few seconds fixed in 1.1.0) |
| The King of Fighters 2003 | `kof2003` (PVC + PCM2 + CMC50 decrypted) | 60 fps (user report) |
| Metal Slug 5 | `mslug5` (PVC + PCM2 + CMC50 decrypted) | 60 fps (user report) |
| Garou: Mark of the Wolves | `garou` (SMA + CMC42 decrypted) | 60 fps (user report) |

Metal Slug 2, X and 3 slow down on the original arcade board too, in scenes with lots of enemies and explosions. neo3ds drops frames in the same places, as PC emulators do.

### Converts, but not tried on hardware
- **Most unencrypted games** (1990-1999): KOF94-97, Fatal Fury series (except 2), Samurai Shodown 1-4, World Heroes, The Last Blade 1/2, Blazing Star, Puzzle Bobble and more. They convert the same way as the verified games.
- **Decryption implemented, never run (no ROMs to test)**
  - CMC42: Sengoku 3, Zupapa!, Strikers 1945 Plus, Prehistoric Isle 2, Nightmare in the Dark, Ganryu, Bang Bead
  - CMC50: KOF2001
  - PCM2: Metal Slug 4 / 4 Plus, Rage of the Dragons, Pochi and Nyaa
  - KOF2002 type (KOF2002 and Samurai Shodown V Special verified): 2002 Plus, Samurai Shodown V, Matrimelee

Their memory use should be close to KOF99 and Metal Slug 3, whose ROMs are the same size (about 53 MB of 58 MB). The converter warns when memory gets tight.

### Can't be converted

| Reason | Romsets |
|---|---|
| Protection chip not supported | Fatal Fury 2 (`fatfury2`), Super Sidekicks (`ssideki`) |
| MVS protection chip | KOF98 MVS sets (`kof98`, `kof98a`, `kof98k`, `kof98ka`). A merged `kof98.zip` converts as the home version `kof98h` automatically |
| Special controller | The Irritating Maze (`irrmaze`, trackball) |
| Gambling boards | V-Liner (`vliner` sets), Jockey Grand Prix (`jockeygp` sets) |
| Bootlegs | 27 sets (only `svcplus` is supported) such as `kof10th`, `kf2k2mp`, `kof2002b`, `cthd2003`, `ms5plus`, `svcboot`, `svcplusa`, `kf2k3bl`, `mslug3b6`, `kog`, `sbp` |

Mahjong games lack mahjong panel input, and the 4-player `kizuna4p` plays with two players.

## Battery life

Measured on an Old 3DS with a CameronSino 1300 mAh third-party battery, running Metal Slug 3. This is a single run, so treat it as a rough guide.

| Settings | Used per hour | From a full charge | |
|---|---|---|---|
| Brightness 3 (middle), Wi-Fi off, power saving off, medium volume | 19.5% (95% → 75.5%) | about 5 hours | measured + estimate |
| Max brightness, Wi-Fi on | – | about 3–4 hours | estimate |

- The hourly use is measured; the full-charge figure is simply that scaled up. The gauge drops slowly near empty, so it may last a little longer.
- With the same battery, a battery benchmark (max brightness, 3D on, Wi-Fi on) went from 95% to 5% in 2 hours. With neo3ds the gauge drops at a little under half that rate.
- Max brightness with Wi-Fi on was not measured; it adds the power of the brighter backlight and Wi-Fi to the measured figure.
- No GPU work, both cores sleep while they have nothing to do, and during play the SD card is written only when the backup RAM changes or you quick save. (Measured with 1.0.x.) The picture stays 2D even with the 3D slider up.
- Results vary with the game and with the battery's age and capacity.

## 64 MB mode and the optimizations

An Old 3DS has two 268 MHz ARM11 cores, and apps get 64 MB in the default memory mode.
The 80 MB mode has more room but makes the system reload every time a game starts or exits, which is slow.
So the goal was to **fit 64 MB graphics ROMs into the default 64 MB mode**.

### Memory
- **Compressed graphics**: the sprite ROM (up to 64 MB) is zstd-compressed (level 19) in 4 KB blocks, to about 30% (KOF99: 64 MB → 19.6 MB).
- **8 MB block cache**: only the blocks on screen are unpacked. Fully transparent tiles are skipped using a usage table, so they are never read.
- **Heap layout**: 58 MB heap and 2 MB linear memory for the screen. KOF99 uses 51.5 MB.
- **Decrypted ahead of time**: encrypted ROMs are decrypted on the PC, costing the 3DS neither memory nor time.

### Speed
- **Two cores**: the main core runs only the 68000, Z80 and timers; the second core synthesizes sound and draws the screen.
- **Split sound chip**: the YM2610 runs as two copies. The main-core copy handles timers, interrupts and status; the second-core copy replays the logged register writes to make the sound.
- **Sprite renderer**: unzoomed sprites are drawn tile by tile, and opaque 8-pixel runs are written by ARM assembly in one go, straight into the 3DS's rotated framebuffer. Horizontally shrunk rows use straight-line code unrolled at compile time for each of the 16 zoom steps and both flips, so games that zoom out a lot (Samurai Shodown) stay fast.
- **Output**: the CPU draws into the framebuffer (no GPU round trip) with triple buffering, so nothing tears. Cache flushes use an SVC directly instead of a system service, so the second core never stalls waiting on one. The bottom screen GUI is drawn by the CPU too, but only when something changes, so it costs next to nothing while you play.
- **Visible area only**: draws the Neo Geo's real 304×224 picture.
- **Frame pacing**: a vblank that has already passed is not waited for, so a frame that runs a little long doesn't lose a whole frame.
- **Sound driver idle skip**: the loop Metal Slug 2, X and 3's Z80 spends waiting for its interrupt is skipped, with exactly the same result.
- **BIOS**: uses the home (AES) BIOS from neogeo.zip when present, otherwise an arcade (MVS) BIOS, looking for the chosen region's BIOS first.

New 3DS models are set to 804 MHz with the L2 cache on, for plenty of headroom (not tested on hardware).

The [technical write-up](docs/TECHNICAL.md) goes into more detail: measurements, what was tried and dropped, and how bugs were found.

## Building from source

- Engine: [devkitPro](https://devkitpro.org/) (devkitARM, libctru). `bash scripts/build_engine.sh` → `engine/engine.elf`
- Converter (web): emsdk. `bash scripts/build_wasm.sh` → `site/vendor/` (3 WASM builds + static assets), then serve `site/` statically
- Converter (C#, Windows exe + baseline): .NET 10 SDK. `dotnet build -c Release converter/Neo3dsConverter`
- Game DB: fetch MAME's `src/mame/snk/neogeo.cpp` and run `py scripts/gen_gamedb.py neogeo.cpp converter/assets/neogeo_games.json`.

## Legal

- This repository and its releases contain **no ROMs, BIOS or game data**. You need ROMs of games you own.
- The CIAs you build contain ROM data: **do not share them.**
- neo3ds is for **non-commercial use only**, because its CPU cores (Cyclone 68000, DrZ80) are licensed for non-commercial use only.
- The source code is GPL-2.0 ([LICENSE](LICENSE)). Third-party code and licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- NEOGEO and SNK are trademarks of SNK CORPORATION; Nintendo 3DS is a trademark of Nintendo. neo3ds is an independent fan project, not affiliated with either. Game footage and screenshots belong to their respective owners.

## Thanks

gngeo (Peponas Mathieu), Cyclone 68000 (Dave, notaz), DrZ80 (Reesy), the MAME team (romset data and cart decryption research), Zstandard, devkitPro / libctru, makerom, bannertool, and Azahar (testing during development).
