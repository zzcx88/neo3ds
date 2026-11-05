// The receive screen's HTTP client: what LanSender in the converter needs and no more. GET, a 200 with
// one Content-Length, no chunks, redirects or compression. Sockets are non-blocking so B works at any
// moment.
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <unistd.h>

#include "receive_internal.h"
#include "recv_test.h"

enum {
	SOC_BYTES = 0x100000,   /* page aligned, on the normal heap: returned before a game loads */
	SOCK_BUFFER = 0x8000,
	CHUNK = 0x10000,        /* written to the SD card a chunk at a time */
	HEAD_MAX = 4096,
	CONNECT_MS = 10000,
	IDLE_MS = 15000,        /* no data for this long: the PC or the Wi-Fi is gone */
	BATCH_MS = 8,           /* socket work between looks at the buttons */
	DRAW_MS = 250,
};

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
	if (wifi) snprintf(recv_reason, sizeof recv_reason, "%s (error %lX)", what, code);
	else snprintf(recv_reason, sizeof recv_reason, "Not connected to Wi-Fi: turn it on and try again. (error %lX)", code);
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
		if (!recv_still_wanted()) return DL_CANCELLED;
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
		if (!recv_still_wanted()) return DL_CANCELLED;
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
	recv_set_reason("The PC stopped answering.");
	return DL_FAILED;
}

/* Reads up to the end of the headers. Body bytes that came with them stay in buf, *got of them
 * after *head_end. */
static DlResult read_head(int sock, char *buf, int *head_end, int *got) {
	int n = 0;
	u64 last = osGetTime();
	for (;;) {
		if (!recv_still_wanted()) return DL_CANCELLED;
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
	recv_set_reason("The PC sent no usable answer.");
	return DL_FAILED;
}

/* The status line and the headers that matter. True for a 200 this client can read. */
static bool parse_head(char *head, u64 *length) {
	if (strncmp(head, "HTTP/1.0 ", 9) && strncmp(head, "HTTP/1.1 ", 9)) {
		recv_set_reason("The PC sent no usable answer.");
		return false;
	}
	recv_http_status = atoi(head + 9);
	if (recv_http_status != 200) {
		if (recv_http_status == 404) recv_set_reason("The PC no longer offers this file.");
		else snprintf(recv_reason, sizeof recv_reason, "The PC answered with error %d.", recv_http_status);
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
				recv_set_reason("The PC sent the file in a form this can't read.");
				return false;
			}
		}
		*end = '\r';
		line = end;
	}
	if (lengths != 1) {
		recv_set_reason("The PC did not say the file's size.");
		return false;
	}
	return true;
}

/* The socket service and the buffer, up from the first question to the last file. */
static char *net_buf;
static u32 *net_soc;
static bool net_up;

void recv_net_close(void) {
	if (net_up) socExit();
	net_up = false;
	free(net_soc);
	free(net_buf);
	net_soc = NULL;
	net_buf = NULL;
}

bool recv_net_open(void) {
	net_buf = malloc(CHUNK > HEAD_MAX ? CHUNK : HEAD_MAX);
	net_soc = memalign(0x1000, SOC_BYTES);
	if (!net_buf || !net_soc) {
		recv_set_reason("Out of memory.");
		recv_net_close();
		return false;
	}
	const Result r = socInit(net_soc, SOC_BYTES);
	if (R_FAILED(r)) {
		network_failed("Can't start the network.", (unsigned long)r);
		recv_net_close();
		return false;
	}
	net_up = true;
	return true;
}

/* The body bytes that came with the headers end up at the start of net_buf. */
DlResult recv_net_request(const Target *t, const char *method, int *sock, u64 *length, int *extra) {
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
		recv_set_reason("The PC sent no usable answer.");
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

static bool write_chunk(FILE *out, const char *buf, int n) {
	return !recv_test_write_fails() && fwrite(buf, 1, n, out) == (size_t)n;
}

/* Reads for BATCH_MS: a chunk goes to the SD card when it is full and at the end of the file. */
static DlResult read_batch(int sock, FILE *out, char *buf, int *fill, u64 length, u64 *got, u64 *last_data) {
	const u64 batch_end = osGetTime() + BATCH_MS;
	do {
		const u64 left = length - *got;
		const size_t room = CHUNK - *fill;
		const ssize_t r = recv(sock, buf + *fill, left < room ? left : room, 0);
		if (r > 0) {
			*fill += r;
			*got += r;
			*last_data = osGetTime();
			if (*fill == CHUNK || *got == length) {
				if (!write_chunk(out, buf, *fill)) {
					recv_set_reason("Can't write to the SD card.");
					return DL_FAILED;
				}
				*fill = 0;
			}
		} else if (r == 0 || (errno != EWOULDBLOCK && errno != EAGAIN)) {
			recv_set_reason("The connection ended before the whole file came.");
			return DL_FAILED;
		} else {
			wait_socket(sock, POLLIN, 4);
		}
	} while (*got < length && osGetTime() < batch_end);
	return DL_OK;
}

DlResult recv_read_body(int sock, FILE *out, int extra, u64 length, u64 *got) {
	char *const buf = net_buf;
	int fill = extra;
	*got = fill;
	u64 draw_t = 0, speed_t = osGetTime(), speed_got = *got, last_data = speed_t;
	u32 speed = 0;
	while (*got < length) {
		if (!recv_still_wanted()) return DL_CANCELLED;
		const DlResult result = read_batch(sock, out, buf, &fill, length, got, &last_data);
		if (result != DL_OK) return result;

		const u64 now = osGetTime();
		if (now - last_data > IDLE_MS) {
			recv_set_reason("The PC stopped sending: Wi-Fi lost?");
			return DL_FAILED;
		}
		if (now - speed_t >= 1000) {
			speed = (u32)((*got - speed_got) * 1000 / (now - speed_t));
			speed_t = now;
			speed_got = *got;
		}
		if (now - draw_t >= DRAW_MS) {
			draw_t = now;
			recv_draw_progress(*got, length, speed);
		}
	}
	/* a body shorter than one chunk came whole with the headers */
	if (fill && !write_chunk(out, buf, fill)) {
		recv_set_reason("Can't write to the SD card.");
		return DL_FAILED;
	}
	recv_draw_progress(*got, length, speed);
	return DL_OK;
}
