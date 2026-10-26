// The game list of the launcher CIA: the .neo3ds files in sdmc:/neo3ds/games/, picked on the bottom
// screen with the D-pad and A or by touch (a tap selects, a tap on the selected game starts it).
// Two tabs, All and Favorites (D-pad left/right or a tap on the tab); SELECT or a tap on the star
// at the left of a row adds the game to the favorites or takes it out.
#include <3ds.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#include "launcher.h"
#include "loader.h"
#include "ui.h"

#define GAMES_DIR "sdmc:/neo3ds/games"
/* The favorites (by .neo3ds file name) and the tab, kept across games: going back to the list
 * starts the launcher again. Lines "tab=0|1" and "fav=<file name>". */
#define CONFIG_FILE "sdmc:/3ds/neo3ds/launcher.txt"

typedef struct {
	char file[128];
	char title[40];
	const char *name; /* the file name part of file */
	bool fav;
} Game;

static Game *games;
static int count;
static int *view, nview, sel, top; /* the games of the tab shown, sel and top index view */
static int tab; /* 0 All, 1 Favorites */

enum { LIST_Y = 32, ROW_H = 22, ROWS = 8, STAR_W = 24 };
enum { TAB_ALL_X = 116, TAB_FAV_X = 180, TAB_W = 60 }; /* right of the logo */

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
		g->fav = false;
		char t[64];
		if (loader_peek_pack(g->file, "title.txt", t, sizeof t)) snprintf(g->title, sizeof g->title, "%s", t);
		else snprintf(g->title, sizeof g->title, "%.*s", (int)(n - 7), e->d_name);
		for (char *c = g->title; *c; c++)
			if ((u8)*c < 32 || (u8)*c > 126) *c = '?';
		count++;
	}
	closedir(d);
	qsort(games, count, sizeof *games, by_title);
	for (int i = 0; i < count; i++) games[i].name = games[i].file + strlen(GAMES_DIR) + 1;
	view = malloc((count ? count : 1) * sizeof *view);
	if (!view) count = 0;
}

static void load_config(void) {
	FILE *f = fopen(CONFIG_FILE, "r");
	if (!f) return;
	char line[160];
	while (fgets(line, sizeof line, f)) {
		line[strcspn(line, "\r\n")] = 0;
		if (!strncmp(line, "tab=", 4)) tab = line[4] == '1';
		else if (!strncmp(line, "fav=", 4))
			for (int i = 0; i < count; i++)
				if (!strcasecmp(games[i].name, line + 4)) games[i].fav = true;
	}
	fclose(f);
}

/* Favorites of games no longer on the SD card are dropped here. */
static void save_config(void) {
	mkdir("sdmc:/3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds", 0777);
	FILE *f = fopen(CONFIG_FILE, "w");
	if (!f) return;
	fprintf(f, "tab=%d\n", tab);
	for (int i = 0; i < count; i++)
		if (games[i].fav) fprintf(f, "fav=%s\n", games[i].name);
	fclose(f);
}

static int favorites(void) {
	int n = 0;
	for (int i = 0; i < count; i++) n += games[i].fav;
	return n;
}

/* Rebuilds the tab's list, keeping the cursor on game keep (an index into games) when it is there. */
static void build_view(int keep) {
	nview = 0;
	for (int i = 0; i < count; i++)
		if (!tab || games[i].fav) view[nview++] = i;
	int s = -1;
	for (int i = 0; i < nview; i++)
		if (view[i] >= keep && (s < 0 || view[i] == keep)) {
			s = i;
			if (view[i] == keep) break;
		}
	sel = s < 0 ? (nview ? nview - 1 : 0) : s;
	if (top > sel) top = sel;
	if (sel >= top + ROWS) top = sel - ROWS + 1;
	if (top > nview - ROWS) top = nview > ROWS ? nview - ROWS : 0;
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
	if (nview) {
		const char *t = games[view[sel]].title;
		const int scale = strlen(t) * 16 <= 384 ? 2 : 1;
		top_text(fb, (400 - (int)strlen(t) * 8 * scale) / 2, 140, t, UI_TEXT, scale);
	}
	top_text(fb, (400 - 29 * 8) / 2, 210, "Nintendo 3DS Neo Geo emulator", UI_DIM, 1);
	gfxFlushBuffers();
}

/* The tabs in the header: the one shown on the panel color, the other in the header's */
static void draw_tabs(void) {
	char s[24];
	ui_fill(TAB_ALL_X, 0, 320 - TAB_ALL_X, 26, UI_HEADER);
	ui_fill(tab ? TAB_FAV_X : TAB_ALL_X, 4, TAB_W, 22, UI_BG);
	snprintf(s, sizeof s, "All %d", count);
	ui_text(TAB_ALL_X + (TAB_W - ui_text_width(s, 1)) / 2, 12, s, tab ? UI_DIM : UI_TEXT, 1);
	snprintf(s, sizeof s, "Fav %d", favorites());
	ui_text(TAB_FAV_X + (TAB_W - ui_text_width(s, 1)) / 2, 12, s, tab ? UI_TEXT : UI_DIM, 1);
}

