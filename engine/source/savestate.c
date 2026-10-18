// Quick save states. Each part of the emulator copies its own state through st_bytes() in a fixed
// order (the *_state() functions below), so writing and reading are the same code.
//
// The sound chips and timers are stored as raw structs, pointers included: the pointers lead to
// the engine's own static data, which stays at the same address as long as the program is the
// same build. The header carries a fingerprint of the build, and states from another build are
// refused rather than loaded wrong (after an update the old slots read "saved by another version").
#include <3ds.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

#include "savestate.h"
#include "audio.h"
#include "loader.h"
#include "neo/memory.h"

void cpu_68k_state(void);  /* cyclone_interf.c */
void cpu_z80_state(void);  /* drz80_interf.c */
void memory_state(void);   /* memory.c */
void timer_state(void);    /* timer.c */
void pd4990a_state(void);  /* pd4990a.c */
void glue_state(void);     /* neo_glue.c */
void YM2610State(void);    /* ym2610.c: the main core's chip (timers, IRQs, status) */
void ym_audio_State(void); /* the same code as core 1's synthesis chip */

enum { MAGIC = 0x5453334e /* "N3ST" */, STATE_VERSION = 1 };

typedef struct {
	u32 magic, version, build;
	u64 id;
	u8 mvs, pad[3];
	s64 saved; /* time() */
} Header;

static FILE *file;
static bool reading, failed;

void st_bytes(void *p, size_t n) {
	if (failed) return;
	if ((reading ? fread(p, 1, n, file) : fwrite(p, 1, n, file)) != n) failed = true;
}

bool st_reading(void) { return reading; }

/* Addresses of a few functions and statics, and the sizes that go into the file: a different build
 * changes some of them. */
static u32 build_fingerprint(void) {
	const u32 v[] = {(u32)cpu_68k_state, (u32)cpu_z80_state, (u32)YM2610State, (u32)ym_audio_State,
	                 (u32)timer_state, (u32)&memory, sizeof(neo_mem), STATE_VERSION};
	u32 h = 2166136261u;
	for (size_t i = 0; i < sizeof v / sizeof v[0]; i++) h = (h ^ v[i]) * 16777619u;
	return h;
}

static u64 game_id(void) { return loader_game_id(); }

static void path_of(int slot, char *out, size_t n) {
	snprintf(out, n, "sdmc:/3ds/neo3ds/states/%016llX.%d", (unsigned long long)game_id(), slot + 1);
}

static void all_state(void) {
	memory_state(); /* first: the 68k's bank and vectors decide where its PC points */
	cpu_68k_state();
	cpu_z80_state();
	timer_state();
	pd4990a_state();
	glue_state();
	YM2610State();
	ym_audio_State();
}

StateResult savestate_save(int slot) {
	char path[64], tmp[68];
	path_of(slot, path, sizeof path);
	snprintf(tmp, sizeof tmp, "%s.tmp", path);
	mkdir("sdmc:/3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds/states", 0777);
	if (!(file = fopen(tmp, "wb"))) return STATE_IO_ERROR;
	setvbuf(file, NULL, _IOFBF, 32 * 1024);
	reading = failed = false;
	Header h = {MAGIC, STATE_VERSION, build_fingerprint(), game_id(), memory.mvs, {0}, (s64)time(NULL)};
	st_bytes(&h, sizeof h);
	all_state();
	failed |= fclose(file) != 0;
	file = NULL;
	if (failed) {
		remove(tmp);
		return STATE_IO_ERROR;
	}
	remove(path); /* the old slot goes only once the new one is complete */
	return rename(tmp, path) == 0 ? STATE_OK : STATE_IO_ERROR;
}

/* Opens a slot and checks its header; the file is left open at the first section. */
static StateResult open_slot(int slot, Header *h) {
	char path[64];
	path_of(slot, path, sizeof path);
	if (!(file = fopen(path, "rb"))) return STATE_EMPTY;
	if (fread(h, sizeof *h, 1, file) != 1 || h->magic != MAGIC || h->version != STATE_VERSION ||
	    h->build != build_fingerprint() || h->id != game_id()) {
		fclose(file);
		file = NULL;
		return STATE_OTHER_BUILD;
	}
	return STATE_OK;
}

int savestate_board(int slot) {
	Header h;
	if (open_slot(slot, &h) != STATE_OK) return -1;
	fclose(file);
	file = NULL;
	return h.mvs;
}

StateResult savestate_load(int slot) {
	Header h;
	StateResult r = open_slot(slot, &h);
	if (r != STATE_OK) return r;
	setvbuf(file, NULL, _IOFBF, 32 * 1024);
	reading = true;
	failed = false;
	all_state();
	fclose(file);
	file = NULL;
	reading = false;
	audio_state_loaded();
	/* The header matched, so a short file means a damaged one: the state is partly overwritten and
	 * the caller restarts the game. */
	return failed ? STATE_IO_ERROR : STATE_OK;
}

void savestate_describe(int slot, char *out, size_t size) {
	Header h;
	StateResult r = open_slot(slot, &h);
	if (r == STATE_OK) {
		fclose(file);
		file = NULL;
		time_t t = (time_t)h.saved;
		struct tm *tm = localtime(&t);
		snprintf(out, size, "Slot %d: %02d-%02d %02d:%02d %s", slot + 1, tm->tm_mon + 1, tm->tm_mday,
		         tm->tm_hour, tm->tm_min, h.mvs ? "MVS" : "AES");
	} else if (r == STATE_EMPTY)
		snprintf(out, size, "Slot %d: empty", slot + 1);
	else
		snprintf(out, size, "Slot %d: from another version", slot + 1);
}
