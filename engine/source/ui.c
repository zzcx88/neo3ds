// Bottom screen GUI (see ui.h).
//
// The bottom framebuffer is 240x320 RGB565 stored like the top one: the screen rotated, one
// column of 240 pixels after another, each column bottom row first.
#include <stdio.h>
#include <string.h>

#include "ui.h"
#include "keys.h"
#include "loader.h"
#include "neo/memory.h"
#include "neo/emu.h"
#include "savestate.h"

static u16 *fb(void) { return (u16 *)gfxGetFramebuffer(GFX_BOTTOM, GFX_LEFT, NULL, NULL); }

void ui_fill(int x, int y, int w, int h, u16 color) {
	if (x < 0) w += x, x = 0;
	if (y < 0) h += y, y = 0;
	if (x + w > 320) w = 320 - x;
	if (y + h > 240) h = 240 - y;
	if (w <= 0 || h <= 0) return;
	u16 *p = fb();
	for (int i = x; i < x + w; i++) {
		u16 *col = p + i * 240 + (240 - y - h);
		for (int j = 0; j < h; j++) col[j] = color;
	}
}

int ui_text_width(const char *s, int scale) { return (int)strlen(s) * 8 * scale; }

void ui_text(int x, int y, const char *s, u16 color, int scale) {
	const ConsoleFont *font = &consoleGetDefault()->font;
	u16 *p = fb();
	for (; *s; s++, x += 8 * scale) {
		int c = (u8)*s - font->asciiOffset;
		if (c < 0 || c >= font->numChars) continue;
		const u8 *g = font->gfx + c * 8;
		for (int row = 0; row < 8; row++)
			for (int bit = 0; bit < 8; bit++) {
				if (!(g[row] & (0x80 >> bit))) continue;
				for (int sy = 0; sy < scale; sy++)
					for (int sx = 0; sx < scale; sx++) {
						const int px = x + bit * scale + sx, py = y + row * scale + sy;
						if (px >= 0 && px < 320 && py >= 0 && py < 240) p[px * 240 + 239 - py] = color;
					}
			}
	}
}

void ui_button(UiRect r, const char *label, u16 bg, u16 fg) {
	ui_fill(r.x, r.y, r.w, r.h, bg);
	ui_fill(r.x, r.y, r.w, 1, UI_DIM); /* thin top edge */
	ui_text(r.x + (r.w - ui_text_width(label, 1)) / 2, r.y + (r.h - 8) / 2, label, fg, 1);
}

bool ui_hit(UiRect r, int x, int y) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

void ui_flush(void) {
	/* the kernel call directly, not through the GSP service (see render_frame) */
	svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)fb(), 320 * 240 * 2);
}

/* ---- main screen ---- */

enum { B_KEYS, B_TURBO, B_SYSTEM, B_DIAG, B_RESTART, B_SERVICE, B_SLOT, B_SAVE, B_LOAD, B_LIST, B_OFF, NB };
static UiRect rects[NB] = {
	{8, 44, 148, 30}, {164, 44, 148, 30}, {8, 80, 148, 30}, {164, 80, 148, 30}, {8, 116, 148, 26}, {164, 116, 148, 26},
	{8, 148, 96, 26}, {112, 148, 96, 26}, {216, 148, 96, 26}, {0, 0, 0, 0}, /* B_LIST: launcher only */
	{290, 3, 20, 20}, /* B_OFF: a small square in the header */
};
static bool launcher; /* the third row is then Reset / Service / Game list */

void ui_set_launcher(void) {
	launcher = true;
	rects[B_RESTART] = (UiRect){8, 116, 96, 26};
	rects[B_SERVICE] = (UiRect){112, 116, 96, 26};
	rects[B_LIST] = (UiRect){216, 116, 96, 26};
}
/* the test button is held while touched, and at least SERVICE_FRAMES so that a tap reaches the BIOS */
enum { RESTART_FRAMES = 60, CONFIRM_FRAMES = 180, SERVICE_FRAMES = 15 };

static char title[40];
static char version[16]; /* "v1.1.0", empty for CIAs from converters before it was written */
static char default_status[40];

