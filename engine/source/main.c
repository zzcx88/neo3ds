// neo3ds - Neo Geo emulator for Old 3DS. Platform layer: video out, input, main loop.
#include <3ds.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <malloc.h>
#include <sys/stat.h>

#include "audio.h"
#include "loader.h"
#include "neo_glue.h"
#include "emu.h"
#include "memory.h"
#include "screen.h"
#include "video.h"
#include "keys.h"
#include "save.h"
#include "savestate.h"
#include "launcher.h"
#include "recv_test.h"
#include "snapshot.h"
#include "ui.h"
#include "drz80/DrZ80.h"

#define MB (1024.0 * 1024.0)
#define SPRITE_CACHE_BYTES (8u << 20)

/* The app runs in the default 64MB memory mode (a larger mode makes the system reload the HOME
 * menu when the game starts and exits). libctru would reserve 32MB of linear (GPU/DSP) memory;
 * we only need it for the framebuffers (~1.3MB) and audio buffers. */
u32 __ctru_linear_heap_size = 2u << 20;
/* KOF98 uses ~52MB with zstd sprites; the code, static data and stack take ~1.9MB of the 64MB. */
u32 __ctru_heap_size = 58u << 20;

/* The renderer draws the top-screen framebuffer in bands (video_band). gngeo's own 352x256
 * surface is only used by its unused scanline renderer. */
static SDL_Surface frame = {352, 256, 352 * 2, NULL, {0, 0, 352, 256}};
SDL_Surface *buffer = &frame;
SDL_Rect visible_area = {16, 16, 320, 224};

static PrintConsole bottom;

/* Profiling, ms/frame: 0 = 68k/Z80, 1 = frame end on the main core (snapshot and waiting for the
 * core 1), 2 = buffer swap, 3 = sound, 4 = rendering (includes 2), 5 = YM2610
 * synthesis (part of 3). 3-5 run on core 1 when threaded. */
extern u64 prof_ticks[6];
extern unsigned spr_lines[4]; /* sprite lines drawn per kind (video.c), for the diagnostics */

/* Top screen, triple buffered: libctru's gfx only double-buffers, and with a frame taking most of
 * 16.7ms to draw, the next frame would start in the buffer still on screen (its swap is applied
 * at the following vblank), showing half-drawn frames. One buffer is on screen, one may be
 * waiting for the vblank, and the renderer always draws into the third. */
#define TOP_BYTES (400 * 240 * 2)
/* LCD mode for gspPresentBuffer, as libctru's gfx computes it for a 2D top screen in linear
 * memory: framebuffer format | BIT(6) (2D) | BIT(8). */
#define TOP_MODE (GSP_RGB565_OES | BIT(6) | BIT(8))
static u16 *top_bufs[3];
static bool top_full[3]; /* the buffer was last drawn full screen (no black borders left) */
static int top_shown = -1, top_pending = -1, top_target; /* indices into top_bufs, -1 = none */
static unsigned top_swap;

static bool video_init(void) {
	for (int i = 0; i < 3; i++) {
		top_bufs[i] = linearAlloc(TOP_BYTES);
		if (!top_bufs[i]) return false;
		memset(top_bufs[i], 0, TOP_BYTES); /* black borders around the 320x224 picture */
		svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)top_bufs[i], TOP_BYTES);
	}
	return true;
}

/* The picture is drawn in bands (video_band). Core 1 opens them for each frame, and the main core
 * takes bands too while it would otherwise wait for core 1 at the end of its frame. Each core has
 * its own band buffer and cleans the cache lines it wrote. */
static int band_next = VIDEO_BANDS, band_done; /* atomic: next band to take, bands finished */
static u16 *band_fb;
static bool band_full; /* the frame is stretched to the full screen */
static u16 band_bufs[2][VIDEO_BAND_PIXELS] __attribute__((aligned(32))); /* core 1, main core */
static unsigned bands_helped; /* bands drawn by the main core (diagnostics) */

