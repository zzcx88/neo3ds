// Button mapping and the key config screen on the bottom console.
//
// Each 3DS button (directions excluded) presses one entry of `actions`: a Neo Geo button, a
// combination such as A+B, Start or Coin. The mapping and the turbo button are saved per game
// in sdmc:/3ds/neo3ds/keys/<title id>.bin, with the BIOS choice (home AES or arcade MVS).
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "keys.h"
#include "loader.h"

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
static u8 bios; /* 0 = the converter's default, 1 = AES, 2 = MVS */

typedef struct {
	char magic[4]; /* "NKEY" */
	u8 version;
	u8 turbo; /* 0 = off, else 1 + index into buttons */
	u8 map[NBUTTONS];
	u8 bios; /* version 2 */
} KeyFile;

static void file_path(char *out, size_t n) {
	u64 id = 0;
	APT_GetProgramID(&id);
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
	bios = 0;
	char path[64];
	file_path(path, sizeof path);
	FILE *f = fopen(path, "rb");
	if (!f) return;
	KeyFile k = {{0}};
	/* version 1 files end before the bios byte */
	if (fread(&k, 1, sizeof k, f) >= offsetof(KeyFile, bios) && !memcmp(k.magic, "NKEY", 4) &&
	    (k.version == 1 || k.version == 2)) {
		if (k.version == 2 && k.bios <= 2) bios = k.bios;
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
	KeyFile k = {{'N', 'K', 'E', 'Y'}, 2, (u8)turbo_index(), {0}, bios};
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

int keys_print(int row) {
	for (int i = 0; i < NBUTTONS; i++) {
		if (!map[i]) continue;
		printf("\x1b[%d;2H%-16s%s", row++, buttons[i].name, actions[map[i]].name);
	}
	return row;
}

/* Menu lines: the buttons, then turbo, reset and save. Rows on the 40x30 console. */
enum { ITEM_TURBO = NBUTTONS, ITEM_BIOS, ITEM_RESET, ITEM_SAVE, NITEMS };
static int item_row(int i) { return i < NBUTTONS ? 4 + i : i == ITEM_TURBO ? 15 : i == ITEM_BIOS ? 16 : i == ITEM_RESET ? 18 : 20; }

static void draw_menu(int cursor, const char *status) {
	consoleClear();
	printf("\x1b[1;2H\x1b[1;36mKey config\x1b[0m  (saved for this game)");
	printf("\x1b[2;2H3DS button      Neo Geo");
	for (int i = 0; i < NITEMS; i++) {
		printf("\x1b[%d;0H%s", item_row(i), i == cursor ? "\x1b[33m>" : " ");
		if (i < NBUTTONS) printf(" %-16s%s", buttons[i].name, actions[map[i]].name);
		else if (i == ITEM_TURBO) printf(" %-16s%s", "Turbo button", keys_button_name(keys_turbo));
		else if (i == ITEM_BIOS) printf(" %-16s%s%s", "System", keys_bios_mvs() ? "MVS (arcade)" : "AES (home)",
		                                loader_has_bios(!keys_bios_mvs()) ? "" : " only");
		else if (i == ITEM_RESET) printf(" Reset to default");
		else printf(" Save and back");
		printf("\x1b[0m");
	}
	printf("\x1b[23;2HUp/Down     choose a line");
	printf("\x1b[24;2HLeft/Right  change it");
	printf("\x1b[25;2HA / touch   change / select");
	printf("\x1b[26;2HB           save and back");
	if (status) printf("\x1b[28;2H\x1b[33m%s\x1b[0m", status);
}

static void change(int item, int step) {
	if (item < NBUTTONS) map[item] = (map[item] + step + NACTIONS) % NACTIONS;
	else if (item == ITEM_BIOS) {
		if (loader_has_bios(!keys_bios_mvs())) bios = keys_bios_mvs() ? 1 : 2;
	} else if (item == ITEM_TURBO) {
		int t = (turbo_index() + step + TURBO_BUTTONS + 1) % (TURBO_BUTTONS + 1);
		keys_turbo = t ? buttons[t - 1].key : 0;
	}
}

void keys_menu(void (*flush)(void)) {
	int cursor = 0;
	const char *status = NULL;
	hidSetRepeatParameters(15, 5);
	draw_menu(cursor, status);
	flush();
	while (aptMainLoop()) {
		gspWaitForVBlank();
		hidScanInput();
		const u32 down = hidKeysDown(), rep = hidKeysDownRepeat();
		bool redraw = true, activate = false;
		if (rep & KEY_UP) cursor = (cursor + NITEMS - 1) % NITEMS;
		else if (rep & KEY_DOWN) cursor = (cursor + 1) % NITEMS;
		else if (rep & KEY_LEFT) change(cursor, -1);
		else if (rep & KEY_RIGHT) change(cursor, 1);
		else if (down & (KEY_A | KEY_B)) {
			if (down & KEY_B) cursor = ITEM_SAVE;
			activate = true;
		} else if (down & KEY_TOUCH) {
			touchPosition t;
			hidTouchRead(&t);
			const int row = t.py / 8 + 1;
			redraw = false;
			for (int i = 0; i < NITEMS; i++)
				if (row == item_row(i)) {
					if (i == cursor || i >= ITEM_RESET) activate = true;
					cursor = i;
					redraw = true;
				}
		} else redraw = false;
		if (activate) {
			if (cursor < ITEM_RESET) change(cursor, 1);
			else if (cursor == ITEM_RESET) {
				memcpy(map, default_map, sizeof map);
				keys_turbo = 0;
				bios = 0;
				status = "Defaults restored (not saved yet)";
			} else {
				if (keys_save()) return;
				status = "Could not save to the SD card";
			}
		}
		if (redraw) {
			draw_menu(cursor, status);
			flush();
		}
	}
}
