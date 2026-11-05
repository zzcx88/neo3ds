// The address in the QR code: 1 to 6 lines, every one checked before anything is fetched.
#include <string.h>
#include <strings.h>

#include "receive_internal.h"
#include "sdfiles.h"

#define NOT_AN_ADDRESS "This QR code is not a PC address."

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
	const char last = s[sd_pack_base(s) - 1];
	if (last == ' ' || last == '.') return false;
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

const char *recv_parse_list(const char *text, Item *out, int *count) {
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