/* Takes bands until none is left; returns how many this core drew. */
static unsigned band_work(u16 *buf) {
	unsigned n = 0;
	for (int b; (b = __atomic_fetch_add(&band_next, 1, __ATOMIC_ACQUIRE)) < VIDEO_BANDS; n++)
		video_band(b, buf, band_fb, band_full);
	if (!n) return 0;
	/* The kernel call directly: GSPGPU_FlushDataCache goes through the GSP service, which runs on
	 * core 1 and gets little time while the render thread is busy there. */
	if (band_full) svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)band_fb, TOP_BYTES);
	else svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)(band_fb + 40 * 240), 320 * 240 * 2);
	__atomic_fetch_add(&band_done, n, __ATOMIC_RELEASE); /* counted once they reach memory */
	return n;
}

/* Signalled once per frame by core 1 when the bands are open */
static LightEvent render_help;
static Thread render_thread;

// Draws the last snapshot into a free top-screen buffer and queues it for the next vblank.
// No GPU work and no waiting on the GSP service.
static void render_frame(void) {
	u16 *fb = top_bufs[top_target];
	const bool full = keys_full_screen;
	if (!full && top_full[top_target]) { /* back to 1:1: the borders must be black again */
		memset(fb, 0, TOP_BYTES);
		svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)fb, TOP_BYTES);
	}
	top_full[top_target] = full;
	video_prepare();
	band_fb = fb;
	band_full = full;
	band_done = 0;
	__atomic_store_n(&band_next, 0, __ATOMIC_RELEASE);
	if (render_thread) LightEvent_Signal(&render_help);
	band_work(band_bufs[0]);
	while (__atomic_load_n(&band_done, __ATOMIC_ACQUIRE) < VIDEO_BANDS) {} /* the main core's last band */
	u64 t0 = svcGetSystemTick();
	/* false: the previously presented buffer has been put on screen; true: it never was and is
	 * replaced, so the one on screen stays. */
	if (!gspPresentBuffer(GSP_SCREEN_TOP, top_swap, fb, fb, 240 * 2, TOP_MODE)) top_shown = top_pending;
	top_swap ^= 1;
	top_pending = top_target;
	for (int i = 0; i < 3; i++)
		if (i != top_shown && i != top_pending) {
			top_target = i;
			break;
		}
	prof_ticks[2] += svcGetSystemTick() - t0;
}

/* The bottom-screen console is single buffered; write its text back for the display without
 * gfxFlushBuffers, which goes through the GSP service. */
static void flush_console(void) {
	u16 w, h;
	u8 *fb = gfxGetFramebuffer(GFX_BOTTOM, GFX_LEFT, &w, &h);
	svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)fb, w * h * 2);
}

/* Rendering runs on core 1: at the end of each emulated frame the main core copies the video
 * state (video_snapshot) and core 1 draws it while the main core emulates the next frame. */
static LightEvent render_go, render_idle;
static volatile bool render_quit;

static bool skip_video; /* set by the main core before it hands a frame over */

static void render_main(void *arg) {
	(void)arg;
	for (;;) {
		LightEvent_Wait(&render_go);
		if (render_quit) break;
		u64 t0 = svcGetSystemTick();
		audio_render();
		u64 t1 = svcGetSystemTick();
		if (!skip_video) render_frame();
		prof_ticks[3] += t1 - t0;
		prof_ticks[4] += svcGetSystemTick() - t1;
		LightEvent_Signal(&render_idle);
	}
}

static void render_thread_start(void) {
	s32 prio = 0x30;
	svcGetThreadPriority(&prio, CUR_THREAD_HANDLE);
	APT_SetAppCpuTimeLimit(80); /* share of core 1 the application may use */
	LightEvent_Init(&render_go, RESET_ONESHOT);
	LightEvent_Init(&render_idle, RESET_ONESHOT);
	LightEvent_Init(&render_help, RESET_ONESHOT);
	LightEvent_Signal(&render_idle);
	LightEvent_Signal(&render_help);
	render_thread = threadCreate(render_main, NULL, 32 * 1024, prio - 1, 1, false);
}

static void render_thread_stop(void) {
	if (!render_thread) return;
	LightEvent_Wait(&render_idle);
	render_quit = true;
	LightEvent_Signal(&render_go);
	threadJoin(render_thread, U64_MAX);
	threadFree(render_thread);
	render_thread = NULL;
}

