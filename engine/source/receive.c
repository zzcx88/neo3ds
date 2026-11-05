// The launcher's receive screen: downloads a .neo3ds file from the PC (LanSender in the converter)
// into the game folder, so a game gets to the 3DS without taking the SD card out.
//
// A QR code holds 1 to 6 addresses, one a line. All are checked first, then the PC is asked their
// sizes, and with more than one file (or one that replaces a game) the player confirms.
//
// Each file is written as <name>.part, checked as a game file, and only then takes its final name:
// the list never shows half a file, and a failed download leaves the old game in place. A bad game
// file is skipped; a network or SD card failure or B ends the batch, keeping the files already saved.
//
// The HTTP client is what LanSender needs and no more: GET, a 200 with one Content-Length, no
// chunks, redirects or compression. Sockets are non-blocking so B works at any moment.
#include <3ds.h>
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <time.h>
#include <unistd.h>

#include "launcher.h"
#include "loader.h"
#include "qrscan.h"
#include "receive.h"
#include "sdfiles.h"
#include "ui.h"

#define LOG_FILE SD_DATA_DIR "/receive.log"
#define LOG_OLD LOG_FILE ".old"
#define PART_SUFFIX ".part" /* being received */
#define BAK_SUFFIX ".bak"   /* the old game, while the new one takes its name */

#define NOT_AN_ADDRESS "This QR code is not a PC address."
#define HOME_OPENED "The HOME menu opened during the transfer."
#define NOT_SAVED "The game was not saved."

enum {
	SOC_BYTES = 0x100000,   /* page aligned, on the normal heap: returned before a game loads */
	SOCK_BUFFER = 0x8000,
	CHUNK = 0x10000,        /* written to the SD card a chunk at a time */
	HEAD_MAX = 4096,
	/* The launcher keeps paths in 128 bytes: "sdmc:/neo3ds/games/" (19) + name + ".part" (5) */
	NAME_MAX_BYTES = 103,
	PATH_BYTES = 128,
	CONNECT_MS = 10000,
	IDLE_MS = 15000,        /* no data for this long: the PC or the Wi-Fi is gone */
	BATCH_MS = 8,           /* socket work between looks at the buttons */
	DRAW_MS = 250,
	LOG_MAX = 32 * 1024,    /* then it becomes the .old file: two of these at most */
	RECOVER_MAX = 16,       /* leftovers handled per start */
};

typedef struct {
	char host[16];
	u32 ip;   /* host byte order */
	u16 port;
	char path[256];                 /* as in the URL, %XX kept */
	char name[NAME_MAX_BYTES + 1];  /* the last path segment, decoded */
} Target;

typedef enum { DL_OK, DL_CANCELLED, DL_FAILED, DL_BAD_FILE } DlResult;

enum { MAX_ITEMS = 6 };
typedef enum { ITEM_WAITING, ITEM_SAVED, ITEM_SKIPPED, ITEM_FAILED } ItemState;
typedef struct {
	Target t;
	u64 length;
	bool replacing;
	ItemState state;
} Item;
static Item items[MAX_ITEMS];
static int item_count;

static char reason[96];    /* why a download failed, for the screen and the log */
static int http_status;
static volatile bool interrupted;

bool receive_interrupted(void) { return interrupted; }

/* HOME or sleep: the sockets don't survive them, and the transfer is given up on the way back. */
static void on_apt(APT_HookType type, void *param) {
	(void)param;
	if (type == APTHOOK_ONSUSPEND || type == APTHOOK_ONSLEEP) interrupted = true;
}

#ifdef NEO3DS_RECV_TEST
static bool test_write_fails;
#endif

static void set_reason(const char *text) { snprintf(reason, sizeof reason, "%s", text); }

#ifdef NEO3DS_RECV_TEST
/* A letter in a file, a press of that button; the file is removed. Looked at 10 times a second. */
u32 receive_test_keys(void) {
	static u64 next;
	const u64 now = osGetTime();
	if (now < next) return 0;
	next = now + 100;
	FILE *f = fopen(SD_DATA_DIR "/recv_key.txt", "r");
	if (!f) return 0;
	const int c = fgetc(f);
	fclose(f);
	remove(SD_DATA_DIR "/recv_key.txt");
	if (c == 'H') interrupted = true; /* as if the HOME menu had come up */
	if (c == 'W') test_write_fails = true;
	if (c == 'R') return KEY_RIGHT;
	if (c == 'T') return KEY_LEFT;
	if (c == 'S') { /* writes down whether the console may sleep now */
		FILE *state = fopen(SD_DATA_DIR "/recv_state.txt", "w");
		if (state) {
			fprintf(state, "sleep=%d\n", aptIsSleepAllowed());
			fclose(state);
		}
	}
	/* L and P: leave a running game for the list, take a snapshot (main.c) */
	return c == 'A' ? KEY_A : c == 'B' ? KEY_B : c == 'Y' ? KEY_Y : c == 'D' ? KEY_DOWN : c == 'L' ? KEY_ZL : c == 'P' ? KEY_ZR : 0;
}
#endif

