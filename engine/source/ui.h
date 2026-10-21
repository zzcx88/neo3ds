// Bottom screen GUI: buttons drawn by the CPU straight into the bottom framebuffer, and only when
// something changes, so it costs nothing while the game runs. The diagnostics screen keeps
// using the text console, which draws into the same framebuffer.
#ifndef NEO3DS_UI_H
#define NEO3DS_UI_H

#include <3ds.h>
#include <stdbool.h>

#define UI_RGB(r, g, b) (u16)((((r) >> 3) << 11) | (((g) >> 2) << 5) | ((b) >> 3))
enum {
	UI_BG = UI_RGB(22, 22, 28),
	UI_PANEL = UI_RGB(46, 46, 56),
	UI_PRESSED = UI_RGB(90, 90, 104),
	UI_HEADER = UI_RGB(176, 20, 32),
	UI_TEXT = UI_RGB(236, 236, 236),
	UI_DIM = UI_RGB(140, 140, 150),
	UI_ACCENT = UI_RGB(248, 196, 40),
};

typedef struct { s16 x, y, w, h; } UiRect;

/* Drawing primitives (x 0..319, y 0..239 from the top left) */
void ui_fill(int x, int y, int w, int h, u16 color);
void ui_text(int x, int y, const char *s, u16 color, int scale); /* 8x8 font, scale 1 or 2 */
int ui_text_width(const char *s, int scale);
void ui_button(UiRect r, const char *label, u16 bg, u16 fg);
bool ui_hit(UiRect r, int x, int y);
void ui_flush(void); /* writes the framebuffer back from the cache for the display */

/* The main screen */
typedef enum { UI_NONE, UI_KEYCONFIG, UI_DIAG, UI_SYSTEM, UI_RESTART, UI_STATE_SAVE, UI_STATE_LOAD, UI_GAME_LIST } UiAction;
void ui_main_init(double load_secs, bool sound);
void ui_set_launcher(void);      /* started from the launcher: a [Game list] button goes back */
void ui_main_draw(void);
void ui_status(const char *msg); /* a one-line message at the bottom (NULL restores the default) */
void ui_fps(double fps);         /* once a second */
UiAction ui_main_update(void);   /* every frame: touch handling */
void ui_turbo_changed(void);     /* redraws the turbo button */
void ui_screen_on(void);         /* the bottom backlight back on if [LCD off] turned it off */
int ui_state_slot(void);         /* the quick save slot picked on the main screen (0-2) */

#endif