void screen_frame_end(void) {
	const bool skip = neo_boot_ff != 0; /* MVS BIOS start-up: sound only */
	if (!render_thread) {
		u64 t0 = svcGetSystemTick();
		audio_end_frame(conf.sample_rate);
		audio_render();
		u64 t1 = svcGetSystemTick();
		if (!skip) {
			video_snapshot();
			render_frame();
		}
		prof_ticks[3] += t1 - t0;
		prof_ticks[4] += svcGetSystemTick() - t1;
		return;
	}
	if (!skip_video) { /* core 1 is drawing the previous frame: help it with the bands */
		LightEvent_Wait(&render_help);
		bands_helped += band_work(band_bufs[1]);
	}
	LightEvent_Wait(&render_idle); /* core 1 is done with the previous frame */
	audio_end_frame(conf.sample_rate);
	skip_video = skip; /* core 1 reads it only after render_go */
	if (!skip) video_snapshot();
	LightEvent_Clear(&render_help); /* left over when render_idle was waited on elsewhere */
	LightEvent_Signal(&render_go);
}

void screen_update(void) {} /* frames reach the screen through render_frame */


// Paces the main loop at 60Hz; the render thread has already queued the frame.
// nextEvent=false: if the vblank already came while this frame was being emulated, go straight
// on to the next one instead of waiting for the vblank after it. A frame that runs a little over
// 16.7ms then costs a little time instead of a whole extra frame, and the next one catches up.
static void present_frame(void) {
	gspWaitForEvent(GSPGPU_EVENT_VBlank0, false);
}

static void show_progress(const char *file, Uint32 done, Uint32 total) {
	printf("\r %-8s %5.1f / %5.1f MB", file, done / MB, total / MB);
	gfxFlushBuffers();
	gfxSwapBuffers();
}

// Bytes of the heap area that are actually mapped right now (walks the memory map from 0x08000000).
static u32 heap_mapped(void) {
	u32 addr = OS_HEAP_AREA_BEGIN, total = 0;
	while (addr < OS_HEAP_AREA_END) {
		MemInfo mi;
		PageInfo pi;
		if (R_FAILED(svcQueryMemory(&mi, &pi, addr)) || mi.state == MEMSTATE_FREE) break;
		total += mi.base_addr + mi.size - addr;
		addr = mi.base_addr + mi.size;
	}
	return total;
}

static void print_memory(void) {
	struct mallinfo mi = mallinfo();
	printf("mem used %.1f  mapped %.1f/%.1f  free %.1f MB  \n", mi.uordblks / MB, heap_mapped() / MB,
	       __ctru_heap_size / MB, osGetMemRegionFree(MEMREGION_APPLICATION) / MB);
}

// Turbo (rapid fire): R + A/B/X/Y picks the button, the same combination again turns it off.
// While the turbo button is held it is pressed for (TURBO_FRAMES+1)/2 frames and released for the rest.
enum { TURBO_FRAMES = 3 }; /* 60 fps / 3 = 20 presses a second: 2 frames down, 1 up */
static const u32 face_keys = KEY_A | KEY_B | KEY_X | KEY_Y;
static int turbo_phase;
#ifdef NEO3DS_DIAG_START /* Azahar tests: start on the diagnostics */
static bool show_stats = true;
#else
static bool show_stats; /* the diagnostics (text console) instead of the GUI on the bottom screen */
#endif

static void show_turbo(void) {
	if (show_stats) {
		printf("\x1b[28;2HTurbo: %-20s", keys_button_name(keys_turbo));
		flush_console();
	} else ui_turbo_changed();
}

// Returns the keys as the game should see them, with turbo applied. While R is free (not
// mapped to anything), R + A/B/X/Y sets or clears the turbo button for this session.
static u32 turbo_filter(u32 k) {
	const u32 down = hidKeysDown();
	if ((k & KEY_R) && keys_r_free()) {
		const u32 hit = down & face_keys;
		if (hit) {
			const u32 key = hit & -hit; /* lowest bit if several land together */
			keys_turbo = keys_turbo == key ? 0 : key;
			show_turbo();
		}
		return k & ~face_keys; /* face buttons only set turbo while R is held */
	}
	if (!keys_turbo || !(k & keys_turbo)) return k;
	if (down & keys_turbo) turbo_phase = 0; /* first press lands at once */
	if (turbo_phase++ >= (TURBO_FRAMES + 1) / 2) k &= ~keys_turbo;
	if (turbo_phase == TURBO_FRAMES) turbo_phase = 0;
	return k;
}

