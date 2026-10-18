// The game list of the launcher CIA: the .neo3ds files in sdmc:/neo3ds/games/, picked on the bottom
// screen with the D-pad and A or by touch (a tap selects, a tap on the selected game starts it).
#include <3ds.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "launcher.h"
#include "loader.h"
#include "ui.h"

#define GAMES_DIR "sdmc:/neo3ds/games"

typedef struct {
	char file[128];
	char title[40];
} Game;

static Game *games;
static int count, sel, top;

enum { LIST_Y = 32, ROW_H = 22, ROWS = 8 };

static int by_title(const void *a, const void *b) { return strcasecmp(((const Game *)a)->title, ((const Game *)b)->title); }

static void scan(void) {
	DIR *d = opendir(GAMES_DIR);
	if (!d) return;
	struct dirent *e;
	while ((e = readdir(d))) {
		const size_t n = strlen(e->d_name);
		if (n < 8 || strcasecmp(e->d_name + n - 7, ".neo3ds")) continue;
		Game *g = realloc(games, (count + 1) * sizeof *games);
		if (!g) break;
		games = g;
		g = &games[count];
		snprintf(g->file, sizeof g->file, "%s/%s", GAMES_DIR, e->d_name);
		char t[64];
		if (loader_peek_pack(g->file, "title.txt", t, sizeof t)) snprintf(g->title, sizeof g->title, "%s", t);
		else snprintf(g->title, sizeof g->title, "%.*s", (int)(n - 7), e->d_name);
		for (char *c = g->title; *c; c++)
			if ((u8)*c < 32 || (u8)*c > 126) *c = '?';
		count++;
	}
	closedir(d);
	qsort(games, count, sizeof *games, by_title);
}

/* The top screen: the logo and the selected game's name. The framebuffer is rotated like the
 * bottom one, 240 pixels per column. */
static void top_text(u16 *fb, int x, int y, const char *s, u16 color, int scale) {
	const ConsoleFont *font = &consoleGetDefault()->font;
	for (; *s; s++, x += 8 * scale) {
		const int c = (u8)*s - font->asciiOffset;
		if (c < 0 || c >= font->numChars) continue;
		const u8 *g = font->gfx + c * 8;
		for (int row = 0; row < 8; row++)
			for (int bit = 0; bit < 8; bit++)
				if (g[row] & (0x80 >> bit))
					for (int sy = 0; sy < scale; sy++)
						for (int sx = 0; sx < scale; sx++) {
							const int px = x + bit * scale + sx, py = y + row * scale + sy;
							if (px >= 0 && px < 400 && py >= 0 && py < 240) fb[px * 240 + 239 - py] = color;
						}
	}
}

static void draw_top(void) {
	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	for (int i = 0; i < 400 * 240; i++) fb[i] = UI_BG;
	top_text(fb, (400 - 6 * 8 * 4) / 2, 70, "neo3ds", UI_HEADER, 4);
	if (count) {
		const char *t = games[sel].title;
		const int scale = strlen(t) * 16 <= 384 ? 2 : 1;
		top_text(fb, (400 - (int)strlen(t) * 8 * scale) / 2, 140, t, UI_TEXT, scale);
	}
	top_text(fb, (400 - 29 * 8) / 2, 210, "Nintendo 3DS Neo Geo emulator", UI_DIM, 1);
	gfxFlushBuffers();
}

static void draw_list(void) {
	ui_fill(0, LIST_Y - 2, 320, ROWS * ROW_H + 4, UI_BG);
	for (int i = 0; i < ROWS && top + i < count; i++) {
		const int g = top + i, y = LIST_Y + i * ROW_H;
		if (g == sel) ui_fill(4, y, 312, ROW_H - 2, UI_PRESSED);
		char t[40]; /* 36 characters fit beside the scroll bar */
		snprintf(t, sizeof t, strlen(games[g].title) > 36 ? "%.33s..." : "%s", games[g].title);
		ui_text(12, y + (ROW_H - 2 - 8) / 2, t, UI_TEXT, 1);
	}
	if (count > ROWS) { /* scroll bar */
		const int h = ROWS * ROW_H * ROWS / count, y = LIST_Y + (ROWS * ROW_H - h) * top / (count - ROWS);
		ui_fill(316, LIST_Y, 3, ROWS * ROW_H, UI_PANEL);
		ui_fill(316, y, 3, h, UI_DIM);
	}
	ui_flush();
}

static void draw_all(void) {
	ui_fill(0, 0, 320, 240, UI_BG);
	ui_fill(0, 0, 320, 26, UI_HEADER);
	ui_text(8, 5, "neo3ds", UI_TEXT, 2);
	ui_text(8 + ui_text_width("neo3ds", 2) + 8, 12, "game list", UI_TEXT, 1);
	if (count) {
		char s[40];
		snprintf(s, sizeof s, "%d game%s", count, count == 1 ? "" : "s");
		ui_text(320 - 8 - ui_text_width(s, 1), 12, s, UI_TEXT, 1);
		ui_text(8, 214, "A or tap twice: play", UI_DIM, 1);
		ui_text(8, 227, "Up/Down, L/R: choose", UI_DIM, 1);
		draw_list();
	} else {
		static const char *help[] = {
			"No games yet.", "", "In the converter, make game files", "with [Launcher file] and copy the",
			".neo3ds files to the SD card in", "/neo3ds/games/",
		};
		for (int i = 0; i < 6; i++) ui_text(8, 50 + i * 14, help[i], i ? UI_DIM : UI_TEXT, 1);
	}
	ui_flush();
	draw_top();
}

static void pick_row(int g) {
	if (g < 0) g = 0;
	if (g > count - 1) g = count - 1;
	if (g == sel) return;
	sel = g;
	if (sel < top) top = sel;
	if (sel >= top + ROWS) top = sel - ROWS + 1;
	draw_list();
	draw_top();
}

bool launcher_pick(char *path, size_t size) {
	gfxSetDoubleBuffering(GFX_TOP, false);
	scan();
	draw_all();
	hidSetRepeatParameters(15, 4);
	while (aptMainLoop()) {
		hidScanInput();
		const u32 down = hidKeysDown(), rep = hidKeysDownRepeat();
		if (count) {
			if (rep & KEY_DOWN) pick_row(sel + 1);
			if (rep & KEY_UP) pick_row(sel - 1);
			if (rep & KEY_R) pick_row(sel + ROWS);
			if (rep & KEY_L) pick_row(sel - ROWS);
			bool start = down & (KEY_A | KEY_START);
			if (down & KEY_TOUCH) {
				touchPosition t;
				hidTouchRead(&t);
				const int row = (t.py - LIST_Y) / ROW_H, g = top + row;
				if (t.py >= LIST_Y && row < ROWS && g < count) {
					if (g == sel) start = true;
					else pick_row(g);
				}
			}
#ifdef NEO3DS_AUTOPICK
			{ /* Azahar test: start the first game after two seconds */
				static int frames;
				if (++frames == 120) start = true;
			}
#endif
			if (start) {
				snprintf(path, size, "%s", games[sel].file);
				return true;
			}
		}
		gspWaitForVBlank();
	}
	return false;
}
