// The game list of the launcher CIA: the .neo3ds files in sdmc:/neo3ds/games/, picked on the bottom
// screen with the D-pad and A or by touch (a tap selects, a tap on the selected game starts it).
// Two tabs, All and Favorites (D-pad left/right or a tap on the tab); SELECT or a tap on the star
// at the left of a row adds the game to the favorites or takes it out. Y opens the receive screen
// (receive.c). The top screen shows a picture of the game under the cursor, if it has one (snapshot.c).
#include <3ds.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "launcher.h"
#include "loader.h"
#include "receive.h"
#include "recv_test.h"
#include "sdfiles.h"
#include "snapshot.h"
#include "ui.h"

#define GAMES_DIR LAUNCHER_GAMES_DIR
/* The favorites (by .neo3ds file name) and the tab, kept across games: going back to the list
 * starts the launcher again. Lines "tab=0|1" and "fav=<file name>". */
#define CONFIG_FILE SD_DATA_DIR "/launcher.txt"

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
static const UiRect receive_button = {274, 4, 44, 18}; /* in the header, right of the tabs */

static int by_title(const void *a, const void *b) { return strcasecmp(((const Game *)a)->title, ((const Game *)b)->title); }

static void scan(void) {
	DIR *d = opendir(GAMES_DIR);
	if (!d) return;
	struct dirent *e;
	while ((e = readdir(d))) {
		if (!sd_has_suffix(e->d_name, PACK_SUFFIX)) continue;
		Game *g = realloc(games, (count + 1) * sizeof *games);
		if (!g) break;
		games = g;
		g = &games[count];
		snprintf(g->file, sizeof g->file, "%s/%s", GAMES_DIR, e->d_name);
		g->fav = false;
		char t[64];
		if (loader_peek_pack(g->file, "title.txt", t, sizeof t)) snprintf(g->title, sizeof g->title, "%s", t);
		else snprintf(g->title, sizeof g->title, "%.*s", sd_pack_base(e->d_name), e->d_name);
		ui_printable(g->title);
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
	sd_make_data_dir(NULL);
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

/* Pictures already read, newest first: scrolling back needs no SD card. pixels NULL: no picture. */
enum {
	SNAP_CACHE = 8,
	SNAP_WAIT_FRAMES = 6,  /* just over the key repeat: a held key reads nothing while it scrolls */
	SNAP_NEXT_FRAMES = 12, /* with the cursor still, the pictures around it are read one by one */
};
typedef struct {
	char name[sizeof ((Game *)0)->file];
	u16 *pixels;
} SnapEntry;
static SnapEntry snaps[SNAP_CACHE];
static int snap_count;
static int snap_wait; /* frames until the cursor counts as stopped and the picture is read */
static int snap_next_wait; /* frames until the next picture around the cursor is read */
static u16 *top_scratch;   /* the top screen is composed here and copied at once: no flicker */
static bool top_stale;     /* a picture just came in: redraw right after the next vblank */

static bool snap_known(const char *name) {
	for (int i = 0; i < snap_count; i++)
		if (!strcmp(snaps[i].name, name)) return true;
	return false;
}

/* The entry of this game, moved to the front. */
static SnapEntry *snap_find(const char *name) {
	for (int i = 0; i < snap_count; i++)
		if (!strcmp(snaps[i].name, name)) {
			const SnapEntry e = snaps[i];
			memmove(&snaps[1], &snaps[0], i * sizeof snaps[0]);
			snaps[0] = e;
			return &snaps[0];
		}
	return NULL;
}

static void snap_read(const char *name) {
	if (snap_count == SNAP_CACHE) free(snaps[--snap_count].pixels);
	memmove(&snaps[1], &snaps[0], snap_count * sizeof snaps[0]);
	snap_count++;
	snprintf(snaps[0].name, sizeof snaps[0].name, "%s", name);
	snaps[0].pixels = malloc(SNAPSHOT_BYTES);
	if (snaps[0].pixels && !snapshot_load(name, snaps[0].pixels)) {
		free(snaps[0].pixels);
		snaps[0].pixels = NULL;
	}
}

static void snap_free(void) {
	for (int i = 0; i < snap_count; i++) free(snaps[i].pixels);
	snap_count = 0;
}

/* The top screen: the selected game's picture and name, or the logo and name. */
static void draw_top(void) {
	u16 *screen = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	u16 *fb = top_scratch ? top_scratch : screen;
	recv_test_list_state(tab, nview ? games[view[sel]].name : "-", favorites(), count);
	if (nview) {
		const Game *g = &games[view[sel]];
		const SnapEntry *e = snap_find(g->name);
		snap_wait = e ? 0 : SNAP_WAIT_FRAMES;
		snap_next_wait = SNAP_NEXT_FRAMES;
		if (e && e->pixels) {
			memcpy(fb, e->pixels, SNAPSHOT_BYTES);
			for (int x = 0; x < 400; x++) /* the name on a band at the bottom */
				for (int y = 224; y < 240; y++) UI_PIXEL(fb, x, y) = UI_BG;
			ui_top_center(fb, 228, g->title, UI_TEXT, 1);
			if (fb != screen) memcpy(screen, fb, SNAPSHOT_BYTES);
			gfxFlushBuffers();
			return;
		}
	}
	ui_top_logo(fb);
	if (nview) {
		const char *t = games[view[sel]].title;
		ui_top_center(fb, 140, t, UI_TEXT, ui_text_width(t, 2) <= 384 ? 2 : 1);
	}
	ui_top_center(fb, 210, "Nintendo 3DS Neo Geo emulator", UI_DIM, 1);
	if (fb != screen) memcpy(screen, fb, SNAPSHOT_BYTES);
	gfxFlushBuffers();
}

static void draw_receive_button(void) {
	ui_button(receive_button, "Y:QR", UI_PANEL, UI_TEXT);
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
	draw_receive_button();
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
		ui_fit(t, sizeof t, g->title, 35);
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
	ui_header(count ? NULL : "game list");
	if (count) {
		draw_tabs();
		ui_text(8, 214, "A/tap twice: play  SELECT/*: favorite", UI_DIM, 1);
		ui_text(8, 227, "Up/Down, L/R: choose  Left/Right: tab", UI_DIM, 1);
		draw_list();
	} else {
		static const char *help[] = {
			"No games yet.", "", "In the converter, make game files", "with [Launcher file] and copy the",
			".neo3ds files to the SD card in", "/neo3ds/games/",
		};
		for (int i = 0; i < 6; i++) ui_text(8, 50 + i * 14, help[i], i ? UI_DIM : UI_TEXT, 1);
		ui_text(8, 50 + 7 * 14, "Or press Y to get one from the PC", UI_DIM, 1);
		ui_text(8, 50 + 8 * 14, "over the Wi-Fi.", UI_DIM, 1);
		draw_receive_button();
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

/* The list again after a game came in: favorites, tab and cursor stay. */
static void read_list_again(void) {
	char keep[sizeof games[0].file] = "";
	if (nview) snprintf(keep, sizeof keep, "%s", games[view[sel]].file);
	free(games);
	free(view);
	games = NULL;
	view = NULL;
	count = 0;
	nview = 0;
	scan();
	load_config();
	int at = 0;
	for (int i = 0; i < count; i++)
		if (!strcasecmp(games[i].file, keep)) at = i; /* the SD card ignores case */
	build_view(at);
}

static void open_receive(void) {
	if (receive_run()) read_list_again();
	draw_all();
}

/* The buttons and the touch screen on the list. True when the game under the cursor is to start. */
static bool list_input(u32 down, u32 rep) {
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
		ui_touch_read(&t);
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
	return start;
}

/* The SD card last in the frame, and only with no key down: what follows a read starts on a new
 * frame, and a read never holds up a key or a redraw. */
static void read_snapshots_when_idle(void) {
	if (!(hidKeysHeld() & (KEY_UP | KEY_DOWN | KEY_LEFT | KEY_RIGHT | KEY_L | KEY_R))) {
		if (snap_wait && --snap_wait == 0 && nview) { /* the cursor stopped here */
			snap_read(games[view[sel]].name);
			top_stale = true;
		} else if (!snap_wait && snap_next_wait && --snap_next_wait == 0) { /* the rows around it */
			static const int around[] = {1, -1, 2, -2};
			for (int i = 0; i < 4; i++) {
				const int v = sel + around[i];
				if (v < 0 || v >= nview || snap_known(games[view[v]].name)) continue;
				snap_read(games[view[v]].name);
				snap_next_wait = SNAP_NEXT_FRAMES;
				break;
			}
		}
	}
}

bool launcher_pick(char *path, size_t size) {
	gfxSetDoubleBuffering(GFX_TOP, false);
	top_scratch = malloc(SNAPSHOT_BYTES);
	receive_recover();
	scan();
	load_config();
	build_view(0);
	draw_all();
	hidSetRepeatParameters(15, 4);
	while (aptMainLoop()) {
		hidScanInput();
		if (top_stale) {
			top_stale = false;
			draw_top();
		}
		const u32 down = RECEIVE_KEYS_DOWN(), rep = hidKeysDownRepeat() | (down & KEY_DOWN);
		touchPosition t;
		ui_touch_read(&t);
		if ((down & KEY_Y) || ((down & KEY_TOUCH) && ui_hit(receive_button, t.px, t.py))) {
			open_receive();
			continue;
		}
		if (count) {
			bool start = list_input(down, rep);
#ifdef NEO3DS_AUTOPICK
			{ /* Azahar test: start the first game after two seconds */
				static int frames;
				if (++frames == 120 && nview) start = true;
			}
#endif
			if (start && nview) {
				snprintf(path, size, "%s", games[view[sel]].file);
				snap_free();
				free(top_scratch);
				top_scratch = NULL;
				return true;
			}
		}
		read_snapshots_when_idle();
		gspWaitForVBlank();
	}
	return false;
}