// Holding SELECT + START for RESTART_FRAMES restarts the game.
static int restart_hold;

static void read_input(void) {
	u32 k = turbo_filter(hidKeysHeld());
	if ((k & (KEY_SELECT | KEY_START)) == (KEY_SELECT | KEY_START))
		k &= ~(KEY_SELECT | KEY_START); /* the restart combo, not coin + start */
	if ((k & KEY_SELECT) && (k & (KEY_L | KEY_R)))
		k &= ~(KEY_SELECT | KEY_L | KEY_R); /* quick save / load, not coin + buttons */
	const unsigned neo = keys_neo(k);
	/* REG_STATUS_B: bit 7 = hardware type (1 = MVS, 0 = AES, matching the BIOS), bits 4-6 = no memory card */
	Uint8 p1 = 0xFF, start = memory.mvs ? 0xFF : 0x7F, coin = 0x7;
	if ((k & KEY_UP) && !(k & KEY_DOWN)) p1 &= 0xFE;
	if ((k & KEY_DOWN) && !(k & KEY_UP)) p1 &= 0xFD;
	if ((k & KEY_LEFT) && !(k & KEY_RIGHT)) p1 &= 0xFB;
	if ((k & KEY_RIGHT) && !(k & KEY_LEFT)) p1 &= 0xF7;
	if (neo & NEO_A) p1 &= 0xEF;
	if (neo & NEO_B) p1 &= 0xDF;
	if (neo & NEO_C) p1 &= 0xBF;
	if (neo & NEO_D) p1 &= 0x7F;
	if (neo & NEO_START) start &= 0xFE;
	if (neo & NEO_COIN) coin &= 0x6;
#ifdef NEO3DS_AUTOPLAY
	{ /* Azahar tests: coin, start, then fire and walk right, on the schedule of autoplay.lua */
		static int f;
		f++;
		if (f >= 450 && f < 456) coin &= 0x6;
		if (f >= 500 && f < 506) start &= 0xFE;
		if (f >= 550 && f < 5000) p1 &= (f % 20) < 4 ? 0xE7 : 0xF7;
	}
#endif
	neo_set_input(p1, 0xFF, start, coin);
}

static void wait_for_exit(void) {
	printf("\nPress START to exit.\n");
	while (aptMainLoop()) {
		gspWaitForVBlank();
		hidScanInput();
		if (hidKeysDown() & KEY_START) break;
	}
}

#if defined(NEO3DS_VDUMP) || defined(NEO3DS_AUTODUMP)
// Debug snapshot for PC-side analysis: video RAM, palettes and the rendered frame.
static void dump_video_state(void) {
	static int n;
	char path[48];
	mkdir("sdmc:/neo3ds", 0777);
	snprintf(path, sizeof path, "sdmc:/neo3ds/vdump_%02d.bin", n++);
	FILE *f = fopen(path, "wb");
	if (!f) return;
	Uint32 hdr[8] = {0x4444334e /* "N3DD" */, 1, memory.vid.currentpal, memory.vid.irq2control,
	                 neogeo_frame_counter, memory.nb_of_tiles, 240, 400};
	fwrite(hdr, sizeof hdr, 1, f);
	fwrite(memory.vid.ram, sizeof memory.vid.ram, 1, f);
	fwrite(memory.vid.pal_neo, sizeof memory.vid.pal_neo, 1, f);
	fwrite(memory.vid.pal_host, sizeof memory.vid.pal_host, 1, f);
	if (top_pending >= 0) fwrite(top_bufs[top_pending], TOP_BYTES, 1, f); /* last finished frame */
	fclose(f);
	printf("\x1b[19;0Hdumped %s\n", path);
}
#endif

