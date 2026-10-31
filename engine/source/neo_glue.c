// Frame driver for the gngeo core: the parts of gngeo's emu.c that neo3ds keeps.
#include <3ds.h>
#include <string.h>

#include "neo_glue.h"
#include "savestate.h"
#include "emu.h"
#include "memory.h"
#include "pd4990a.h"
#include "video.h"
#include "timer.h"
#include "ym2610/2610intf.h"
#include "audio.h"

neo_conf conf;
/* Profiling, in system ticks: 0 = CPUs (68k + Z80 + timers), 1 = sprite/fix drawing, 2 = screen copy, 3 = audio. */
u64 prof_ticks[6];
u64 prof_split[3]; /* 68k, Z80, timers: sampled frames only */
unsigned prof_split_frames;
char fps_str[32];

/* video.c / memory.c globals that gngeo defined in files neo3ds does not build */
int current_line;
int nb_interlace = 264; /* my_timer() calls per frame (one per scanline) */
int neogeo_fix_bank_type; /* 0: no banked fix layer (needed by Garou/MSlug3-era games) */

static int frame_counter_tick;
int neo_watchdog_resets;

int neo_boot_ff;
static int boot_game_frames; /* frames in a row that ended in the game's code */

void neogeo_reset(void) {
	/* The MVS BIOS checks the board for ~4-9s before it starts the game: run that part without
	 * drawing or waiting for the vblank (at most 20s of it, in case the BIOS stops on an error).
	 * The check draws garbage sprites, which can take a second a frame to unpack. */
	neo_boot_ff = memory.mvs ? 1200 : 0;
	boot_game_frames = 0;
	sram_lock = 0;
	sound_code = 0;
	pending_command = 0;
	result_code = 0;
	if (memory.rom.cpu_m68k.size > 0x100000)
		cpu_68k_bankswitch(0x100000);
	else
		cpu_68k_bankswitch(0);
	cpu_68k_reset();
}

// The restart combo: as if the console were switched off and on, keeping the backup RAM.
void neo_restart(void) {
	extern Uint16 pvc_ram[0x1000];
	memset(memory.ram, 0, sizeof memory.ram);
	memset(pvc_ram, 0, sizeof pvc_ram);
	memory.watchdog = 0;
	/* the board's fix ROM is selected at power on (the BIOS may have been switched) */
	if (memory.rom.bios_sfix.p) {
		current_fix = memory.rom.bios_sfix.p;
		fix_usage = memory.fix_board_usage;
		memory.vid.currentfix = 0;
	} else {
		current_fix = memory.rom.game_sfix.p;
		fix_usage = memory.fix_game_usage;
		memory.vid.currentfix = 1;
	}
	cpu_z80_init();
	YM2610_sh_reset();
	neogeo_reset();
}

void neo_init(void) {
	conf.sound = 1;
	/* the ADPCM-A playback rate (8MHz / 432): sound effects and voices need no resampling, and 16%
	 * fewer samples to synthesize than 22050Hz */
	conf.sample_rate = 18518;
	conf.raster = 0;
	conf.pal = 0;
	conf.system = SYS_ARCADE;
	conf.country = CTY_EUROPE;

	current_pal = memory.vid.pal_neo[0];
	current_pc_pal = (Uint32 *)memory.vid.pal_host[0];
	if (memory.rom.bios_sfix.p) {
		current_fix = memory.rom.bios_sfix.p;
		fix_usage = memory.fix_board_usage;
	} else { /* AES has no board fix ROM */
		current_fix = memory.rom.game_sfix.p;
		fix_usage = memory.fix_game_usage;
		memory.vid.currentfix = 1;
	}

	init_video();
	cpu_68k_init();
	pd4990a_init();
	cpu_z80_init();
	YM2610_sh_start();
	neogeo_reset();
}

void neo_set_input(Uint8 p1, Uint8 p2, Uint8 start, Uint8 coin) {
	memory.intern_p1 = p1;
	memory.intern_p2 = p2;
	memory.intern_start = start;
	memory.intern_coin = coin;
}