static void draw_list(void) {
	ui_fill(0, LIST_Y - 2, 320, 240 - 30 - (LIST_Y - 2), UI_BG);
	if (!nview) {
		static const char *none[] = {"No favorites yet.", "", "In All, press SELECT or tap the * at",
		                             "the left of a game to add it here."};
		for (int i = 0; i < 4; i++) ui_text(8, 50 + i * 14, none[i], i ? UI_DIM : UI_TEXT, 1);
		ui_flush();
		return;
	}
	for (int i = 0; i < ROWS && top + i < nview; i++) {
		const int v = top + i, y = LIST_Y + i * ROW_H;
		const Game *g = &games[view[v]];
		if (v == sel) ui_fill(4, y, 312, ROW_H - 2, UI_PRESSED);
		ui_text(8, y + (ROW_H - 2 - 8) / 2, "*", g->fav ? UI_HEADER : UI_DIM, 1);
		char t[40]; /* 35 characters fit between the star and the scroll bar */
		snprintf(t, sizeof t, strlen(g->title) > 35 ? "%.32s..." : "%s", g->title);
		ui_text(STAR_W, y + (ROW_H - 2 - 8) / 2, t, UI_TEXT, 1);
	}
	if (nview > ROWS) { /* scroll bar */
		const int h = ROWS * ROW_H * ROWS / nview, y = LIST_Y + (ROWS * ROW_H - h) * top / (nview - ROWS);
		ui_fill(316, LIST_Y, 3, ROWS * ROW_H, UI_PANEL);
		ui_fill(316, y, 3, h, UI_DIM);
	}
	ui_flush();
}

static void draw_all(void) {
	ui_fill(0, 0, 320, 240, UI_BG);
	ui_fill(0, 0, 320, 26, UI_HEADER);
	ui_text(8, 5, "neo3ds", UI_TEXT, 2);
	if (count) {
		draw_tabs();
		ui_text(8, 214, "A/tap twice: play  SELECT/*: favorite", UI_DIM, 1);
		ui_text(8, 227, "Up/Down, L/R: choose  Left/Right: tab", UI_DIM, 1);
		draw_list();
	} else {
		ui_text(8 + ui_text_width("neo3ds", 2) + 8, 12, "game list", UI_TEXT, 1);
		static const char *help[] = {
			"No games yet.", "", "In the converter, make game files", "with [Launcher file] and copy the",
			".neo3ds files to the SD card in", "/neo3ds/games/",
		};
		for (int i = 0; i < 6; i++) ui_text(8, 50 + i * 14, help[i], i ? UI_DIM : UI_TEXT, 1);
	}
	ui_flush();
	draw_top();
}

static void pick_row(int v) {
	if (v < 0) v = 0;
	if (v > nview - 1) v = nview - 1;
	if (v == sel || v < 0) return;
	sel = v;
	if (sel < top) top = sel;
	if (sel >= top + ROWS) top = sel - ROWS + 1;
	draw_list();
	draw_top();
}

static void show_tab(int t) {
	if (t == tab) return;
	const int keep = nview ? view[sel] : 0;
	tab = t;
	build_view(keep);
	save_config();
	draw_tabs();
	ui_flush();
	draw_list();
	draw_top();
}

static void toggle_fav(int v) {
	Game *g = &games[view[v]];
	g->fav = !g->fav;
	build_view(view[v]); /* in Favorites the game leaves the list; the cursor moves to the next one */
	save_config();
	draw_tabs();
	ui_flush();
	draw_list();
	draw_top();
}

bool launcher_pick(char *path, size_t size) {
	gfxSetDoubleBuffering(GFX_TOP, false);
	scan();
	load_config();
	build_view(0);
	draw_all();
	hidSetRepeatParameters(15, 4);
	while (aptMainLoop()) {
		hidScanInput();
		const u32 down = hidKeysDown(), rep = hidKeysDownRepeat();
		if (count) {
			bool start = false;
			if (down & KEY_LEFT) show_tab(0);
			if (down & KEY_RIGHT) show_tab(1);
			if (nview) {
				if (rep & KEY_DOWN) pick_row(sel + 1);
				if (rep & KEY_UP) pick_row(sel - 1);
				if (rep & KEY_R) pick_row(sel + ROWS);
				if (rep & KEY_L) pick_row(sel - ROWS);
				if (down & KEY_SELECT) toggle_fav(sel);
				start = down & (KEY_A | KEY_START);
			}
			if (down & KEY_TOUCH) {
				touchPosition t;
				hidTouchRead(&t);
				const int row = (t.py - LIST_Y) / ROW_H, v = top + row;
				if (t.py < 26) {
					if (t.px >= TAB_ALL_X && t.px < TAB_ALL_X + TAB_W) show_tab(0);
					else if (t.px >= TAB_FAV_X && t.px < TAB_FAV_X + TAB_W) show_tab(1);
				} else if (t.py >= LIST_Y && row < ROWS && v < nview) {
					if (t.px < STAR_W) toggle_fav(v);
					else if (v == sel) start = true;
					else pick_row(v);
				}
			}
#ifdef NEO3DS_AUTOPICK
			{ /* Azahar test: start the first game after two seconds */
				static int frames;
				if (++frames == 120 && nview) start = true;
			}
#endif
			if (start && nview) {
				snprintf(path, size, "%s", games[view[sel]].file);
				return true;
			}
		}
		gspWaitForVBlank();
	}
	return false;
}