/* A short ASCII line written by the converter, non-printable bytes replaced. */
static void read_text(const char *name, char *out, size_t size) {
	char buf[64];
	if (!loader_read_text(name, buf, sizeof buf)) return;
	snprintf(out, size, "%s", buf);
	for (char *c = out; *c; c++)
		if ((u8)*c < 32 || (u8)*c > 126) *c = '?';
	if (strlen(buf) > size - 1 && size > 4) strcpy(out + size - 4, "...");
}
static char status[40];
static bool status_warn;
static int pressed = -1, hold, confirm, service;
static int slot, load_confirm, list_confirm; /* quick save slot (0-2), and the countdown of "Tap again" on Load */

int ui_state_slot(void) { return slot; }

void ui_main_init(double load_secs, bool sound) {
	read_text("title.txt", title, sizeof title); /* converter 1.0.7 and later */
	char v[12] = "";
	read_text("version.txt", v, sizeof v); /* converter 1.1.0 and later */
	if (v[0]) snprintf(version, sizeof version, "v%s", v);
	if (sound) snprintf(default_status, sizeof default_status, "Loaded in %.1fs", load_secs);
	else snprintf(default_status, sizeof default_status, "Sound off: no /3ds/dspfirm.cdc");
	status_warn = !sound;
	strcpy(status, default_status);
}

static void button_label(int b, char *out, size_t n) {
	switch (b) {
	case B_KEYS: snprintf(out, n, "Key config"); break;
	case B_TURBO: snprintf(out, n, "Turbo: %s", keys_button_name(keys_turbo)); break;
	case B_SYSTEM:
		if (!loader_has_bios(!memory.mvs)) snprintf(out, n, "System: %s only", memory.mvs ? "MVS" : "AES");
		else if (confirm) snprintf(out, n, "Tap again: %s", memory.mvs ? "AES" : "MVS");
		else snprintf(out, n, "System: %s", memory.mvs ? "MVS" : "AES");
		break;
	case B_DIAG: snprintf(out, n, "Diagnostics"); break;
	case B_SERVICE:
		if (launcher) snprintf(out, n, memory.mvs ? "Service" : "(MVS only)");
		else snprintf(out, n, memory.mvs ? "Service menu" : "Service: MVS only");
		break;
	case B_LIST: snprintf(out, n, list_confirm ? "Tap again" : "Game list"); break;
	case B_SLOT: snprintf(out, n, "Slot %d", slot + 1); break;
	case B_SAVE: snprintf(out, n, "Save"); break;
	case B_LOAD: snprintf(out, n, load_confirm ? "Tap again" : "Load"); break;
	default: snprintf(out, n, launcher ? "Hold: reset" : "Restart (hold)"); break;
	}
}

/* [LCD off]: a power symbol on a dark square */
static void draw_off_button(void) {
	static const char *const icon[11] = {
		"     #     ",
		"  #  #  #  ",
		" #   #   # ",
		"#    #    #",
		"#    #    #",
		"#         #",
		"#         #",
		" #       # ",
		"  #     #  ",
		"   #####   ",
		"",
	};
	const UiRect r = rects[B_OFF];
	ui_fill(r.x, r.y, r.w, r.h, pressed == B_OFF ? UI_PRESSED : UI_BG);
	for (int y = 0; icon[y][0]; y++)
		for (int x = 0; icon[y][x]; x++)
			if (icon[y][x] == '#') ui_fill(r.x + 4 + x, r.y + 5 + y, 1, 1, UI_TEXT);
}

static void draw_button(int b) {
	if (b == B_OFF) {
		draw_off_button();
		return;
	}
	char label[40];
	button_label(b, label, sizeof label);
	const UiRect r = rects[b];
	const u16 bg = b == pressed ? UI_PRESSED : ((b == B_SYSTEM && confirm) || (b == B_LOAD && load_confirm) || (b == B_LIST && list_confirm)) ? UI_HEADER : UI_PANEL;
	ui_button(r, label, bg, UI_TEXT);
	if (b == B_RESTART && hold) /* progress while held */
		ui_fill(r.x, r.y + r.h - 4, r.w * hold / RESTART_FRAMES, 4, UI_ACCENT);
}