/* Quick save and load, between frames: core 1 first finishes the frame it was given, so both sound
 * chips have taken all the writes so far and none is touched while the state is copied. */
static void state_action(bool save, int slot) {
	if (render_thread) LightEvent_Wait(&render_idle);
	char msg[40];
	bool redraw = false;
	if (save) {
		const StateResult r = savestate_save(slot);
		snprintf(msg, sizeof msg, r == STATE_OK ? "Saved to slot %d" : "Could not save slot %d", slot + 1);
	} else {
		const int board = savestate_board(slot);
		StateResult r = STATE_OK;
		if (board >= 0 && board != memory.mvs) { /* saved on the other BIOS: switch to it first */
			if (!loader_has_bios(board)) r = STATE_OTHER_BUILD;
			else {
				keys_set_bios_mvs(board);
				loader_use_bios(board);
				redraw = true;
			}
		}
		if (r == STATE_OK) r = savestate_load(slot);
		if (r == STATE_OK) neo_boot_ff = 0; /* the state may have been saved in the game */
		if (r == STATE_IO_ERROR) neo_restart(); /* damaged after a valid header: the state is mixed */
		snprintf(msg, sizeof msg,
		         r == STATE_OK ? "Loaded slot %d" : r == STATE_EMPTY ? "Slot %d is empty"
		         : r == STATE_IO_ERROR ? "Slot %d damaged: restarted" : "Slot %d can't be loaded here", slot + 1);
	}
	if (render_thread) LightEvent_Signal(&render_idle);
	if (show_stats) return;
	if (redraw) ui_main_draw();
	ui_status(msg);
}

/* The .neo3ds file started from the launcher ("" in a game's own CIA) */
static char pack_path[160];

/* The frame on the top screen, as the game's picture in the launcher's list. */
static bool take_snapshot(bool manual) {
	if (!pack_path[0] || top_shown < 0 || neo_boot_ff) return false;
	const char *slash = strrchr(pack_path, '/');
	return snapshot_save(slash ? slash + 1 : pack_path, top_bufs[top_shown], manual);
}

static aptHookCookie apt_cookie;
/* The HOME menu or sleep may be followed by the console being switched off */
static void on_apt(APT_HookType type, void *param) {
	(void)param;
	if (type == APTHOOK_ONSUSPEND || type == APTHOOK_ONSLEEP) {
		save_flush();
		ui_screen_on(); /* [LCD off] ends here: the HOME menu would come up with a dark bottom screen */
	}
}

enum { LOG_LINES = 18 }; /* seconds of fps on the diagnostics screen */
/* The time a frame takes, for the once-a-second report. */
static struct {
	u64 report_t;      /* osGetTime() of the last report */
	u64 emu_ticks, present_ticks;
	u64 last_loop;     /* the end of the last frame; 0 after a menu or a save, whose time doesn't count */
	int frames, late;
} pace;

static void restart_with_bios(void) {
	loader_use_bios(keys_bios_mvs());
	neo_restart();
	ui_main_draw();
	ui_status(memory.mvs ? "Restarted with the MVS BIOS" : "Restarted with the AES BIOS");
}

/* What is asked of the game this frame: the touch screen's buttons, then the held combinations. */
static UiAction frame_action(void) {
	UiAction action = UI_NONE;
	if (show_stats) {
		if ((hidKeysDown() | recv_test_touch_down()) & KEY_TOUCH) { /* any touch goes back to the GUI */
			show_stats = false;
			ui_main_draw();
		}
	} else action = ui_main_update();
#ifdef NEO3DS_KEYCONFIG_AT
	{ /* Azahar test (screenshots): open the key config at frame NEO3DS_KEYCONFIG_AT */
		static int frame_no;
		if (++frame_no == NEO3DS_KEYCONFIG_AT) action = UI_KEYCONFIG;
	}
#endif
	if ((hidKeysHeld() & (KEY_SELECT | KEY_START)) == (KEY_SELECT | KEY_START)) {
		if (++restart_hold == RESTART_FRAMES) action = UI_RESTART;
	} else restart_hold = 0;
	if (hidKeysHeld() & KEY_SELECT) { /* SELECT + L / R: quick save / load in the slot picked */
		if (hidKeysDown() & KEY_L) action = UI_STATE_SAVE;
		else if (hidKeysDown() & KEY_R) action = UI_STATE_LOAD;
	}
	{ /* Azahar test: the same two actions, without touching the screen */
		const u32 test = recv_test_keys();
		if (test & KEY_ZL) action = UI_GAME_LIST;
		if (test & KEY_ZR) action = UI_SNAPSHOT;
	}
	return action;
}