/* ---- the address in the QR code ---- */

static int hex_value(int c) {
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

/* A name the SD card can hold and the list will show. */
static bool name_ok(const char *s) {
	const size_t n = strlen(s);
	if (n > NAME_MAX_BYTES || !sd_has_suffix(s, PACK_SUFFIX)) return false;
	for (const char *c = s; *c; c++)
		if ((u8)*c < 32 || *c == 127 || strchr("/\\:*?\"<>|", *c)) return false;
	return true;
}

/* IPv4 numbers + port + path only. NULL when good, else what is wrong. */
static const char *parse_url(const char *url, Target *t) {
	static const char *const bad = NOT_AN_ADDRESS;
	if (strncmp(url, "http://", 7)) return bad;
	const char *p = url + 7;
	u32 ip = 0;
	for (int i = 0; i < 4; i++) {
		int v = 0, digits = 0;
		while (*p >= '0' && *p <= '9' && digits < 3) {
			if (digits == 1 && v == 0) return bad; /* a leading zero */
			v = v * 10 + *p++ - '0';
			digits++;
		}
		if (!digits || v > 255) return bad;
		ip = ip << 8 | v;
		if (i < 3 && *p++ != '.') return bad;
	}
	if (*p++ != ':') return bad;
	int port = 0, digits = 0;
	while (*p >= '0' && *p <= '9' && digits < 5) {
		port = port * 10 + *p++ - '0';
		digits++;
	}
	if (!digits || port < 1 || port > 65535 || *p != '/') return bad;
	const u32 first = ip >> 24;
	if (first == 0 || first == 127 || first >= 224) return bad; /* no one, this 3DS, multicast */
	if (strlen(p) >= sizeof t->path) return bad;
	for (const char *c = p; *c; c++)
		if ((u8)*c <= 32 || (u8)*c >= 127 || *c == '?' || *c == '#') return bad;

	/* The sender's form: /<16 hex digits>/<file name> */
	for (int i = 1; i <= 16; i++)
		if (hex_value(p[i]) < 0) return bad;
	if (p[17] != '/' || strchr(p + 18, '/')) return bad;
	const char *seg = p + 18;
	size_t n = 0;
	for (const char *c = seg; *c; n++) {
		if (n >= sizeof t->name - 1) return "The file name is too long.";
		if (*c != '%') {
			t->name[n] = *c++;
			continue;
		}
		const int hi = hex_value(c[1]), lo = hi < 0 ? -1 : hex_value(c[2]);
		if (lo < 0) return bad;
		t->name[n] = hi << 4 | lo;
		if (!t->name[n]) return bad;
		c += 3;
	}
	t->name[n] = 0;
	if (!name_ok(t->name)) return "This code is not for a .neo3ds file.";

	t->ip = ip;
	t->port = port;
	snprintf(t->host, sizeof t->host, "%lu.%lu.%lu.%lu", (unsigned long)(ip >> 24), (unsigned long)(ip >> 16 & 255),
		(unsigned long)(ip >> 8 & 255), (unsigned long)(ip & 255));
	snprintf(t->path, sizeof t->path, "%s", p);
	return NULL;
}

/* The whole text of a code: every line must be good before anything is fetched. */
static const char *parse_list(const char *text, Item *out, int *count) {
	static const char *const bad = NOT_AN_ADDRESS;
	char line[sizeof out[0].t.path + 32];
	int n = 0;
	for (const char *p = text;;) {
		const char *end = strchr(p, '\n');
		const size_t len = end ? (size_t)(end - p) : strlen(p);
		if (n == MAX_ITEMS) return "This code has too many files.";
		if (!len || len >= sizeof line) return bad;
		memcpy(line, p, len);
		line[len] = 0;
		const char *why = parse_url(line, &out[n].t);
		if (why) return why;
		if (n && (out[n].t.ip != out[0].t.ip || out[n].t.port != out[0].t.port)) return bad;
		for (int j = 0; j < n; j++)
			if (!strcasecmp(out[j].t.name, out[n].t.name)) return "This code has one file name twice.";
		n++;
		if (!end) break;
		p = end + 1;
	}
	*count = n;
	return NULL;
}

/* ---- the screens ---- */

static void draw_top(const char *line) {
	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	ui_top_logo(fb);
	ui_top_center(fb, 140, "Receive a game", UI_TEXT, 2);
	ui_top_center(fb, 170, line, UI_DIM, 1);
	gfxFlushBuffers();
}

/* One line, cut to the 38 characters that fit */
static void line_text(int y, const char *s, u16 color) {
	char t[40];
	ui_fit(t, sizeof t, s, 38);
	ui_text(8, y, t, color, 1);
}

static void draw_frame(const char *name, const char *foot) {
	ui_header("receive");
	if (name) line_text(40, name, UI_TEXT);
	ui_text(8, 227, foot, UI_DIM, 1);
}

static void draw_status(const char *s) {
	ui_fill(0, 70, 320, 80, UI_BG);
	line_text(80, s, UI_TEXT);
	ui_flush();
}

static void draw_progress(u64 got, u64 total, u32 bytes_per_second) {
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

/* True to go on, false when the player cancelled with B or the system is closing the app. */
static bool still_wanted(void) {
	if (!aptMainLoop() || interrupted) return false;
	hidScanInput();
	return !(RECEIVE_KEYS_DOWN() & KEY_B);
}

/* Waits for A (true) or B (false). A question (not a message) also ends when the HOME menu opens. */
static bool wait_answer(bool question) {
	while (aptMainLoop()) {
		hidScanInput();
		const u32 down = RECEIVE_KEYS_DOWN();
		if (down & KEY_A) return true;
		if ((down & KEY_B) || (question && interrupted)) return false;
		gspWaitForVBlank();
	}
	return false;
}

/* top_line NULL leaves the top screen as it is. */
static void show_message(const char *name, const char *title, const char *detail, const char *top_line) {
	if (top_line) draw_top(top_line);
	draw_frame(name, "A/B: back to the list");
	line_text(80, title, UI_TEXT);
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
	wait_answer(false);
}

/* ---- the game file ---- */

/* Puts the checked file in place. An old file with the same name moves aside first, and back
 * if the new one can't take its name. */
static bool install(const char *part, const char *final) {
	char bak[PATH_BYTES + 8];
	struct stat st;
	const bool replacing = stat(final, &st) == 0;
	snprintf(bak, sizeof bak, "%s" BAK_SUFFIX, final);
	if (replacing) {
		remove(bak);
		if (rename(final, bak)) {
			set_reason("Can't move the old file on the SD card.");
			return false;
		}
	}
	if (rename(part, final)) {
		if (replacing) rename(bak, final);
		set_reason("Can't name the new file on the SD card.");
		return false;
	}
	if (replacing) remove(bak);
	return true;
}

/* ---- the download ---- */

/* The console's Wi-Fi connection (0: none), for the reason of a failure. */
static u32 wifi_status(void) {
	u32 status = 0;
	if (R_SUCCEEDED(acInit())) {
		ACU_GetWifiStatus(&status);
		acExit();
	}
	return status;
}

/* The reason of a failure to get on the network, with the code for a report. */
static void network_failed(const char *what, unsigned long code) {
	const u32 wifi = wifi_status();
	if (wifi) snprintf(reason, sizeof reason, "%s (error %lX)", what, code);
	else snprintf(reason, sizeof reason, "Not connected to Wi-Fi: turn it on and try again. (error %lX)", code);
}

static bool wait_socket(int sock, short events, int ms) {
	struct pollfd p = {.fd = sock, .events = events};
	return poll(&p, 1, ms) > 0;
}

/* Non-blocking connect, for at most CONNECT_MS. Asks by connecting again: on the console, SO_ERROR
 * after a poll reports a failure for a connection that went through. */
static DlResult net_connect(int sock, const Target *t) {
	struct sockaddr_in a;
	memset(&a, 0, sizeof a);
	a.sin_family = AF_INET;
	a.sin_port = htons(t->port);
	a.sin_addr.s_addr = htonl(t->ip);
	const u64 end = osGetTime() + CONNECT_MS;
	int error = 0;
	while (osGetTime() < end) {
		if (!still_wanted()) return DL_CANCELLED;
		if (connect(sock, (struct sockaddr *)&a, sizeof a) == 0 || errno == EISCONN) return DL_OK;
		error = errno;
		if (error != EINPROGRESS && error != EALREADY && error != EWOULDBLOCK) break;
		wait_socket(sock, POLLOUT, 16);
	}
	network_failed("Can't reach the PC: same Wi-Fi? Firewall?", error);
	return DL_FAILED;
}

static DlResult net_send(int sock, const char *s, size_t n) {
	const u64 end = osGetTime() + CONNECT_MS;
	while (n) {
		if (!still_wanted()) return DL_CANCELLED;
		if (osGetTime() >= end) break;
		const ssize_t w = send(sock, s, n, 0);
		if (w > 0) {
			s += w;
			n -= w;
		} else if (w == 0 || (errno != EWOULDBLOCK && errno != EAGAIN)) {
			break;
		} else {
			wait_socket(sock, POLLOUT, 16);
		}
	}
	if (!n) return DL_OK;
	set_reason("The PC stopped answering.");
	return DL_FAILED;
}

/* Reads up to the end of the headers. Body bytes that came with them stay in buf, *got of them
 * after *head_end. */
static DlResult read_head(int sock, char *buf, int *head_end, int *got) {
	int n = 0;
	u64 last = osGetTime();
	for (;;) {
		if (!still_wanted()) return DL_CANCELLED;
		const ssize_t r = recv(sock, buf + n, HEAD_MAX - 1 - n, 0);
		if (r > 0) {
			n += r;
			buf[n] = 0;
			const char *end = strstr(buf, "\r\n\r\n");
			if (end) {
				*head_end = end + 4 - buf;
				*got = n - *head_end;
				return DL_OK;
			}
			if (n >= HEAD_MAX - 1) break;
			last = osGetTime();
		} else if (r == 0 || (errno != EWOULDBLOCK && errno != EAGAIN)) {
			break;
		} else {
			if (osGetTime() - last > IDLE_MS) break;
			wait_socket(sock, POLLIN, 16);
		}
	}
	set_reason("The PC sent no usable answer.");
	return DL_FAILED;
}

/* The status line and the headers that matter. True for a 200 this client can read. */
static bool parse_head(char *head, u64 *length) {
	if (strncmp(head, "HTTP/1.0 ", 9) && strncmp(head, "HTTP/1.1 ", 9)) {
		set_reason("The PC sent no usable answer.");
		return false;
	}
	http_status = atoi(head + 9);
	if (http_status != 200) {
		if (http_status == 404) set_reason("The PC no longer offers this file.");
		else snprintf(reason, sizeof reason, "The PC answered with error %d.", http_status);
		return false;
	}
	int lengths = 0;
	char *line = strstr(head, "\r\n");
	while (line && line[2] != '\r') {
		char *name = line + 2, *end = strstr(name, "\r\n");
		if (!end) break;
		*end = 0;
		char *colon = strchr(name, ':');
		if (colon) {
			*colon = 0;
			char *value = colon + 1;
			while (*value == ' ' || *value == '\t') value++;
			if (!strcasecmp(name, "Content-Length")) {
				u64 v = 0;
				const char *c = value;
				for (; *c >= '0' && *c <= '9' && v <= 0xFFFFFFFFull; c++) v = v * 10 + (*c - '0');
				if (c == value || *c || v > 0xFFFFFFFFull) lengths = 2; /* unusable, or over FAT32's limit */
				*length = v;
				lengths++;
			} else if (!strcasecmp(name, "Transfer-Encoding") ||
			           (!strcasecmp(name, "Content-Encoding") && strcasecmp(value, "identity"))) {
				set_reason("The PC sent the file in a form this can't read.");
				return false;
			}
		}
		*end = '\r';
		line = end;
	}
	if (lengths != 1) {
		set_reason("The PC did not say the file's size.");
		return false;
	}
	return true;
}

static bool free_space(u64 *available, u64 *cluster) {
	struct statvfs v;
	if (statvfs("sdmc:/", &v)) return false;
	*cluster = v.f_bsize ? v.f_bsize : 1;
	*available = (u64)v.f_bavail * *cluster;
#ifdef NEO3DS_RECV_TEST
	/* Azahar always reports a large free space: the file holds the MB to pretend */
	FILE *f = fopen(SD_DATA_DIR "/recv_free.txt", "r");
	if (f) {
		char s[16] = "";
		if (fgets(s, sizeof s, f)) *available = (u64)atoi(s) << 20;
		fclose(f);
	}
#endif
	return true;
}

/* Room for these bytes in this many files, checked before a byte is written. */
static bool space_ok(u64 bytes, int files) {
	u64 available, cluster;
	if (!free_space(&available, &cluster)) {
		set_reason("Can't read the SD card's free space.");
		return false;
	}
	/* Each file ends in a part of a cluster and may need one for its folder entry; the two game
	 * folders may have to be made first */
	const u64 needed = bytes + ((u64)files * 2 + 2) * cluster;
	if (available >= needed) return true;
	snprintf(reason, sizeof reason, "Not enough space on the SD card: needs %lu MB, %lu MB free.",
		(unsigned long)(needed >> 20) + 1, (unsigned long)(available >> 20));
	return false;
}

/* The body, into out: exactly length bytes. */
static DlResult read_body(int sock, FILE *out, char *buf, int fill, u64 length, u64 *got_out) {
	u64 got = fill, draw_t = 0, speed_t = osGetTime(), speed_got = got, last_data = speed_t;
	u32 speed = 0;
	while (got < length) {
		if (!still_wanted()) {
			*got_out = got;
			return DL_CANCELLED;
		}
		const u64 batch_end = osGetTime() + BATCH_MS;
		do {
			const u64 left = length - got;
			const size_t room = CHUNK - fill;
			const ssize_t r = recv(sock, buf + fill, left < room ? left : room, 0);
			if (r > 0) {
				fill += r;
				got += r;
				last_data = osGetTime();
				if (fill == CHUNK || got == length) {
#ifdef NEO3DS_RECV_TEST
					if (test_write_fails) {
						test_write_fails = false;
						*got_out = got;
						set_reason("Can't write to the SD card.");
						return DL_FAILED;
					}
#endif
					if (fwrite(buf, 1, fill, out) != (size_t)fill) {
						*got_out = got;
						set_reason("Can't write to the SD card.");
						return DL_FAILED;
					}
					fill = 0;
				}
			} else if (r == 0 || (errno != EWOULDBLOCK && errno != EAGAIN)) {
				*got_out = got;
				set_reason("The connection ended before the whole file came.");
				return DL_FAILED;
			} else {
				wait_socket(sock, POLLIN, 4);
			}
		} while (got < length && osGetTime() < batch_end);

		const u64 now = osGetTime();
		if (now - last_data > IDLE_MS) {
			*got_out = got;
			set_reason("The PC stopped sending: Wi-Fi lost?");
			return DL_FAILED;
		}
		if (now - speed_t >= 1000) {
			speed = (u32)((got - speed_got) * 1000 / (now - speed_t));
			speed_t = now;
			speed_got = got;
		}
		if (now - draw_t >= DRAW_MS) {
			draw_t = now;
			draw_progress(got, length, speed);
		}
	}
	/* a body shorter than one chunk came whole with the headers */
	if (fill && fwrite(buf, 1, fill, out) != (size_t)fill) {
		*got_out = got;
		set_reason("Can't write to the SD card.");
		return DL_FAILED;
	}
	*got_out = got;
	draw_progress(got, length, speed);
	return DL_OK;
}

/* The socket service and the buffer, up from the first question to the last file. */
static char *net_buf;
static u32 *net_soc;
static bool net_up;

static void net_close(void) {
	if (net_up) socExit();
	net_up = false;
	free(net_soc);
	free(net_buf);
	net_soc = NULL;
	net_buf = NULL;
}

static bool net_open(void) {
	net_buf = malloc(CHUNK > HEAD_MAX ? CHUNK : HEAD_MAX);
	net_soc = memalign(0x1000, SOC_BYTES);
	if (!net_buf || !net_soc) {
		set_reason("Out of memory.");
		net_close();
		return false;
	}
	const Result r = socInit(net_soc, SOC_BYTES);
	if (R_FAILED(r)) {
		network_failed("Can't start the network.", (unsigned long)r);
		net_close();
		return false;
	}
	net_up = true;
	return true;
}

/* Connects and asks. With DL_OK *sock is open, *length the file's size, and *extra bytes of the
 * body that came with the headers are at the start of net_buf. */
static DlResult net_request(const Target *t, const char *method, int *sock, u64 *length, int *extra) {
	*sock = socket(AF_INET, SOCK_STREAM, 0);
	if (*sock < 0) {
		network_failed("Can't start the network.", errno);
		return DL_FAILED;
	}
	const int size = SOCK_BUFFER;
	setsockopt(*sock, SOL_SOCKET, SO_RCVBUF, &size, sizeof size);
	fcntl(*sock, F_SETFL, fcntl(*sock, F_GETFL, 0) | O_NONBLOCK);

	DlResult result = net_connect(*sock, t);
	if (result == DL_OK) {
		char request[sizeof t->path + 128];
		const int n = snprintf(request, sizeof request,
			"%s %s HTTP/1.1\r\nHost: %s:%u\r\nUser-Agent: neo3ds\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
			method, t->path, t->host, t->port);
		result = net_send(*sock, request, n);
	}
	int head_end = 0;
	if (result == DL_OK) result = read_head(*sock, net_buf, &head_end, extra);
	if (result == DL_OK) {
		const char saved = net_buf[head_end]; /* parse_head reads only up to the blank line */
		net_buf[head_end] = 0;
		if (!parse_head(net_buf, length)) result = DL_FAILED;
		net_buf[head_end] = saved;
	}
	if (result == DL_OK && (!*length || (u64)*extra > *length)) {
		set_reason("The PC sent no usable answer.");
		result = DL_FAILED;
	}
	if (result != DL_OK) {
		close(*sock);
		*sock = -1;
		return result;
	}
	memmove(net_buf, net_buf + head_end, *extra);
	return DL_OK;
}

/* One file, from the question to a checked .part file. */
static DlResult fetch(const Item *item, const char *part, u64 *got) {
	int sock = -1, extra = 0;
	u64 length = 0;
	FILE *out = NULL;
	*got = 0;
	draw_status("Connecting to the PC...");
	DlResult result = net_request(&item->t, "GET", &sock, &length, &extra);
	if (result != DL_OK) goto done;
	result = DL_FAILED;
	if (length != item->length) {
		set_reason("The file changed on the PC. Scan the code again.");
		goto done;
	}
	if (!space_ok(length, 1)) goto done;
	mkdir("sdmc:/neo3ds", 0777);
	mkdir(LAUNCHER_GAMES_DIR, 0777);
	if (!(out = fopen(part, "wb"))) {
		set_reason("Can't create the file on the SD card.");
		goto done;
	}
	setvbuf(out, NULL, _IONBF, 0); /* whole chunks, no copy */
	result = read_body(sock, out, net_buf, extra, length, got);
	if (result == DL_OK) {
		const int closed = fclose(out);
		out = NULL;
		if (closed) {
			set_reason("Can't finish the file on the SD card.");
			result = DL_FAILED;
		} else {
			draw_status("Checking the file...");
			const char *wrong = loader_check_pack(part, length);
			if (wrong) {
				set_reason(wrong);
				result = DL_BAD_FILE;
			}
		}
	}
done:
	if (out) fclose(out);
	if (sock >= 0) close(sock);
	if (result != DL_OK) remove(part);
	return result;
}

/* One line per attempt. The address is not written: its path holds the sender's token. */
static void log_attempt(const char *name, const char *what, u64 bytes) {
	sd_make_data_dir(NULL);
	struct stat st;
	if (stat(LOG_FILE, &st) == 0 && st.st_size >= LOG_MAX) {
		remove(LOG_OLD);
		if (rename(LOG_FILE, LOG_OLD)) { /* it must not keep growing: start it again */
			FILE *emptied = fopen(LOG_FILE, "w");
			if (emptied) fclose(emptied);
		}
	}
	FILE *f = fopen(LOG_FILE, "a");
	if (!f) return;
	char when[32] = "";
	const time_t now = time(NULL);
	const struct tm *t = gmtime(&now); /* the console clock is local time */
	if (t) strftime(when, sizeof when, "%Y-%m-%d %H:%M:%S", t);
	fprintf(f, "%s %s %s bytes=%llu status=%d %s\n", when, what, name, (unsigned long long)bytes, http_status, reason);
	fclose(f);
}

/* ---- the screen ---- */

/* For the scanner: a code only counts if every file in it can be downloaded. */
static const char *check_code(const char *text) {
	static int n;
	return parse_list(text, items, &n);
}

static void scan_status(const char *s) {
	ui_fill(0, 70, 320, 60, UI_BG);
	line_text(80, s, UI_ACCENT);
	line_text(100, "Show the code of a .neo3ds file.", UI_DIM);
	ui_flush();
}

/* The address, from a QR code. False when the player left. */
static bool get_url(char *url, size_t size) {
#ifdef NEO3DS_RECV_TEST
	/* Azahar test: the address can come from a file instead */
	FILE *f = fopen(SD_DATA_DIR "/recv_url.txt", "r");
	if (f) { /* the last line end is not part of it */
		size_t n = fread(url, 1, size - 1, f);
		fclose(f);
		if (n && url[n - 1] == '\n') n--;
		url[n] = 0;
		return n > 0;
	}
#endif
	draw_frame(NULL, "B: back to the list");
	line_text(40, "Point the outer camera at the QR code", UI_TEXT);
	line_text(52, "the converter shows on the PC.", UI_DIM);
	ui_flush();
	const QrResult r = qr_scan(url, size, check_code, scan_status);
	if (r == QR_NO_CAMERA) {
		set_reason("The camera could not be started.");
		log_attempt("-", "failed", 0);
		show_message(NULL, "Can't receive.", reason, "");
	}
	return r == QR_FOUND;
}

void receive_recover(void) {
	char (*found)[NAME_MAX_BYTES + 16] = malloc(RECOVER_MAX * sizeof *found);
	if (!found) return;
	/* Lists a batch at a time: the folder is not changed while it is being read. A failure ends it
	 * (the file would be listed again and again) and is logged; the next start tries once more. */
	bool failed = false;
	int n;
	do {
		n = 0;
		DIR *d = opendir(LAUNCHER_GAMES_DIR);
		if (d) {
			struct dirent *e;
			while (n < RECOVER_MAX && (e = readdir(d))) {
				const size_t len = strlen(e->d_name);
				if (len >= sizeof found[0]) continue;
				if (sd_has_suffix(e->d_name, PACK_SUFFIX PART_SUFFIX) || sd_has_suffix(e->d_name, PACK_SUFFIX BAK_SUFFIX))
					strcpy(found[n++], e->d_name);
			}
			closedir(d);
		}
		for (int i = 0; i < n; i++) {
			char path[PATH_BYTES + 32], final[PATH_BYTES + 32];
			snprintf(path, sizeof path, LAUNCHER_GAMES_DIR "/%s", found[i]);
			const size_t len = strlen(path);
			int result;
			if (sd_has_suffix(path, PART_SUFFIX)) { /* never a whole, checked file */
				result = remove(path);
			} else {
				/* .bak: the old game. With a game of that name, the new one had taken its
				 * place; without, the old one goes back. */
				struct stat st;
				snprintf(final, sizeof final, "%.*s", (int)(len - strlen(BAK_SUFFIX)), path);
				result = stat(final, &st) == 0 ? remove(path) : rename(path, final);
			}
			if (result) {
				failed = true;
				http_status = 0;
				set_reason("Can't clear this leftover file.");
				log_attempt(found[i], "failed", 0);
			}
		}
	} while (n == RECOVER_MAX && !failed);
	free(found);
}

/* The top screen with one row a file: its size before the start, what became of it after. */
static void draw_items(const char *title, bool results) {
	static const char *const states[] = {"-", "saved", "skipped", "failed"};
	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	ui_top_clear(fb);
	ui_top_center(fb, 30, title, UI_TEXT, 2);
	for (int i = 0; i < item_count; i++) {
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

/* Sizes and name clashes of all the files, and the player's word when there is something to say.
 * False to stop, with a reason unless the player left. */
static bool prepare(void) {
	u64 total = 0;
	bool ask = item_count > 1;
	draw_top(item_count == 1 ? items[0].t.name : "");
	draw_frame(item_count == 1 ? items[0].t.name : NULL, "B: cancel");
	for (int i = 0; i < item_count; i++) {
		char s[48];
		snprintf(s, sizeof s, "Asking the PC about file %d of %d...", i + 1, item_count);
		draw_status(s);
		int sock = -1, extra = 0;
		if (net_request(&items[i].t, "HEAD", &sock, &items[i].length, &extra) != DL_OK) return false;
		close(sock);
		total += items[i].length;
		char final[PATH_BYTES];
		struct stat st;
		snprintf(final, sizeof final, LAUNCHER_GAMES_DIR "/%s", items[i].t.name);
		items[i].replacing = stat(final, &st) == 0;
		ask = ask || items[i].replacing;
		items[i].state = ITEM_WAITING;
	}
	if (!space_ok(total, item_count)) return false;
	if (!ask) return true;

	/* Always asked when a game would be replaced, whatever the size: the same game with another
	 * setting differs by a byte. */
	char title[32], s[48];
	snprintf(title, sizeof title, item_count == 1 ? "Replace this game?" : "Receive %d games?", item_count);
	draw_items(title, false);
	draw_frame(item_count == 1 ? items[0].t.name : NULL, "A: start   B: cancel");
	u64 available = 0, cluster = 0;
	free_space(&available, &cluster);
	snprintf(s, sizeof s, "%.1f MB in all, %.1f MB free", total / (1024.0 * 1024.0), available / (1024.0 * 1024.0));
	line_text(80, s, UI_TEXT);
	if (item_count == 1) line_text(100, "This game is already on the SD card.", UI_DIM);
	ui_flush();
	return wait_answer(true);
}

/* The files in turn. Returns how many were saved; *stop holds why the rest were not tried. */
static int fetch_all(DlResult *stop, u64 *bytes) {
	static char part[PATH_BYTES + 8], final[PATH_BYTES];
	int saved = 0;
	*stop = DL_OK;
	/* No sleeping through a transfer: it would end it. */
	const bool sleep_allowed = aptIsSleepAllowed();
	aptSetSleepAllowed(false);
	for (int i = 0; i < item_count; i++) {
		Item *it = &items[i];
		snprintf(final, sizeof final, LAUNCHER_GAMES_DIR "/%s", it->t.name);
		snprintf(part, sizeof part, "%s" PART_SUFFIX, final);
		draw_top(it->t.name);
		draw_frame(it->t.name, "B: cancel");
		if (item_count > 1) {
			char s[32];
			snprintf(s, sizeof s, "File %d of %d", i + 1, item_count);
			line_text(52, s, UI_DIM);
		}
		u64 got = 0;
		reason[0] = 0;
		DlResult r = fetch(it, part, &got);
		if (r == DL_OK && !install(part, final)) r = DL_FAILED;
		*bytes += got;
		if (r == DL_OK) {
			it->state = ITEM_SAVED;
			saved++;
			reason[0] = 0;
			log_attempt(it->t.name, "saved", got);
			continue;
		}
		remove(part);
		if (r == DL_BAD_FILE) { /* the others may be good */
			it->state = ITEM_SKIPPED;
			log_attempt(it->t.name, "skipped", got);
			continue;
		}
		*stop = r;
		if (r == DL_CANCELLED) {
			set_reason(interrupted ? HOME_OPENED : "cancelled");
			log_attempt(it->t.name, interrupted ? "interrupted" : "cancelled", got);
		} else {
			it->state = ITEM_FAILED;
			log_attempt(it->t.name, "failed", got);
		}
		break;
	}
	aptSetSleepAllowed(sleep_allowed);
	return saved;
}

static bool receive_once(void) {
	static char url[1024];
	reason[0] = 0;
	http_status = 0;
	if (!get_url(url, sizeof url)) return false;
	const char *bad = parse_list(url, items, &item_count);
	if (bad) {
		set_reason(bad);
		log_attempt("-", "refused", 0);
		show_message(NULL, "Can't receive this.", bad, "");
		return false;
	}
	const char *only = item_count == 1 ? items[0].t.name : NULL;
	reason[0] = 0;
	if (!net_open()) {
		log_attempt(only ? only : "-", "failed", 0);
		show_message(only, NOT_SAVED, reason, only ? only : "");
		return false;
	}
	if (!prepare()) {
		net_close();
		if (reason[0]) { /* otherwise the player left */
			log_attempt(only ? only : "-", "failed", 0);
			show_message(only, NOT_SAVED, reason, only ? only : "");
		}
		return false;
	}
	DlResult stop;
	u64 bytes = 0;
	const int saved = fetch_all(&stop, &bytes);
	net_close();

	if (item_count == 1) {
		if (saved) show_message(only, "Saved. It is in the list now.", "", only);
		else if (stop == DL_CANCELLED && interrupted)
			show_message(only, NOT_SAVED, HOME_OPENED " In the list, press Y to try again.", only);
		else if (stop != DL_CANCELLED) show_message(only, NOT_SAVED, reason, only);
		return saved > 0;
	}

	int skipped = 0;
	for (int i = 0; i < item_count; i++) skipped += items[i].state == ITEM_SKIPPED;
	char title[40], detail[144];
	const bool cancelled = stop == DL_CANCELLED && !interrupted;
	if (stop != DL_OK && !cancelled) snprintf(detail, sizeof detail, "Stopped: %s", reason);
	else if (cancelled) snprintf(detail, sizeof detail, "Cancelled.");
	else if (skipped) snprintf(detail, sizeof detail, "%d skipped: not neo3ds game files.", skipped);
	else detail[0] = 0;
	snprintf(reason, sizeof reason, "saved=%d skipped=%d of %d", saved, skipped, item_count);
	log_attempt("batch", "summary", bytes);
	snprintf(title, sizeof title, "Saved %d of %d games.", saved, item_count);
	draw_items("Received", true);
	show_message(NULL, title, detail, NULL);
	return saved > 0;
}

bool receive_run(void) {
	aptHookCookie cookie;
	interrupted = false;
	aptHook(&cookie, on_apt, NULL);
	const bool saved = receive_once();
	aptUnhook(&cookie);
	return saved;
}
