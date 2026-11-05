// The receive screen's drawing and its waiting for an answer.
#include <stdio.h>
#include <string.h>

#include "receive_internal.h"
#include "recv_test.h"
#include "ui.h"

void recv_draw_top(const char *line) {
	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	ui_top_logo(fb);
	ui_top_center(fb, 140, "Receive a game", UI_TEXT, 2);
	ui_top_center(fb, 170, line, UI_DIM, 1);
	gfxFlushBuffers();
}

/* One line, cut to the 38 characters that fit */
void recv_line(int y, const char *s, u16 color) {
	char t[40];
	ui_fit(t, sizeof t, s, 38);
	ui_text(8, y, t, color, 1);
}

void recv_draw_frame(const char *name, const char *foot) {
	ui_header("receive");
	if (name) recv_line(40, name, UI_TEXT);
	ui_text(8, 227, foot, UI_DIM, 1);
}

void recv_draw_status(const char *s) {
	ui_fill(0, 70, 320, 80, UI_BG);
	recv_line(80, s, UI_TEXT);
	ui_flush();
}

void recv_draw_progress(u64 got, u64 total, u32 bytes_per_second) {
	const double mb = 1024.0 * 1024.0;
	char s[48];
	ui_fill(0, 70, 320, 80, UI_BG);
	const int w = total ? (int)(288 * got / total) : 0;
	ui_fill(16, 80, 288, 14, UI_PANEL);
	ui_fill(16, 80, w, 14, UI_ACCENT);
	snprintf(s, sizeof s, "%.1f / %.1f MB  %d%%", got / mb, total / mb, total ? (int)(100 * got / total) : 0);
	ui_text(16, 102, s, UI_TEXT, 1);
	if (bytes_per_second) {
		snprintf(s, sizeof s, "%lu KB/s  %.1f MB left", (unsigned long)(bytes_per_second / 1024), (total - got) / mb);
		ui_text(16, 116, s, UI_DIM, 1);
	}
	ui_flush();
}

void recv_scan_status(const char *s) {
	ui_fill(0, 70, 320, 60, UI_BG);
	recv_line(80, s, UI_ACCENT);
	recv_line(100, "Show the code of a .neo3ds file.", UI_DIM);
	ui_flush();
}

/* The top screen with one row a file: its size before the start, what became of it after. */
void recv_draw_items(const Item *items, int count, const char *title, bool results) {
	static const char *const states[] = {"-", "saved", "skipped", "failed"};
	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	ui_top_clear(fb);
	ui_top_center(fb, 30, title, UI_TEXT, 2);
	for (int i = 0; i < count; i++) {
		const Item *it = &items[i];
		const int y = 70 + i * 22;
		char s[40];
		ui_fit(s, sizeof s, it->t.name, 31);
		ui_printable(s);
		ui_top_text(fb, 12, y, s, UI_TEXT, 1);
		if (results) {
			ui_top_text(fb, 300, y, states[it->state], it->state == ITEM_SAVED ? UI_TEXT : UI_ACCENT, 1);
		} else {
			snprintf(s, sizeof s, "%.1fMB", it->length / (1024.0 * 1024.0));
			ui_top_text(fb, 268, y, s, UI_DIM, 1);
			if (it->replacing) ui_top_text(fb, 332, y, "replace", UI_ACCENT, 1);
		}
	}
	gfxFlushBuffers();
}

/* Waits for A (true) or B (false). A question (not a message) also ends when the HOME menu opens. */
bool recv_wait_answer(bool question) {
	while (aptMainLoop()) {
		hidScanInput();
		const u32 down = RECEIVE_KEYS_DOWN();
		if (down & KEY_A) return true;
		if ((down & KEY_B) || (question && recv_interrupted)) return false;
		gspWaitForVBlank();
	}
	return false;
}

/* top_line NULL leaves the top screen as it is. */
void recv_show_message(const char *name, const char *title, const char *detail, const char *top_line) {
	if (top_line) recv_draw_top(top_line);
	recv_draw_frame(name, "A/B: back to the list");
	recv_line(80, title, UI_TEXT);
	/* Reasons run long: broken into lines at the spaces */
	for (int y = 100; *detail && y <= 124; y += 12) {
		char part[40];
		size_t n = strlen(detail);
		if (n > 38) {
			n = 38;
			while (n && detail[n] != ' ') n--;
			if (!n) n = 38;
		}
		snprintf(part, sizeof part, "%.*s", (int)n, detail);
		ui_text(8, y, part, UI_DIM, 1);
		detail += n;
		while (*detail == ' ') detail++;
	}
	ui_flush();
	recv_wait_answer(false);
}
