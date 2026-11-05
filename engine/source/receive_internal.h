// What the parts of the receive screen share (see receive.c).
#ifndef NEO3DS_RECEIVE_INTERNAL_H
#define NEO3DS_RECEIVE_INTERNAL_H

#include <3ds.h>
#include <stdbool.h>
#include <stdio.h>

#define PART_SUFFIX ".part" /* being received */
#define BAK_SUFFIX ".bak"   /* the old game, while the new one takes its name */

enum {
	/* The launcher keeps paths in 128 bytes: "sdmc:/neo3ds/games/" (19) + name + ".part" (5) */
	NAME_MAX_BYTES = 103,
	PATH_BYTES = 128,
	MAX_ITEMS = 6,
};

typedef struct {
	char host[16];
	u32 ip;   /* host byte order */
	u16 port;
	char path[256];                 /* as in the URL, %XX kept */
	char name[NAME_MAX_BYTES + 1];  /* the last path segment, decoded */
} Target;

typedef enum { DL_OK, DL_CANCELLED, DL_FAILED, DL_BAD_FILE } DlResult;

typedef enum { ITEM_WAITING, ITEM_SAVED, ITEM_SKIPPED, ITEM_FAILED } ItemState;
typedef struct {
	Target t;
	u64 length;
	bool replacing;
	ItemState state;
} Item;

/* ---- receive.c ---- */
extern char recv_reason[96];         /* why a download failed, for the screen and the log */
extern int recv_http_status;
extern volatile bool recv_interrupted;
void recv_set_reason(const char *text);
bool recv_still_wanted(void);        /* True to go on, false after B or when the system closes the app */

/* ---- receive_url.c ---- */
/* The whole text of a code. NULL when every line is good, else what is wrong. */
const char *recv_parse_list(const char *text, Item *out, int *count);

/* ---- receive_net.c ---- */
bool recv_net_open(void);            /* the socket service and the buffer */
void recv_net_close(void);
/* Connects and asks. With DL_OK *sock is open, *length the file's size, and *extra bytes of the
 * body came with the headers. */
DlResult recv_net_request(const Target *t, const char *method, int *sock, u64 *length, int *extra);
/* The body, into out: exactly length bytes, starting with what came with the headers. */
DlResult recv_read_body(int sock, FILE *out, int extra, u64 length, u64 *got);

/* ---- receive_file.c ---- */
bool recv_install(const char *part, const char *final);
bool recv_free_space(u64 *available, u64 *cluster);
bool recv_space_ok(u64 bytes, int files);
bool recv_make_game_folders(void);
void recv_log(const char *name, const char *what, u64 bytes);

/* ---- receive_screen.c ---- */
void recv_draw_top(const char *line);
void recv_line(int y, const char *s, u16 color);
void recv_draw_frame(const char *name, const char *foot);
void recv_draw_status(const char *s);
void recv_draw_progress(u64 got, u64 total, u32 bytes_per_second);
void recv_draw_items(const Item *items, int count, const char *title, bool results);
void recv_scan_status(const char *s);
bool recv_wait_answer(bool question);
void recv_show_message(const char *name, const char *title, const char *detail, const char *top_line);

#endif
