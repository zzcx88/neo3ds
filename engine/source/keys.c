// Button mapping and the key config screen (drawn with ui.h).
//
// Each 3DS button (directions excluded) presses one entry of `actions`: a Neo Geo button, a
// combination such as A+B, Start or Coin. The mapping and the turbo button are saved per game
// in sdmc:/3ds/neo3ds/keys/<title id>.bin, with the BIOS choice (home AES or arcade MVS) and the
// screen mode (1:1 or full screen).
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "keys.h"
#include "loader.h"
#include "ui.h"

enum { NBUTTONS = 10 };

static const struct { u32 key; const char *name; } buttons[NBUTTONS] = {
	{KEY_A, "A"}, {KEY_B, "B"}, {KEY_X, "X"}, {KEY_Y, "Y"}, {KEY_L, "L"},
	{KEY_R, "R"}, {KEY_ZL, "ZL"}, {KEY_ZR, "ZR"}, {KEY_START, "START"}, {KEY_SELECT, "SELECT"},
};
enum { TURBO_BUTTONS = 8 }; /* turbo can go on any of the first 8 (not START / SELECT) */

static const struct { unsigned bits; const char *name; } actions[] = {
	{0, "-"},
	{NEO_A, "Neo Geo A"}, {NEO_B, "Neo Geo B"}, {NEO_C, "Neo Geo C"}, {NEO_D, "Neo Geo D"},
	{NEO_A | NEO_B, "A+B"}, {NEO_C | NEO_D, "C+D"}, {NEO_B | NEO_C, "B+C"},
	{NEO_A | NEO_B | NEO_C, "A+B+C"}, {NEO_B | NEO_C | NEO_D, "B+C+D"},
	{NEO_A | NEO_B | NEO_C | NEO_D, "A+B+C+D"},
	{NEO_START, "Start"}, {NEO_COIN, "Coin"},
};
#define NACTIONS (int)(sizeof actions / sizeof actions[0])

/* A = Neo Geo B, B = A, X = D, Y = C: the Neo Geo pad's layout on the 3DS buttons */
static const u8 default_map[NBUTTONS] = {2, 1, 4, 3, 0, 0, 0, 0, 11, 12};

static u8 map[NBUTTONS];
u32 keys_turbo;
bool keys_full_screen;
static u8 bios; /* 0 = the converter's default, 1 = AES, 2 = MVS */

typedef struct {
	char magic[4]; /* "NKEY" */
	u8 version;
	u8 turbo; /* 0 = off, else 1 + index into buttons */
	u8 map[NBUTTONS];
	u8 bios; /* version 2 */
	/* Added after 1.1.0 without a new version: older engines read the 17 bytes before it and keep
	 * the mapping, files from them end before it (1:1). */
	u8 screen; /* 0 = 1:1, 1 = full screen */
} KeyFile;

static void file_path(char *out, size_t n) {
	const u64 id = loader_game_id();
	snprintf(out, n, "sdmc:/3ds/neo3ds/keys/%016llX.bin", (unsigned long long)id);
}

static int turbo_index(void) {
	for (int i = 0; i < TURBO_BUTTONS; i++)
		if (keys_turbo == buttons[i].key) return i + 1;
	return 0;
}

void keys_load(void) {
	memcpy(map, default_map, sizeof map);
	keys_turbo = 0;
	keys_full_screen = false;
	bios = 0;
	char path[64];
	file_path(path, sizeof path);
	FILE *f = fopen(path, "rb");
	if (!f) return;
	KeyFile k = {{0}};
	/* version 1 files end before the bios byte, 1.1.0's before the screen byte (k is zeroed) */
	if (fread(&k, 1, sizeof k, f) >= offsetof(KeyFile, bios) && !memcmp(k.magic, "NKEY", 4) &&
	    (k.version == 1 || k.version == 2)) {
		if (k.version == 2 && k.bios <= 2) bios = k.bios;
		keys_full_screen = k.screen == 1;
		for (int i = 0; i < NBUTTONS; i++) map[i] = k.map[i] < NACTIONS ? k.map[i] : default_map[i];
		if (k.turbo >= 1 && k.turbo <= TURBO_BUTTONS) keys_turbo = buttons[k.turbo - 1].key;
	}
	fclose(f);
}

