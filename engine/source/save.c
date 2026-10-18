// The MVS backup RAM (settings from the service menu, bookkeeping and the games' high scores),
// kept per game in sdmc:/3ds/neo3ds/saves/<title id>.sram like the key config.
//
// Writing to the SD card takes longer than a frame, so while the game runs a copy is written by a
// low-priority thread on the main core, which only gets the core while the main loop waits for
// the vblank. The RAM is compared every few seconds and written only when it changed.
#include <3ds.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "save.h"
#include "loader.h"
#include "neo/memory.h"

enum { CHECK_FRAMES = 300 };

static Uint8 saved[sizeof memory.sram]; /* what the file holds */
static Uint8 pending[sizeof memory.sram]; /* the copy the thread writes */
static Thread thread;
static LightEvent wake, idle;
static volatile bool quit;
static int frames;

static void file_path(char *out, size_t n) {
	const u64 id = loader_game_id();
	snprintf(out, n, "sdmc:/3ds/neo3ds/saves/%016llX.sram", (unsigned long long)id);
}

static void write_file(const Uint8 *data) {
	char path[64];
	file_path(path, sizeof path);
	mkdir("sdmc:/3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds/saves", 0777);
	FILE *f = fopen(path, "wb");
	if (!f) return;
	fwrite(data, sizeof memory.sram, 1, f);
	fclose(f);
}

static void writer(void *arg) {
	(void)arg;
	for (;;) {
		LightEvent_Wait(&wake);
		if (quit) break;
		write_file(pending);
		LightEvent_Signal(&idle);
	}
}

void save_load(void) {
	char path[64];
	file_path(path, sizeof path);
	FILE *f = fopen(path, "rb");
	if (f) {
		if (fread(memory.sram, sizeof memory.sram, 1, f) != 1) memset(memory.sram, 0, sizeof memory.sram);
		fclose(f);
	}
	memcpy(saved, memory.sram, sizeof saved);

	LightEvent_Init(&wake, RESET_ONESHOT);
	LightEvent_Init(&idle, RESET_STICKY);
	LightEvent_Signal(&idle);
	s32 prio = 0x30;
	svcGetThreadPriority(&prio, CUR_THREAD_HANDLE);
	thread = threadCreate(writer, NULL, 16 * 1024, prio + 1 > 0x3f ? 0x3f : prio + 1, 0, false);
}

void save_frame(void) {
	if (++frames < CHECK_FRAMES) return;
	frames = 0;
	if (!thread || !LightEvent_TryWait(&idle)) return; /* the last write is still going */
	if (!memcmp(saved, memory.sram, sizeof saved)) return;
	memcpy(saved, memory.sram, sizeof saved);
	memcpy(pending, saved, sizeof pending);
	LightEvent_Clear(&idle);
	LightEvent_Signal(&wake);
}

void save_flush(void) {
	if (thread) LightEvent_Wait(&idle);
	if (!memcmp(saved, memory.sram, sizeof saved)) return;
	memcpy(saved, memory.sram, sizeof saved);
	write_file(saved);
}

void save_exit(void) {
	save_flush();
	if (!thread) return;
	quit = true;
	LightEvent_Signal(&wake);
	threadJoin(thread, U64_MAX);
	threadFree(thread);
	thread = NULL;
}