/* True when the game is to end. */
static bool take_action(UiAction action) {
	switch (action) {
	case UI_SNAPSHOT:
		ui_status(take_snapshot(true) ? "Snapshot saved for the game list" : "No snapshot taken");
		pace.last_loop = 0;
		break;
	case UI_GAME_LIST: /* back to the list: run the launcher again, from a clean slate */
		recv_test_ui_log("game list");
		aptSetChainloaderToSelf();
		return true;
	case UI_STATE_SAVE:
	case UI_STATE_LOAD:
		state_action(action == UI_STATE_SAVE, ui_state_slot());
		pace.last_loop = 0;
		break;
	case UI_KEYCONFIG:
		recv_test_ui_log("key config");
		keys_menu(); /* the game waits while the menu is open */
		if (keys_bios_mvs() != memory.mvs) restart_with_bios(); /* switching the BIOS restarts the game */
		else ui_main_draw();
		pace.last_loop = 0;
		break;
	case UI_SYSTEM:
		keys_set_bios_mvs(!memory.mvs);
		restart_with_bios();
		break;
	case UI_RESTART:
		neo_restart();
		if (show_stats) {
			printf("\x1b[29;2H\x1b[33mRestarted\x1b[0m");
			flush_console();
		} else ui_status("Restarted");
		break;
	case UI_DIAG:
		recv_test_ui_log("diagnostics");
		show_stats = true;
		consoleClear(); /* filled at the next one-second report */
		show_turbo();
		break;
	default:
		break;
	}
	return false;
}

/* What the test builds do between frames (docs/build.md). Nothing in a normal build. */
static void debug_frame(void) {
#ifdef NEO3DS_BENCH
	/* L+R: draw the current frame 30 times with the old and the new zoomed-row code */
	if ((hidKeysDown() & (KEY_L | KEY_R)) && (hidKeysHeld() & KEY_L) && (hidKeysHeld() & KEY_R)) {
		extern int render_zoom_fast;
		static u16 *scratch;
		if (!scratch) scratch = malloc(TOP_BYTES);
		double ms[2];
		for (int mode = 0; mode < 2; mode++) {
			render_zoom_fast = mode;
			u64 t0 = svcGetSystemTick();
			for (int i = 0; i < 30; i++) video_render(scratch);
			ms[mode] = (svcGetSystemTick() - t0) / (CPU_TICKS_PER_MSEC * 30.0);
		}
		render_zoom_fast = 1;
		printf("\x1b[%d;0Hbench old %5.2f new %5.2f ms", show_stats ? 19 : 26, ms[0], ms[1]);
		flush_console();
	}
#endif
#ifdef NEO3DS_VDUMP
	if ((hidKeysDown() & (KEY_L | KEY_R)) && (hidKeysHeld() & KEY_L) && (hidKeysHeld() & KEY_R))
		dump_video_state();
#endif
#ifdef NEO3DS_YMLOG
	{
		extern int ymlog_frame;
		void ymlog_save(void);
		if (++ymlog_frame == NEO3DS_YMLOG) { ymlog_save(); printf("\x1b[19;0Hymlog saved\n"); }
	}
#endif
#ifdef NEO3DS_SERVICE_AT
	{ /* Azahar test: hold the MVS test button for a quarter second at frame NEO3DS_SERVICE_AT */
		static int frame_no;
		frame_no++;
		conf.test_switch = frame_no >= NEO3DS_SERVICE_AT && frame_no < NEO3DS_SERVICE_AT + 15;
	}
#endif
#ifdef NEO3DS_STATE_TEST
	{ /* Azahar test: save at frame 1500, load at 1800; the state 300 frames on must match */
		static int tf;
		static unsigned h1;
		extern Uint8 drz80mem[0x10000];
		unsigned h = 2166136261u;
		if (++tf == 1800 || tf == 2100) {
			for (int i = 0; i < 0x10000; i++) h = (h ^ memory.ram[i]) * 16777619u;
			for (int i = 0; i < 0x20000; i++) h = (h ^ memory.vid.ram[i]) * 16777619u;
			for (int i = 0; i < 0x10000; i++) h = (h ^ drz80mem[i]) * 16777619u;
		}
		if (tf == 1500) state_action(true, 0);
		if (tf == 1800) { h1 = h; state_action(false, 0); }
		if (tf == 2100) {
			FILE *f = fopen("sdmc:/neo3ds/statetest.txt", "w");
			if (f) { fprintf(f, "%08x %08x %s\n", h1, h, h1 == h ? "SAME" : "DIFF"); fclose(f); }
		}
	}
#endif
#ifdef NEO3DS_AUTODUMP
	{
		static int frame_no;
		if (++frame_no % NEO3DS_AUTODUMP == 0) {
			/* the last frame finished, so the dump is the same frame on every run */
			if (render_thread) {
				LightEvent_Wait(&render_idle);
				LightEvent_Signal(&render_idle);
			}
			dump_video_state();
		}
	}
#endif
}

