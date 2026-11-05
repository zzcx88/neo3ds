// The launcher's receive screen: downloads a .neo3ds file from the PC (LanSender in the converter)
// into the game folder, so a game gets to the 3DS without taking the SD card out.
//
// The file is written as <name>.part, checked as a game file, and only then takes its final name:
// the list never shows half a file, and a failed download leaves the old game in place.
//
// The HTTP client is what LanSender needs and no more: GET, a 200 with one Content-Length, no
// chunks, redirects or compression. Sockets are non-blocking so B works at any moment.
#include <3ds.h>
#include <arpa/inet.h>
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
#include "receive.h"
#include "ui.h"

#define LOG_FILE "sdmc:/3ds/neo3ds/receive.log"

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
};

typedef struct {
	char host[16];
	u32 ip;   /* host byte order */
	u16 port;
	char path[256];                 /* as in the URL, %XX kept */
	char name[NAME_MAX_BYTES + 1];  /* the last path segment, decoded */
} Target;

typedef enum { DL_OK, DL_CANCELLED, DL_FAILED } DlResult;

static char reason[96];    /* why a download failed, for the screen and the log */
static int http_status;

static void set_reason(const char *fmt, const char *arg) { snprintf(reason, sizeof reason, fmt, arg); }

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
	if (n < 8 || n > NAME_MAX_BYTES || strcasecmp(s + n - 7, ".neo3ds")) return false;
	for (const char *c = s; *c; c++)
		if ((u8)*c < 32 || *c == 127 || strchr("/\\:*?\"<>|", *c)) return false;
	return true;
}

/* IPv4 numbers + port + path only. NULL when good, else what is wrong. */
static const char *parse_url(const char *url, Target *t) {
	static const char *const bad = "This QR code is not a PC address.";
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

	const char *seg = strrchr(p, '/') + 1;
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
	if (!name_ok(t->name)) return "This QR code is not for a .neo3ds game file.";

	t->ip = ip;
	t->port = port;
	snprintf(t->host, sizeof t->host, "%lu.%lu.%lu.%lu", (unsigned long)(ip >> 24), (unsigned long)(ip >> 16 & 255),
		(unsigned long)(ip >> 8 & 255), (unsigned long)(ip & 255));
	snprintf(t->path, sizeof t->path, "%s", p);
	return NULL;
}

/* ---- the screens ---- */

static void draw_top(const char *line) {
	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	for (int i = 0; i < 400 * 240; i++) fb[i] = UI_BG;
	ui_top_text(fb, (400 - 6 * 8 * 4) / 2, 70, "neo3ds", UI_HEADER, 4);
	ui_top_text(fb, (400 - 14 * 8 * 2) / 2, 140, "Receive a game", UI_TEXT, 2);
	ui_top_text(fb, (400 - (int)strlen(line) * 8) / 2, 170, line, UI_DIM, 1);
	gfxFlushBuffers();
}

/* One line, cut to the 38 characters that fit */
static void line_text(int y, const char *s, u16 color) {
	char t[40];
	snprintf(t, sizeof t, strlen(s) > 38 ? "%.35s..." : "%s", s);
	ui_text(8, y, t, color, 1);
}

static void draw_frame(const char *name, const char *foot) {
	ui_fill(0, 0, 320, 240, UI_BG);
	ui_fill(0, 0, 320, 26, UI_HEADER);
	ui_text(8, 5, "neo3ds", UI_TEXT, 2);
	ui_text(8 + ui_text_width("neo3ds", 2) + 8, 12, "receive", UI_TEXT, 1);
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
	if (!aptMainLoop()) return false;
	hidScanInput();
	return !(hidKeysDown() & KEY_B);
}

/* Waits for A (true) or B (false). */
static bool wait_answer(void) {
	while (aptMainLoop()) {
		hidScanInput();
		const u32 down = hidKeysDown();
		if (down & KEY_A) return true;
		if (down & KEY_B) return false;
		gspWaitForVBlank();
	}
	return false;
}

static void show_message(const char *name, const char *title, const char *detail, const char *top_line) {
	draw_top(top_line);
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
	wait_answer();
}

/* ---- the game file ---- */

/* Puts the checked file in place. An old file with the same name moves aside first, and back
 * if the new one can't take its name. */
static bool install(const char *part, const char *final) {
	char bak[PATH_BYTES + 8];
	struct stat st;
	const bool replacing = stat(final, &st) == 0;
	snprintf(bak, sizeof bak, "%s.bak", final);
	if (replacing) {
		remove(bak);
		if (rename(final, bak)) {
			set_reason("Can't move the old file on the SD card.%s", "");
			return false;
		}
	}
	if (rename(part, final)) {
		if (replacing) rename(bak, final);
		set_reason("Can't name the new file on the SD card.%s", "");
		return false;
	}
	if (replacing) remove(bak);
	return true;
}