#define LINES_PER_FRAME 264
#define M68K_CYCLES_PER_FRAME 200000 /* 12 MHz / ~59.2 Hz */
#define Z80_CYCLES_PER_FRAME 73333   /* 4 MHz */

// One emulated frame: both CPUs advance a scanline at a time so 68k sound
// commands and Z80 replies interleave as on hardware, then VBlank renders and
// raises IRQ1. The frame starts at VBlank (MAME's line 240); IRQ2 is counted a line
// at a time, and sprite moves after an IRQ2 are drawn from its line (video.c).
void neo_run_frame(bool render) {
	u64 t0 = svcGetSystemTick();
	video_raster_reset();
	if (memory.vid.irq2control & 0x40) irq2_load(287); /* as MAME: VBlank reloads at pixel 287 of the line */
	if (audio_behind()) { /* sound only: the 68k waits, the music keeps its tempo */
		for (current_line = 0; current_line < LINES_PER_FRAME; current_line++) {
			cpu_z80_run(Z80_CYCLES_PER_FRAME / LINES_PER_FRAME);
			my_timer();
		}
		audio_next_part();
	}
	/* Every 16th frame, time the 68k, Z80 and timers separately (reading the tick 1600 times a
	 * frame costs too much to do always). */
	static unsigned split_frame;
	if ((++split_frame & 15) == 0) {
		u64 a = t0, b;
		for (current_line = 0; current_line < LINES_PER_FRAME; current_line++) {
			cpu_68k_run_slice(M68K_CYCLES_PER_FRAME / LINES_PER_FRAME);
			b = svcGetSystemTick(); prof_split[0] += b - a; a = b;
			cpu_z80_run(Z80_CYCLES_PER_FRAME / LINES_PER_FRAME);
			b = svcGetSystemTick(); prof_split[1] += b - a; a = b;
			my_timer();
			irq2_line();
			b = svcGetSystemTick(); prof_split[2] += b - a; a = b;
		}
		prof_split_frames++;
	} else
	for (current_line = 0; current_line < LINES_PER_FRAME; current_line++) {
		cpu_68k_run_slice(M68K_CYCLES_PER_FRAME / LINES_PER_FRAME);
		cpu_z80_run(Z80_CYCLES_PER_FRAME / LINES_PER_FRAME);
		my_timer();
		irq2_line();
	}

	pd4990a_addretrace();
	if (!(memory.vid.irq2control & 0x8)) {
		if (frame_counter_tick >= (int)neogeo_frame_counter_speed) {
			frame_counter_tick = 0;
			neogeo_frame_counter++;
		}
		frame_counter_tick++;
	}
	u64 t1 = svcGetSystemTick();
	prof_ticks[0] += t1 - t0;
	if (render) draw_screen();
	prof_ticks[1] += svcGetSystemTick() - t1;

	if (neo_boot_ff) { /* ends once the game's code has run for half a second (Metal Slug 2 runs
	                    * it for 7 frames before the board check, then goes back to the BIOS) */
		boot_game_frames = cpu_68k_getpc() < 0xc00000 ? boot_game_frames + 1 : 0;
		if (boot_game_frames == 30) neo_boot_ff = 0;
		else neo_boot_ff--;
	}

	if (++memory.watchdog > 7) { /* watchdog reset after ~0.13s without a kick */
		neo_watchdog_resets++;
		memory.watchdog = 0;
		cpu_68k_reset();
	}
	cpu_68k_interrupt(1);
}

/* neo3ds: save states (savestate.c) */
void glue_state(void) {
	st_bytes(&frame_counter_tick, sizeof frame_counter_tick);
	st_bytes(&neogeo_frame_counter, sizeof neogeo_frame_counter);
	st_bytes(&neogeo_frame_counter_speed, sizeof neogeo_frame_counter_speed);
}