/* The diagnostics screen's lines below the fps log. */
static void print_diagnostics(double k) {
	extern u64 prof_split[3];
	extern unsigned prof_split_frames, z80_idle_slices;
	extern int z80_port_writes, z80_bank_wraps, dbg_z80_resets, dbg_z80_restarts, dbg_adpcma_keyons, dbg_adpcma_oob;
	printf("\x1b[%d;0HPC %06lx  resets %d  miss %4lu   \n", LOG_LINES + 2, cpu_68k_getpc(), neo_watchdog_resets,
	       memory.vid.spr_cache.misses);
	print_memory();
	printf("main : cpu %5.2f end %4.2f present %5.2f  \n", prof_ticks[0] * k, prof_ticks[1] * k,
	       pace.present_ticks * k);
	/* h: bands of the 16 drawn by the main core */
	printf("core1: snd %4.2f (ym %4.2f) rnd %5.2f h%2u  \n", prof_ticks[3] * k, prof_ticks[5] * k,
	       prof_ticks[4] * k, bands_helped / pace.frames);
	bands_helped = 0;
	static int last_writes;
	if (prof_split_frames) {
		const double ks = 1.0 / (CPU_TICKS_PER_MSEC * prof_split_frames);
		printf("cpu = 68k %5.2f z80 %4.2f tmr %4.2f  \n", prof_split[0] * ks, prof_split[1] * ks,
		       prof_split[2] * ks);
	}
	printf("z80 wr %5d/s idle %2u%% wrap %d rst %d/%d  \n", z80_port_writes - last_writes,
	       z80_idle_slices * 100 / (pace.frames * 264), z80_bank_wraps, dbg_z80_resets, dbg_z80_restarts);
	z80_idle_slices = 0;
	printf("adpcm-a %d oob %d snd+ %u drop %u  \n", dbg_adpcma_keyons, dbg_adpcma_oob,
	       audio_catchups, audio_drops);
	audio_catchups = audio_drops = 0;
	printf("spr lines %4u xz %4u yz %4u  ", spr_lines[0] / pace.frames, /* last row: no newline */ spr_lines[2] / pace.frames,
	       spr_lines[3] / pace.frames);
	last_writes = z80_port_writes;
	memset(prof_split, 0, sizeof prof_split);
	prof_split_frames = 0;
}