/* ---- the download ---- */

static bool wait_socket(int sock, short events, int ms) {
	struct pollfd p = {.fd = sock, .events = events};
	return poll(&p, 1, ms) > 0;
}

/* Non-blocking connect, for at most CONNECT_MS. */
static DlResult net_connect(int sock, const Target *t) {
	struct sockaddr_in a;
	memset(&a, 0, sizeof a);
	a.sin_family = AF_INET;
	a.sin_port = htons(t->port);
	a.sin_addr.s_addr = htonl(t->ip);
	if (connect(sock, (struct sockaddr *)&a, sizeof a) == 0) return DL_OK;
	if (errno != EINPROGRESS && errno != EWOULDBLOCK && errno != EALREADY) {
		set_reason("Can't reach the PC. Is the Wi-Fi on?%s", "");
		return DL_FAILED;
	}
	const u64 end = osGetTime() + CONNECT_MS;
	while (osGetTime() < end) {
		if (!still_wanted()) return DL_CANCELLED;
		if (!wait_socket(sock, POLLOUT, 16)) continue;
		int error = 0;
		socklen_t n = sizeof error;
		if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &error, &n) == 0 && error == 0) return DL_OK;
		break;
	}
	set_reason("Can't reach the PC: same Wi-Fi? Firewall?%s", "");
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
	set_reason("The PC stopped answering.%s", "");
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
	set_reason("The PC sent no usable answer.%s", "");
	return DL_FAILED;
}

/* The status line and the headers that matter. True for a 200 this client can read. */
static bool parse_head(char *head, u64 *length) {
	if (strncmp(head, "HTTP/1.0 ", 9) && strncmp(head, "HTTP/1.1 ", 9)) {
		set_reason("The PC sent no usable answer.%s", "");
		return false;
	}
	http_status = atoi(head + 9);
	if (http_status != 200) {
		if (http_status == 404) set_reason("The PC no longer offers this file.%s", "");
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
				set_reason("The PC sent the file in a form this can't read.%s", "");
				return false;
			}
		}
		*end = '\r';
		line = end;
	}
	if (lengths != 1) {
		set_reason("The PC did not say the file's size.%s", "");
		return false;
	}
	return true;
}

static bool space_ok(u64 length) {
	struct statvfs v;
	if (statvfs("sdmc:/", &v)) {
		set_reason("Can't read the SD card's free space.%s", "");
		return false;
	}
	const u64 cluster = v.f_bsize ? v.f_bsize : 1;
	const u64 needed = (length + cluster - 1) / cluster * cluster + cluster; /* + the folder entry */
	u64 available = (u64)v.f_bavail * cluster;
#ifdef NEO3DS_RECV_TEST
	/* Azahar always reports a large free space: the file holds the MB to pretend */
	FILE *f = fopen("sdmc:/3ds/neo3ds/recv_free.txt", "r");
	if (f) {
		char s[16] = "";
		if (fgets(s, sizeof s, f)) available = (u64)atoi(s) << 20;
		fclose(f);
	}
#endif
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
					if (fwrite(buf, 1, fill, out) != (size_t)fill) {
						*got_out = got;
						set_reason("Can't write to the SD card.%s", "");
						return DL_FAILED;
					}
					fill = 0;
				}
			} else if (r == 0 || (errno != EWOULDBLOCK && errno != EAGAIN)) {
				*got_out = got;
				set_reason("The connection ended before the whole file came.%s", "");
				return DL_FAILED;
			} else {
				wait_socket(sock, POLLIN, 4);
			}
		} while (got < length && osGetTime() < batch_end);

		const u64 now = osGetTime();
		if (now - last_data > IDLE_MS) {
			*got_out = got;
			set_reason("The PC stopped sending: Wi-Fi lost?%s", "");
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
		set_reason("Can't write to the SD card.%s", "");
		return DL_FAILED;
	}
	*got_out = got;
	draw_progress(got, length, speed);
	return DL_OK;
}

