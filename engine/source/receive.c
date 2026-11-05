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
// This file is the order of things. The parts: receive_url.c (the address), receive_net.c (HTTP),
// receive_file.c (the SD card), receive_screen.c (drawing). recv_test.c holds the Azahar test's hooks.
#include <3ds.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "launcher.h"
#include "loader.h"
#include "qrscan.h"
#include "receive.h"
#include "receive_internal.h"
#include "recv_test.h"
#include "ui.h"

#define HOME_OPENED "The HOME menu opened during the transfer."
#define NOT_SAVED "The game was not saved."

static Item items[MAX_ITEMS];
static int item_count;

char recv_reason[96];
int recv_http_status;
volatile bool recv_interrupted;

bool receive_interrupted(void) { return recv_interrupted; }

/* HOME or sleep: the sockets don't survive them, and the transfer is given up on the way back. */
static void on_apt(APT_HookType type, void *param) {
	(void)param;
	if (type == APTHOOK_ONSUSPEND || type == APTHOOK_ONSLEEP) recv_interrupted = true;
}

void recv_set_reason(const char *text) { snprintf(recv_reason, sizeof recv_reason, "%s", text); }

bool recv_still_wanted(void) {
	if (!aptMainLoop() || recv_interrupted) return false;
	hidScanInput();
	return !(RECEIVE_KEYS_DOWN() & KEY_B);
}