/* Once a second: the fps, the diagnostics if they are on the screen, and the counters start over. */
static void report_second(void) {
	const u64 now = osGetTime();
	const double k = 1.0 / (CPU_TICKS_PER_MSEC * pace.frames);
	const double fps = pace.frames * 1000.0 / (now - pace.report_t);
	/* last LOG_LINES seconds of fps and main-core time per frame, then a fixed status block */
	static char log[LOG_LINES][41];
	memmove(log[1], log[0], sizeof log[0] * (LOG_LINES - 1));
	snprintf(log[0], sizeof log[0], "%4.1f fps  %5.2f ms  late %2d", fps, pace.emu_ticks * k, pace.late);
	if (show_stats) {
		for (int i = 0; i < LOG_LINES; i++) printf("\x1b[%d;0H%-39s", i + 1, log[i]);
		print_diagnostics(k);
		flush_console();
	} else ui_fps(fps);
	memset(prof_ticks, 0, sizeof prof_ticks);
	memory.vid.spr_cache.misses = 0;
	memset(spr_lines, 0, sizeof spr_lines);
	pace.present_ticks = 0;
	pace.late = 0;
	pace.report_t = now;
	pace.frames = 0;
	pace.emu_ticks = 0;
}

/* Ends the app before the game runs. */
static int leave(bool wait) {
	if (wait) wait_for_exit();
	romfsExit();
	gfxExit();
	return 0;
}

int main(void) {
	gfxInit(GSP_RGB565_OES, GSP_RGB565_OES, false);
	consoleInit(GFX_BOTTOM, &bottom);
	osSetSpeedupEnable(true);

	printf("\x1b[1;36mneo3ds\x1b[0m stage 2\n\n");
	if (R_FAILED(romfsInit())) {
		printf("romfs mount failed\n");
		wait_for_exit();
		gfxExit();
		return 0;
	}

	printf("App memory %.1f MB: heap %.1f MB, linear %.1f MB\n",
		osGetMemRegionSize(MEMREGION_APPLICATION) / MB, __ctru_heap_size / MB, __ctru_linear_heap_size / MB);
	const bool from_launcher = !loader_standalone();
	if (from_launcher) { /* the launcher CIA: pick a .neo3ds file first */
		if (!launcher_pick(pack_path, sizeof pack_path)) return leave(false);
		consoleClear();
		printf("\x1b[1;36mneo3ds\x1b[0m\n\n%s\n", pack_path);
		if (!loader_open_pack(pack_path)) {
			printf("\x1b[31mCan't open the game:\x1b[0m %s\n", loader_error());
			return leave(true);
		}
	}
	printf("Loading game...\n");
	u64 t0 = osGetTime();
	bool ok = loader_load(show_progress, SPRITE_CACHE_BYTES);
	printf("\n");
	if (!ok) {
		printf("\x1b[31mLoad failed:\x1b[0m %s\n", loader_error());
		return leave(true);
	}
	const double load_secs = (osGetTime() - t0) / 1000.0;

	if (!video_init()) {
		printf("\x1b[31mOut of linear memory for the screen\x1b[0m\n");
		return leave(true);
	}
	keys_load();
	loader_use_bios(keys_bios_mvs());
	save_load();
	aptHook(&apt_cookie, on_apt, NULL);
	neo_init();
	render_thread_start();
	const bool sound = audio_init(conf.sample_rate);

	pace.report_t = osGetTime();
	ui_main_init(load_secs, sound);
	if (from_launcher) ui_set_launcher();
	ui_main_draw();
	recv_test_ui_log("game running");
#ifdef NEO3DS_DIAG_START
	consoleClear();
#endif
	bool quit = false;
	while (!quit && aptMainLoop()) {
		hidScanInput();
		read_input();
		quit = take_action(frame_action());
		debug_frame();

		save_frame();
		u64 t = svcGetSystemTick();
		neo_run_frame(true); /* hands sound and picture to core 1 at its end */
		pace.emu_ticks += svcGetSystemTick() - t;

		u64 tp = svcGetSystemTick();
		if (!neo_boot_ff) present_frame(); /* the MVS BIOS start-up runs as fast as it can */
		u64 tl = svcGetSystemTick();
		pace.present_ticks += tl - tp;
		if (pace.last_loop && tl - pace.last_loop > 18 * CPU_TICKS_PER_MSEC) pace.late++; /* missed a vblank */
		pace.last_loop = tl;

		if (++pace.frames == 60) report_second();
	}

	aptUnhook(&apt_cookie);
	take_snapshot(false);
	ui_screen_on();
	save_exit();
	render_thread_stop();
	audio_exit();
	romfsExit();
	gfxExit();
	return 0;
}