/* Connection to .part file. The socket service is up only for this. */
static DlResult download(const Target *t, const char *part, u64 *got) {
	DlResult result = DL_FAILED;
	int sock = -1;
	FILE *out = NULL;
	char *buf = malloc(CHUNK > HEAD_MAX ? CHUNK : HEAD_MAX);
	u32 *soc = memalign(0x1000, SOC_BYTES);
	bool soc_up = false;
	*got = 0;
	if (!buf || !soc) {
		set_reason("Out of memory.%s", "");
		goto done;
	}
	if (R_FAILED(socInit(soc, SOC_BYTES))) {
		set_reason("Can't start the network.%s", "");
		goto done;
	}
	soc_up = true;
	if ((sock = socket(AF_INET, SOCK_STREAM, 0)) < 0) {
		set_reason("Can't start the network.%s", "");
		goto done;
	}
	const int size = SOCK_BUFFER;
	setsockopt(sock, SOL_SOCKET, SO_RCVBUF, &size, sizeof size);
	fcntl(sock, F_SETFL, fcntl(sock, F_GETFL, 0) | O_NONBLOCK);

	draw_status("Connecting to the PC...");
	if ((result = net_connect(sock, t)) != DL_OK) goto done;

	char request[sizeof t->path + 128];
	const int n = snprintf(request, sizeof request,
		"GET %s HTTP/1.1\r\nHost: %s:%u\r\nUser-Agent: neo3ds\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
		t->path, t->host, t->port);
	if ((result = net_send(sock, request, n)) != DL_OK) goto done;

	int head_end = 0, extra = 0;
	if ((result = read_head(sock, buf, &head_end, &extra)) != DL_OK) goto done;
	u64 length = 0;
	result = DL_FAILED;
	char saved = buf[head_end]; /* parse_head reads only up to the blank line */
	buf[head_end] = 0;
	if (!parse_head(buf, &length)) goto done;
	buf[head_end] = saved;
	if (!length || (u64)extra > length) {
		set_reason("The PC sent no usable answer.%s", "");
		goto done;
	}
	if (!space_ok(length)) goto done;

	mkdir("sdmc:/neo3ds", 0777);
	mkdir(LAUNCHER_GAMES_DIR, 0777);
	if (!(out = fopen(part, "wb"))) {
		set_reason("Can't create the file on the SD card.%s", "");
		goto done;
	}
	setvbuf(out, NULL, _IONBF, 0); /* whole chunks, no copy */
	memmove(buf, buf + head_end, extra);
	result = read_body(sock, out, buf, extra, length, got);
	if (result == DL_OK) {
		const int closed = fclose(out);
		out = NULL;
		if (closed) {
			set_reason("Can't finish the file on the SD card.%s", "");
			result = DL_FAILED;
		} else {
			draw_status("Checking the file...");
			const char *wrong = loader_check_pack(part, length);
			if (wrong) {
				set_reason("%s", wrong);
				result = DL_FAILED;
			}
		}
	}
done:
	if (out) fclose(out);
	if (sock >= 0) close(sock);
	if (soc_up) socExit();
	free(soc);
	free(buf);
	if (result != DL_OK) remove(part);
	return result;
}

/* One line per attempt. The address is not written: its path holds the sender's token. */
static void log_attempt(const char *name, const char *what, u64 bytes) {
	mkdir("sdmc:/3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds", 0777);
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

#ifdef NEO3DS_RECV_TEST
/* Azahar test: the address comes from a file instead of a QR code. */
static bool get_url(char *url, size_t size) {
	FILE *f = fopen("sdmc:/3ds/neo3ds/recv_url.txt", "r");
	if (!f) return false;
	const bool ok = fgets(url, size, f) != NULL;
	fclose(f);
	if (ok) url[strcspn(url, "\r\n")] = 0;
	return ok;
}
#else
static bool get_url(char *url, size_t size) {
	(void)url;
	(void)size;
	return false;
}
#endif

bool receive_run(void) {
	static Target t;
	char url[512], part[PATH_BYTES + 8], final[PATH_BYTES];
	reason[0] = 0;
	http_status = 0;
	if (!get_url(url, sizeof url)) {
		show_message(NULL, "No address to receive from.", "", "");
		return false;
	}
	const char *bad = parse_url(url, &t);
	if (bad) {
		set_reason("%s", bad);
		log_attempt("-", "refused", 0);
		show_message(NULL, "Can't receive this.", bad, "");
		return false;
	}
	snprintf(final, sizeof final, LAUNCHER_GAMES_DIR "/%s", t.name);
	snprintf(part, sizeof part, "%s.part", final);

	/* Always asked, whatever the size: the same game with another setting differs by a byte. */
	struct stat st;
	if (stat(final, &st) == 0) {
		draw_top(t.name);
		draw_frame(t.name, "A: replace it   B: keep the old one");
		line_text(80, "This game is already on the SD card.", UI_TEXT);
		line_text(100, "Replace it with the one from the PC?", UI_DIM);
		ui_flush();
		if (!wait_answer()) return false;
	}

	draw_top(t.name);
	draw_frame(t.name, "B: cancel");
	u64 got = 0;
	const DlResult r = download(&t, part, &got);
	if (r == DL_CANCELLED) {
		set_reason("%s", "cancelled");
		log_attempt(t.name, "cancelled", got);
		return false;
	}
	if (r == DL_OK && install(part, final)) {
		reason[0] = 0;
		log_attempt(t.name, "saved", got);
		show_message(t.name, "Saved. It is in the list now.", "", t.name);
		return true;
	}
	remove(part);
	log_attempt(t.name, "failed", got);
	show_message(t.name, "The game was not saved.", reason, t.name);
	return false;
}
