// What the Azahar test of the launcher (scripts/azahar_launcher_test.ps1) adds to the engine, all of it
// in recv_test.c and only with NEO3DS_RECV_TEST. In any other build these do nothing and leave no code.
//
// Never on a real console: the button file is looked for on the SD card 10 times a second, and the
// list writes its state at every cursor move, which costs frames.
#ifndef NEO3DS_RECV_TEST_H
#define NEO3DS_RECV_TEST_H

#include <3ds.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef NEO3DS_RECV_TEST

u32 recv_test_keys(void);                    /* a letter in a file: a press of that button */
bool recv_test_write_fails(void);            /* the next SD card write is to fail */
void recv_test_free_space(u64 *available, u64 cluster); /* Azahar always reports a large free space */
bool recv_test_url(char *url, size_t size);  /* True when the address comes from a file, not a QR code */
void recv_test_list_state(int tab, const char *selected, int favorites, int count); /* what the list shows */
void recv_test_decode_count(int codes);      /* the camera's last decode, for the line it shows */
void recv_test_decode_error(int error);
void recv_test_show_decode(u64 ms);
/* A touch from the same file: KEY_TOUCH in these for the frames it lasts, and its place. */
u32 recv_test_touch_down(void);
u32 recv_test_touch_held(void);
u32 recv_test_touch_up(void);
void recv_test_touch_place(touchPosition *t);
void recv_test_ui_log(const char *what);     /* what a touch made happen, for the test to read */

#else

static inline u32 recv_test_keys(void) { return 0; }
static inline bool recv_test_write_fails(void) { return false; }
static inline void recv_test_free_space(u64 *available, u64 cluster) { (void)available; (void)cluster; }
static inline bool recv_test_url(char *url, size_t size) { (void)url; (void)size; return false; }
static inline void recv_test_list_state(int tab, const char *selected, int favorites, int count) {
	(void)tab; (void)selected; (void)favorites; (void)count;
}
static inline void recv_test_decode_count(int codes) { (void)codes; }
static inline void recv_test_decode_error(int error) { (void)error; }
static inline void recv_test_show_decode(u64 ms) { (void)ms; }
static inline u32 recv_test_touch_down(void) { return 0; }
static inline u32 recv_test_touch_held(void) { return 0; }
static inline u32 recv_test_touch_up(void) { return 0; }
static inline void recv_test_touch_place(touchPosition *t) { (void)t; }
static inline void recv_test_ui_log(const char *what) { (void)what; }

#endif

/* Where the touch is, on the screens the test drives. */
static inline void ui_touch_read(touchPosition *t) {
	hidTouchRead(t);
	recv_test_touch_place(t);
}

/* The buttons pressed this frame, on the screens the test drives. */
#define RECEIVE_KEYS_DOWN() (hidKeysDown() | recv_test_keys())

#endif