/* One file, from the question to a checked .part file. */
static DlResult fetch(const Item *item, const char *part, u64 *got) {
	int sock = -1, extra = 0;
	u64 length = 0;
	FILE *out = NULL;
	*got = 0;
	recv_draw_status("Connecting to the PC...");
	DlResult result = recv_net_request(&item->t, "GET", &sock, &length, &extra);
	if (result != DL_OK) goto done;
	result = DL_FAILED;
	if (length != item->length) {
		recv_set_reason("The file changed on the PC. Scan the code again.");
		goto done;
	}
	if (!recv_space_ok(length, 1)) goto done;
	if (!recv_make_game_folders()) goto done;
	if (!(out = fopen(part, "wb"))) {
		recv_set_reason("Can't create the file on the SD card.");
		goto done;
	}
	setvbuf(out, NULL, _IONBF, 0); /* whole chunks, no copy */
	result = recv_read_body(sock, out, extra, length, got);
	if (result == DL_OK) {
		const int closed = fclose(out);
		out = NULL;
		if (closed) {
			recv_set_reason("Can't finish the file on the SD card.");
			result = DL_FAILED;
		} else {
			recv_draw_status("Checking the file...");
			const char *wrong = loader_check_pack(part, length);
			if (wrong) {
				recv_set_reason(wrong);
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

/* For the scanner: a code only counts if every file in it can be downloaded. */
static const char *check_code(const char *text) {
	static int n;
	return recv_parse_list(text, items, &n);
}

/* The address, from a QR code. False when the player left. */
static bool get_url(char *url, size_t size) {
	if (recv_test_url(url, size)) return url[0] != 0;
	recv_draw_frame(NULL, "B: back to the list");
	recv_line(40, "Point the outer camera at the QR code", UI_TEXT);
	recv_line(52, "the converter shows on the PC.", UI_DIM);
	ui_flush();
	const QrResult r = qr_scan(url, size, check_code, recv_scan_status);
	if (r == QR_NO_CAMERA) {
		recv_set_reason("The camera could not be started.");
		recv_log("-", "failed", 0);
		recv_show_message(NULL, "Can't receive.", recv_reason, "");
	}
	return r == QR_FOUND;
}

/* Sizes and name clashes of all the files, and the player's word when there is something to say.
 * False to stop, with a reason unless the player left. */
static bool prepare(void) {
	u64 total = 0;
	bool ask = item_count > 1;
	recv_draw_top(item_count == 1 ? items[0].t.name : "");
	recv_draw_frame(item_count == 1 ? items[0].t.name : NULL, "B: cancel");
	for (int i = 0; i < item_count; i++) {
		char s[48];
		snprintf(s, sizeof s, "Asking the PC about file %d of %d...", i + 1, item_count);
		recv_draw_status(s);
		int sock = -1, extra = 0;
		if (recv_net_request(&items[i].t, "HEAD", &sock, &items[i].length, &extra) != DL_OK) return false;
		close(sock);
		total += items[i].length;
		char final[PATH_BYTES];
		struct stat st;
		snprintf(final, sizeof final, LAUNCHER_GAMES_DIR "/%s", items[i].t.name);
		items[i].replacing = stat(final, &st) == 0;
		ask = ask || items[i].replacing;
		items[i].state = ITEM_WAITING;
	}
	if (!recv_space_ok(total, item_count)) return false;
	if (!ask) return true;

	/* Always asked when a game would be replaced, whatever the size: the same game with another
	 * setting differs by a byte. */
	char title[32], s[48];
	snprintf(title, sizeof title, item_count == 1 ? "Replace this game?" : "Receive %d games?", item_count);
	recv_draw_items(items, item_count, title, false);
	recv_draw_frame(item_count == 1 ? items[0].t.name : NULL, "A: start   B: cancel");
	u64 available = 0, cluster = 0;
	recv_free_space(&available, &cluster);
	snprintf(s, sizeof s, "%.1f MB in all, %.1f MB free", total / (1024.0 * 1024.0), available / (1024.0 * 1024.0));
	recv_line(80, s, UI_TEXT);
	if (item_count == 1) recv_line(100, "This game is already on the SD card.", UI_DIM);
	ui_flush();
	return recv_wait_answer(true);
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
		recv_draw_top(it->t.name);
		recv_draw_frame(it->t.name, "B: cancel");
		if (item_count > 1) {
			char s[32];
			snprintf(s, sizeof s, "File %d of %d", i + 1, item_count);
			recv_line(52, s, UI_DIM);
		}
		u64 got = 0;
		recv_reason[0] = 0;
		DlResult r = fetch(it, part, &got);
		if (r == DL_OK && !recv_install(part, final)) r = DL_FAILED;
		*bytes += got;
		if (r == DL_OK) {
			it->state = ITEM_SAVED;
			saved++;
			recv_reason[0] = 0;
			recv_log(it->t.name, "saved", got);
			continue;
		}
		remove(part);
		if (r == DL_BAD_FILE) { /* the others may be good */
			it->state = ITEM_SKIPPED;
			recv_log(it->t.name, "skipped", got);
			continue;
		}
		*stop = r;
		if (r == DL_CANCELLED) {
			recv_set_reason(recv_interrupted ? HOME_OPENED : "cancelled");
			recv_log(it->t.name, recv_interrupted ? "interrupted" : "cancelled", got);
		} else {
			it->state = ITEM_FAILED;
			recv_log(it->t.name, "failed", got);
		}
		break;
	}
	aptSetSleepAllowed(sleep_allowed);
	return saved;
}

static bool receive_once(void) {
	static char url[1024];
	recv_reason[0] = 0;
	recv_http_status = 0;
	if (!get_url(url, sizeof url)) return false;
	const char *bad = recv_parse_list(url, items, &item_count);
	if (bad) {
		recv_set_reason(bad);
		recv_log("-", "refused", 0);
		recv_show_message(NULL, "Can't receive this.", bad, "");
		return false;
	}
	const char *only = item_count == 1 ? items[0].t.name : NULL;
	recv_reason[0] = 0;
	if (!recv_net_open()) {
		recv_log(only ? only : "-", "failed", 0);
		recv_show_message(only, NOT_SAVED, recv_reason, only ? only : "");
		return false;
	}
	if (!prepare()) {
		recv_net_close();
		if (recv_reason[0]) { /* otherwise the player left */
			recv_log(only ? only : "-", "failed", 0);
			recv_show_message(only, NOT_SAVED, recv_reason, only ? only : "");
		}
		return false;
	}
	DlResult stop;
	u64 bytes = 0;
	const int saved = fetch_all(&stop, &bytes);
	recv_net_close();

	if (item_count == 1) {
		if (saved) recv_show_message(only, "Saved. It is in the list now.", "", only);
		else if (stop == DL_CANCELLED && recv_interrupted)
			recv_show_message(only, NOT_SAVED, HOME_OPENED " In the list, press Y to try again.", only);
		else if (stop != DL_CANCELLED) recv_show_message(only, NOT_SAVED, recv_reason, only);
		return saved > 0;
	}

	int skipped = 0;
	for (int i = 0; i < item_count; i++) skipped += items[i].state == ITEM_SKIPPED;
	char title[40], detail[144];
	const bool cancelled = stop == DL_CANCELLED && !recv_interrupted;
	if (stop != DL_OK && !cancelled) snprintf(detail, sizeof detail, "Stopped: %s", recv_reason);
	else if (cancelled) snprintf(detail, sizeof detail, "Cancelled.");
	else if (skipped) snprintf(detail, sizeof detail, "%d skipped: not neo3ds game files.", skipped);
	else detail[0] = 0;
	snprintf(recv_reason, sizeof recv_reason, "saved=%d skipped=%d of %d", saved, skipped, item_count);
	recv_log("batch", "summary", bytes);
	snprintf(title, sizeof title, "Saved %d of %d games.", saved, item_count);
	recv_draw_items(items, item_count, "Received", true);
	recv_show_message(NULL, title, detail, NULL);
	return saved > 0;
}

bool receive_run(void) {
	aptHookCookie cookie;
	recv_interrupted = false;
	aptHook(&cookie, on_apt, NULL);
	const bool saved = receive_once();
	aptUnhook(&cookie);
	return saved;
}
