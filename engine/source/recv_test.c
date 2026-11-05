// See recv_test.h. The test's files are in SD_DATA_DIR: it writes recv_key.txt, recv_url.txt and
// recv_free.txt, and reads recv_list.txt, recv_state.txt and recv_cluster.txt.
#ifdef NEO3DS_RECV_TEST
#include <stdio.h>
#include <stdlib.h>

#include "receive_internal.h"
#include "recv_test.h"
#include "sdfiles.h"
#include "ui.h"

static bool write_fails;
static int last_codes, last_error;

u32 recv_test_keys(void) {
	static u64 next;
	const u64 now = osGetTime();
	if (now < next) return 0;
	next = now + 100;
	FILE *f = fopen(SD_DATA_DIR "/recv_key.txt", "r");
	if (!f) return 0;
	const int c = fgetc(f);
	fclose(f);
	remove(SD_DATA_DIR "/recv_key.txt");
	if (c == 'H') recv_interrupted = true; /* as if the HOME menu had come up */
	if (c == 'W') write_fails = true;
	if (c == 'R') return KEY_RIGHT;
	if (c == 'T') return KEY_LEFT;
	if (c == 'S') { /* writes down whether the console may sleep now */
		FILE *state = fopen(SD_DATA_DIR "/recv_state.txt", "w");
		if (state) {
			fprintf(state, "sleep=%d\n", aptIsSleepAllowed());
			fclose(state);
		}
	}
	/* L and P: leave a running game for the list, take a snapshot (main.c) */
	return c == 'A' ? KEY_A : c == 'B' ? KEY_B : c == 'Y' ? KEY_Y : c == 'D' ? KEY_DOWN : c == 'L' ? KEY_ZL : c == 'P' ? KEY_ZR : 0;
}

bool recv_test_write_fails(void) {
	const bool fails = write_fails;
	write_fails = false;
	return fails;
}

/* The file holds the space to pretend: MB, or bytes when the number ends in b. The cluster size is
 * written down, for a test of the exact limit. */
void recv_test_free_space(u64 *available, u64 cluster) {
	FILE *f = fopen(SD_DATA_DIR "/recv_free.txt", "r");
	if (!f) return;
	char s[32] = "";
	if (fgets(s, sizeof s, f)) {
		char *end;
		const u64 value = strtoull(s, &end, 10);
		*available = *end == 'b' ? value : value << 20;
	}
	fclose(f);
	f = fopen(SD_DATA_DIR "/recv_cluster.txt", "w");
	if (f) {
		fprintf(f, "%llu\n", (unsigned long long)cluster);
		fclose(f);
	}
}

bool recv_test_url(char *url, size_t size) {
	FILE *f = fopen(SD_DATA_DIR "/recv_url.txt", "r");
	if (!f) return false;
	size_t n = fread(url, 1, size - 1, f);
	fclose(f);
	if (n && url[n - 1] == '\n') n--; /* the last line end is not part of it */
	url[n] = 0;
	return true;
}

void recv_test_list_state(int tab, const char *selected, int favorites, int count) {
	FILE *state = fopen(SD_DATA_DIR "/recv_list.txt", "w");
	if (!state) return;
	fprintf(state, "tab=%d sel=%s favs=%d count=%d\n", tab, selected, favorites, count);
	fclose(state);
}

void recv_test_decode_count(int codes) {
	last_codes = codes;
	last_error = 0;
}

void recv_test_decode_error(int error) { last_error = error; }

void recv_test_show_decode(u64 ms) {
	static u64 worst;
	char s[40];
	if (ms > worst) worst = ms;
	snprintf(s, sizeof s, "decode %lu ms, worst %lu, qr %d e%d", (unsigned long)ms, (unsigned long)worst, last_codes, last_error);
	ui_fill(8, 200, 304, 10, UI_BG);
	ui_text(8, 200, s, UI_DIM, 1);
	ui_flush();
}
#endif