bool keys_save(void) {
	mkdir("sdmc:/3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds/keys", 0777);
	char path[64];
	file_path(path, sizeof path);
	FILE *f = fopen(path, "wb");
	if (!f) return false;
	KeyFile k = {{'N', 'K', 'E', 'Y'}, 2, (u8)turbo_index(), {0}, bios, keys_full_screen};
	memcpy(k.map, map, sizeof map);
	bool ok = fwrite(&k, sizeof k, 1, f) == 1;
	return fclose(f) == 0 && ok;
}

unsigned keys_neo(u32 held) {
	unsigned bits = 0;
	for (int i = 0; i < NBUTTONS; i++)
		if (held & buttons[i].key) bits |= actions[map[i]].bits;
	return bits;
}

bool keys_r_free(void) { return map[5] == 0; }

int keys_bios_mvs(void) {
	const int mvs = bios ? bios == 2 : loader_default_bios();
	return loader_has_bios(mvs) ? mvs : !mvs;
}

const char *keys_button_name(u32 key) {
	for (int i = 0; i < NBUTTONS; i++)
		if (key == buttons[i].key) return buttons[i].name;
	return "off";
}

int keys_mapped(KeyEntry *out, int max) {
	int n = 0;
	for (int i = 0; i < NBUTTONS && n < max; i++) {
		if (!map[i] || (i >= 8 && map[i] == default_map[i])) continue; /* START / SELECT as usual */
		out[n].button = buttons[i].name;
		out[n].bits = actions[map[i]].bits;
		n++;
	}
	return n;
}

void keys_cycle_turbo(void) {
	/* off, then A, B, X, Y (the face buttons), saved like the key config */
	int t = turbo_index();
	t = t >= 4 ? 0 : t + 1;
	keys_turbo = t ? buttons[t - 1].key : 0;
	keys_save();
}

void keys_set_bios_mvs(int mvs) {
	if (!loader_has_bios(mvs)) return;
	bios = mvs ? 2 : 1;
	keys_save();
}

/* ---- key config screen: the 10 buttons, turbo, system and screen, then Default and Save ---- */

enum { ITEM_TURBO = NBUTTONS, ITEM_BIOS, ITEM_SCREEN, NROWS, ITEM_DEFAULT = NROWS, ITEM_SAVE, NITEMS };
enum { ROW_Y = 26, ROW_H = 14 }; /* 13 rows end at y 208, above the bottom buttons */
static const UiRect left_arrow = {226, 0, 40, 13}, right_arrow = {272, 0, 40, 13};
static const UiRect bottom_buttons[2] = {{8, 212, 148, 24}, {164, 212, 148, 24}};

static UiRect row_rect(int i, UiRect r) { r.y = ROW_Y + i * ROW_H + 1; return r; }

static void row_value(int i, char *out, size_t n) {
	if (i < NBUTTONS) snprintf(out, n, "%s", actions[map[i]].name);
	else if (i == ITEM_TURBO) snprintf(out, n, "%s", keys_button_name(keys_turbo));
	else if (i == ITEM_SCREEN) snprintf(out, n, "%s", keys_full_screen ? "Full (stretched)" : "Original (1:1)");
	else snprintf(out, n, "%s%s", keys_bios_mvs() ? "MVS (arcade)" : "AES (home)",
	              loader_has_bios(!keys_bios_mvs()) ? "" : " only");
}

static void draw_row(int i, int cursor) {
	char value[24];
	const int y = ROW_Y + i * ROW_H;
	ui_fill(0, y, 320, ROW_H, i == cursor ? UI_PANEL : UI_BG);
	if (i == cursor) ui_fill(0, y, 3, ROW_H, UI_ACCENT);
	ui_text(10, y + 4, i < NBUTTONS ? buttons[i].name : i == ITEM_TURBO ? "Turbo" : i == ITEM_BIOS ? "System" : "Screen",
	        i == cursor ? UI_ACCENT : UI_TEXT, 1);
	row_value(i, value, sizeof value);
	ui_text(80, y + 4, value, UI_TEXT, 1);
	ui_button(row_rect(i, left_arrow), "<", UI_PRESSED, UI_TEXT);
	ui_button(row_rect(i, right_arrow), ">", UI_PRESSED, UI_TEXT);
}