static void draw_status(void) {
	ui_fill(0, 222, 320, 18, UI_BG);
	ui_text(8, 227, status, status_warn ? UI_ACCENT : UI_DIM, 1);
}

/* The Neo Geo buttons in the colours of the arcade panel: A red, B yellow, C green, D blue */
static const u16 neo_colors[4] = {UI_RGB(240, 64, 56), UI_RGB(248, 208, 40), UI_RGB(72, 208, 80), UI_RGB(72, 144, 248)};

/* "A+B" with each letter in its colour; Start and Coin in white. Returns the end x. */
static int draw_neo(int x, int y, unsigned bits) {
	if (bits & (NEO_START | NEO_COIN)) {
		const char *s = (bits & NEO_START) ? "Start" : "Coin";
		ui_text(x, y, s, UI_TEXT, 1);
		return x + ui_text_width(s, 1);
	}
	bool first = true;
	for (int b = 0; b < 4; b++) {
		if (!(bits & (1u << b))) continue;
		if (!first) ui_text(x, y, "+", UI_DIM, 1), x += 8;
		const char letter[2] = {(char)('A' + b), 0};
		ui_text(x, y, letter, neo_colors[b], 1);
		x += 8;
		first = false;
	}
	return x;
}

/* Two columns of "3DS button > Neo Geo": the face buttons on the left, the rest on the right */
enum { KEYS_Y = 184, KEYS_ROW = 12, KEYS_ROWS = 3 };
static void draw_keys(void) {
	KeyEntry e[10];
	const int n = keys_mapped(e, 10);
	int col[10], rows[2] = {0, 0}, width[2] = {0, 0};
	/* face buttons on the left, the rest on the right (each column takes the other's overflow) */
	for (int i = 0; i < n; i++) {
		const bool face = strlen(e[i].button) == 1 && strchr("ABXY", e[i].button[0]);
		int c = face ? 0 : 1;
		if (rows[c] == KEYS_ROWS) c = !c;
		if (rows[c] == KEYS_ROWS) { col[i] = -1; continue; }
		col[i] = c;
		rows[c]++;
		const int w = ui_text_width(e[i].button, 1);
		if (w > width[c]) width[c] = w;
	}
	ui_fill(0, KEYS_Y - 2, 320, KEYS_ROWS * KEYS_ROW + 3, UI_BG);
	rows[0] = rows[1] = 0;
	for (int i = 0; i < n; i++) {
		const int c = col[i];
		if (c < 0) continue;
		const int x = c ? 168 : 24, y = KEYS_Y + rows[c]++ * KEYS_ROW, a = x + width[c] + 8;
		ui_text(x, y, e[i].button, UI_TEXT, 1);
		ui_text(a, y, ">", UI_DIM, 1);
		draw_neo(a + 16, y, e[i].bits);
	}
}

void ui_main_draw(void) {
	ui_fill(0, 0, 320, 240, UI_BG);
	ui_fill(0, 0, 320, 26, UI_HEADER);
	ui_text(8, 5, "neo3ds", UI_TEXT, 2);
	ui_text(8 + ui_text_width("neo3ds", 2) + 8, 12, version, UI_TEXT, 1); /* on the logo's baseline */
	ui_text(8, 34, title, UI_TEXT, 1);
	for (int b = 0; b < NB; b++)
		if (rects[b].w) draw_button(b);
	draw_keys();
	draw_status();
	ui_flush();
}

void ui_status(const char *msg) {
	snprintf(status, sizeof status, "%s", msg ? msg : default_status);
	status_warn = msg != NULL;
	draw_status();
	ui_flush();
}

enum { FPS_RIGHT = 282 }; /* left of [LCD off] */
void ui_fps(double fps) {
	char s[16];
	snprintf(s, sizeof s, "%4.1f fps", fps);
	ui_fill(FPS_RIGHT - 72, 9, 72, 8, UI_HEADER);
	ui_text(FPS_RIGHT - ui_text_width(s, 1), 9, s, UI_TEXT, 1);
	ui_flush();
}