static void draw_bottom(int cursor, const char *status) {
	ui_fill(0, 208, 320, 32, UI_BG);
	ui_button(bottom_buttons[0], "Default", cursor == ITEM_DEFAULT ? UI_PRESSED : UI_PANEL,
	          cursor == ITEM_DEFAULT ? UI_ACCENT : UI_TEXT);
	ui_button(bottom_buttons[1], "Save (B)", cursor == ITEM_SAVE ? UI_PRESSED : UI_PANEL,
	          cursor == ITEM_SAVE ? UI_ACCENT : UI_TEXT);
	ui_fill(176, 0, 144, 22, UI_HEADER); /* status area, right of the title */
	if (status) ui_text(312 - ui_text_width(status, 1), 8, status, UI_ACCENT, 1);
}

static void draw_menu(int cursor, const char *status) {
	ui_fill(0, 0, 320, 240, UI_BG);
	ui_fill(0, 0, 320, 22, UI_HEADER);
	ui_text(8, 3, "Key config", UI_TEXT, 2);
	for (int i = 0; i < NROWS; i++) draw_row(i, cursor);
	draw_bottom(cursor, status);
	ui_flush();
}

static void change(int item, int step) {
	if (item < NBUTTONS) map[item] = (map[item] + step + NACTIONS) % NACTIONS;
	else if (item == ITEM_BIOS) {
		if (loader_has_bios(!keys_bios_mvs())) bios = keys_bios_mvs() ? 1 : 2;
	} else if (item == ITEM_TURBO) {
		int t = (turbo_index() + step + TURBO_BUTTONS + 1) % (TURBO_BUTTONS + 1);
		keys_turbo = t ? buttons[t - 1].key : 0;
	} else if (item == ITEM_SCREEN) keys_full_screen = !keys_full_screen;
}

void keys_menu(void) {
#ifdef NEO3DS_KEYCONFIG_ROW /* Azahar test (screenshots): start with the cursor on this row */
	int cursor = NEO3DS_KEYCONFIG_ROW;
#else
	int cursor = 0;
#endif
	const char *status = NULL;
	hidSetRepeatParameters(15, 5);
	draw_menu(cursor, status);
	while (aptMainLoop()) {
		gspWaitForVBlank();
		hidScanInput();
		const u32 down = hidKeysDown(), rep = hidKeysDownRepeat();
		int moved = -1, changed = -1; /* rows to redraw */
		bool activate = false, all = false;
		if (rep & (KEY_UP | KEY_DOWN)) {
			moved = cursor;
			cursor = (cursor + ((rep & KEY_UP) ? NITEMS - 1 : 1)) % NITEMS;
		} else if ((rep & (KEY_LEFT | KEY_RIGHT)) && cursor < NROWS) {
			change(cursor, (rep & KEY_LEFT) ? -1 : 1);
			changed = cursor;
		} else if (down & KEY_A) activate = true;
		else if (down & KEY_B) {
			cursor = ITEM_SAVE;
			activate = true;
		} else if (down & KEY_TOUCH) {
			touchPosition t;
			hidTouchRead(&t);
			for (int i = 0; i < NROWS; i++) {
				if (ui_hit(row_rect(i, left_arrow), t.px, t.py)) change(i, -1), changed = i;
				else if (ui_hit(row_rect(i, right_arrow), t.px, t.py)) change(i, 1), changed = i;
				else if (t.py >= ROW_Y + i * ROW_H && t.py < ROW_Y + (i + 1) * ROW_H) changed = i;
				if (changed == i && cursor != i) moved = cursor, cursor = i;
			}
			for (int b = 0; b < 2; b++)
				if (ui_hit(bottom_buttons[b], t.px, t.py)) {
					moved = cursor;
					cursor = ITEM_DEFAULT + b;
					activate = true;
				}
		}
		if (activate) {
			if (cursor < NROWS) {
				change(cursor, 1);
				changed = cursor;
			} else if (cursor == ITEM_DEFAULT) {
				memcpy(map, default_map, sizeof map);
				keys_turbo = 0;
				keys_full_screen = false;
				bios = 0;
				status = "Defaults set";
				all = true;
			} else {
				if (keys_save()) return;
				status = "Could not save";
			}
		}
		if (all) draw_menu(cursor, status);
		else if (moved >= 0 || changed >= 0 || activate) {
			if (moved >= 0 && moved < NROWS) draw_row(moved, cursor);
			if (changed >= 0) draw_row(changed, cursor);
			if (cursor < NROWS) draw_row(cursor, cursor);
			draw_bottom(cursor, status);
			ui_flush();
		}
	}
}