void ui_turbo_changed(void) {
	draw_button(B_TURBO);
	ui_flush();
}

/* [LCD off] turns the bottom screen's backlight off for the session (never saved). The next touch
 * turns it back on and does nothing else; so do the HOME menu, sleep and leaving the game. */
static bool lcd_off, lcd_waking; /* waking: the touch that turned it on is still down */

/* The gsp::Lcd session is opened for each call and closed at once: kept open, the HOME menu froze
 * the console when it took over (it needs the service too). */
static void set_backlight(bool on) {
	if (R_FAILED(gspLcdInit())) return;
	if (on) GSPLCD_PowerOnBacklight(GSPLCD_SCREEN_BOTTOM);
	else GSPLCD_PowerOffBacklight(GSPLCD_SCREEN_BOTTOM);
	gspLcdExit();
	lcd_off = !on;
}

void ui_screen_on(void) {
	if (lcd_off) set_backlight(true);
}

UiAction ui_main_update(void) {
	const u32 down = hidKeysDown(), held = hidKeysHeld(), up = hidKeysUp();
	UiAction action = UI_NONE;
	bool dirty = false;

	if (lcd_off || lcd_waking) {
		if (lcd_off && (down & KEY_TOUCH)) {
			set_backlight(true);
			lcd_waking = true;
		}
		if (lcd_waking && !(held & KEY_TOUCH)) lcd_waking = false;
		return UI_NONE;
	}

	if (confirm && --confirm == 0) {
		draw_button(B_SYSTEM);
		dirty = true;
	}
	if (load_confirm && --load_confirm == 0) {
		draw_button(B_LOAD);
		dirty = true;
	}
	if (list_confirm && --list_confirm == 0) {
		draw_button(B_LIST);
		dirty = true;
	}
	if (down & KEY_TOUCH) {
		touchPosition t;
		hidTouchRead(&t);
		for (int b = 0; b < NB; b++)
			if (rects[b].w && ui_hit(rects[b], t.px, t.py)) {
				pressed = b;
				hold = 0;
				if (b == B_SERVICE && memory.mvs) service = SERVICE_FRAMES;
				draw_button(b);
				dirty = true;
			}
	} else if ((held & KEY_TOUCH) && pressed == B_RESTART) {
		if (++hold == RESTART_FRAMES) {
			action = UI_RESTART;
			pressed = -1;
			hold = 0;
			draw_button(B_RESTART);
			dirty = true;
		} else if (hold % 4 == 0) {
			draw_button(B_RESTART);
			dirty = true;
		}
	} else if ((up & KEY_TOUCH) && pressed >= 0) {
		const int b = pressed;
		pressed = -1;
		hold = 0;
		switch (b) {
		case B_KEYS: action = UI_KEYCONFIG; break;
		case B_DIAG: action = UI_DIAG; break;
		case B_TURBO:
			keys_cycle_turbo();
			draw_keys();
			break;
		case B_SYSTEM:
			if (!loader_has_bios(!memory.mvs)) break;
			if (confirm) {
				confirm = 0;
				action = UI_SYSTEM;
			} else confirm = CONFIRM_FRAMES;
			break;
		case B_SLOT: {
			char s[40];
			slot = (slot + 1) % STATE_SLOTS;
			savestate_describe(slot, s, sizeof s);
			ui_status(s);
			break;
		}
		case B_SAVE: action = UI_STATE_SAVE; break;
		case B_OFF: set_backlight(false); break;
		case B_LIST:
			if (list_confirm) {
				list_confirm = 0;
				action = UI_GAME_LIST;
			} else list_confirm = CONFIRM_FRAMES;
			break;
		case B_LOAD:
			if (load_confirm) {
				load_confirm = 0;
				action = UI_STATE_LOAD;
			} else load_confirm = CONFIRM_FRAMES;
			break;
		}
		draw_button(b);
		dirty = true;
	}
	if (service) { /* the MVS test button: the BIOS opens its menu */
		if (pressed == B_SERVICE) service = SERVICE_FRAMES;
		else service--;
	}
	conf.test_switch = service > 0;
	if (dirty) ui_flush();
	return action;
}
