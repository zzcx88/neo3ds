// The receive screen's camera (see qrscan.h). The camera delivers QVGA YUV422, packed Y U Y V: every
// second byte is the grey image, which is both the preview and what quirc reads. Decoding takes much
// longer than a frame, so it runs a few times a second and the preview keeps moving in between.
//
// A thread of its own keeps the transfers going: a camera whose next transfer is armed late is
// partway down its picture by then, and on the console the image rolls vertically. The main thread
// draws and decodes copies, however long that takes.
#include <3ds.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "qrscan.h"
#include "quirc.h"
#include "receive.h"
#include "ui.h"

enum {
	W = 320,
	H = 240,
	FRAME_BYTES = W * H * 2,
	TOP_X = (400 - W) / 2,   /* the preview's place on the 400x240 top screen */
	GUIDE = 180,             /* the guide box, W x H centered */
	GUIDE_ARM = 24,
	DECODE_EVERY_MS = 200,
	NO_FRAME_MS = 5000,      /* no picture for this long: the camera is not working */
};

typedef struct {
	u8 *receiving, *ready;      /* the transfer's buffer and the newest whole frame: swapped */
	u32 unit;
	u32 frames;                 /* counts the frames put in ready */
	LightLock lock;
	Handle cancel, error;
	volatile bool failed;
} Capture;

static bool cam_start(u32 *unit, Handle *error_event) {
	if (R_FAILED(camInit())) return false;
	const u32 cam = SELECT_OUT1;
	bool ok = R_SUCCEEDED(CAMU_SetSize(cam, SIZE_QVGA, CONTEXT_A)) &&
	          R_SUCCEEDED(CAMU_SetOutputFormat(cam, OUTPUT_YUV_422, CONTEXT_A)) &&
	          R_SUCCEEDED(CAMU_SetFrameRate(cam, FRAME_RATE_30)) &&
	          R_SUCCEEDED(CAMU_SetNoiseFilter(cam, true)) &&
	          R_SUCCEEDED(CAMU_SetAutoExposure(cam, true)) &&
	          R_SUCCEEDED(CAMU_SetAutoWhiteBalance(cam, true)) &&
	          R_SUCCEEDED(CAMU_SetTrimming(PORT_CAM1, false)) &&
	          R_SUCCEEDED(CAMU_GetMaxBytes(unit, W, H)) &&
	          R_SUCCEEDED(CAMU_SetTransferBytes(PORT_CAM1, *unit, W, H)) &&
	          R_SUCCEEDED(CAMU_Activate(cam)) &&
	          R_SUCCEEDED(CAMU_GetBufferErrorInterruptEvent(error_event, PORT_CAM1)) &&
	          R_SUCCEEDED(CAMU_ClearBuffer(PORT_CAM1));
	if (!ok) {
		CAMU_Activate(SELECT_NONE);
		camExit();
	}
	return ok;
}

static void cam_stop(void) {
	CAMU_StopCapture(PORT_CAM1);
	CAMU_ClearBuffer(PORT_CAM1);
	CAMU_Activate(SELECT_NONE);
	camExit();
}

static void capture_thread(void *arg) {
	Capture *c = arg;
	enum { EV_CANCEL, EV_FRAME, EV_ERROR };
	Handle events[3] = {c->cancel, 0, c->error};
	if (R_FAILED(CAMU_StartCapture(PORT_CAM1)) ||
	    R_FAILED(CAMU_SetReceiving(&events[EV_FRAME], c->receiving, PORT_CAM1, FRAME_BYTES, (s16)c->unit))) {
		c->failed = true;
		return;
	}
	for (;;) {
		s32 which = -1;
		if (R_FAILED(svcWaitSynchronizationN(&which, events, 3, false, U64_MAX)) || which == EV_CANCEL) break;
		svcCloseHandle(events[EV_FRAME]);
		events[EV_FRAME] = 0;
		if (which == EV_FRAME) {
			svcInvalidateProcessDataCache(CUR_PROCESS_HANDLE, (u32)c->receiving, FRAME_BYTES);
			LightLock_Lock(&c->lock);
			u8 *t = c->ready;
			c->ready = c->receiving;
			c->receiving = t;
			c->frames++;
			LightLock_Unlock(&c->lock);
		} else { /* the camera's buffer overflowed */
			svcClearEvent(c->error);
			CAMU_ClearBuffer(PORT_CAM1);
			CAMU_StartCapture(PORT_CAM1);
		}
		if (R_FAILED(CAMU_SetReceiving(&events[EV_FRAME], c->receiving, PORT_CAM1, FRAME_BYTES, (s16)c->unit))) {
			events[EV_FRAME] = 0;
			c->failed = true;
			break;
		}
	}
	if (events[EV_FRAME]) svcCloseHandle(events[EV_FRAME]);
}

static void draw_preview(u16 *fb, const u8 *frame) {
	for (int x = 0; x < W; x++) {
		u16 *col = fb + (TOP_X + x) * 240;
		const u8 *p = frame + x * 2;
		for (int y = 0; y < H; y++, p += W * 2) {
			const u8 v = *p;
			col[239 - y] = (v >> 3) << 11 | (v >> 2) << 5 | v >> 3;
		}
	}
	/* The guide box: its four corners */
	const int x0 = TOP_X + (W - GUIDE) / 2, x1 = x0 + GUIDE - 1, y0 = (H - GUIDE) / 2, y1 = y0 + GUIDE - 1;
	for (int i = 0; i < GUIDE_ARM; i++)
		for (int t = 0; t < 2; t++) {
			fb[(x0 + i) * 240 + 239 - (y0 + t)] = UI_ACCENT;
			fb[(x1 - i) * 240 + 239 - (y0 + t)] = UI_ACCENT;
			fb[(x0 + i) * 240 + 239 - (y1 - t)] = UI_ACCENT;
			fb[(x1 - i) * 240 + 239 - (y1 - t)] = UI_ACCENT;
			fb[(x0 + t) * 240 + 239 - (y0 + i)] = UI_ACCENT;
			fb[(x1 - t) * 240 + 239 - (y0 + i)] = UI_ACCENT;
			fb[(x0 + t) * 240 + 239 - (y1 - i)] = UI_ACCENT;
			fb[(x1 - t) * 240 + 239 - (y1 - i)] = UI_ACCENT;
		}
	gfxFlushBuffers();
}

#ifdef NEO3DS_RECV_TEST
static int test_codes, test_error; /* the last decode, for the test screen */
#endif

/* Looks for codes in the frame. Of those check accepts, the one nearest the middle goes to out. */
static bool decode_frame(struct quirc *q, const u8 *frame, char *out, size_t size, QrCheck check, const char **wrong) {
	static struct quirc_code code;
	static struct quirc_data data;
	u8 *image = quirc_begin(q, NULL, NULL);
	for (int i = 0; i < W * H; i++) image[i] = frame[i * 2];
	quirc_end(q);

	long best = -1;
#ifdef NEO3DS_RECV_TEST
	test_codes = quirc_count(q);
	test_error = 0;
#endif
	for (int i = 0; i < quirc_count(q); i++) {
		quirc_extract(q, i, &code);
		const quirc_decode_error_t error = quirc_decode(&code, &data);
#ifdef NEO3DS_RECV_TEST
		test_error = error;
#endif
		if (error != QUIRC_SUCCESS) continue;
		data.payload[data.payload_len < QUIRC_MAX_PAYLOAD ? data.payload_len : QUIRC_MAX_PAYLOAD - 1] = 0;
		const char *why = check((const char *)data.payload);
		if (why) {
			*wrong = why;
			continue;
		}
		if ((size_t)data.payload_len >= size) continue;
		long cx = 0, cy = 0;
		for (int c = 0; c < 4; c++) {
			cx += code.corners[c].x;
			cy += code.corners[c].y;
		}
		cx = cx / 4 - W / 2;
		cy = cy / 4 - H / 2;
		const long distance = cx * cx + cy * cy;
		if (best < 0 || distance < best) {
			best = distance;
			strcpy(out, (const char *)data.payload);
		}
	}
	return best >= 0;
}

QrResult qr_scan(char *out, size_t size, QrCheck check, void (*status)(const char *)) {
	QrResult result = QR_NO_CAMERA;
	static Capture c;
	memset(&c, 0, sizeof c);
	LightLock_Init(&c.lock);
	c.receiving = linearAlloc(FRAME_BYTES);
	c.ready = linearAlloc(FRAME_BYTES);
	u8 *frame = malloc(FRAME_BYTES); /* the main thread's copy */
	struct quirc *q = quirc_new();
	Thread thread = NULL;
	bool cam_on = false;
	if (!c.receiving || !c.ready || !frame || !q || quirc_resize(q, W, H) < 0) goto done;
	if (!cam_start(&c.unit, &c.error)) goto done;
	cam_on = true;
	if (R_FAILED(svcCreateEvent(&c.cancel, RESET_ONESHOT))) goto done;
	s32 priority = 0x30;
	svcGetThreadPriority(&priority, CUR_THREAD_HANDLE);
	thread = threadCreate(capture_thread, &c, 0x2000, priority - 1, -2, false);
	if (!thread) goto done;

	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	for (int i = 0; i < 400 * 240; i++) fb[i] = UI_BG;
	u64 last_frame = osGetTime(), last_decode = 0;
	u32 seen = 0;
	const char *shown = NULL;
	result = QR_CANCELLED;
	for (;;) {
		if (!aptMainLoop() || receive_interrupted()) break;
		hidScanInput();
		if (RECEIVE_KEYS_DOWN() & KEY_B) break;
		gspWaitForVBlank();

		LightLock_Lock(&c.lock);
		const bool fresh = c.frames != seen;
		if (fresh) {
			seen = c.frames;
			memcpy(frame, c.ready, FRAME_BYTES);
		}
		LightLock_Unlock(&c.lock);
		const u64 now = osGetTime();
		if (!fresh) {
			if (c.failed || now - last_frame > NO_FRAME_MS) {
				result = QR_NO_CAMERA;
				break;
			}
			continue;
		}
		last_frame = now;
		draw_preview(fb, frame);
		if (now - last_decode < DECODE_EVERY_MS) continue;
		const char *wrong = NULL;
		if (decode_frame(q, frame, out, size, check, &wrong)) {
			result = QR_FOUND;
			break;
		}
		last_decode = osGetTime();
#ifdef NEO3DS_RECV_TEST
		static u64 worst;
		char s[40];
		if (last_decode - now > worst) worst = last_decode - now;
		snprintf(s, sizeof s, "decode %lu ms, worst %lu, qr %d e%d", (unsigned long)(last_decode - now), (unsigned long)worst, test_codes, test_error);
		ui_fill(8, 200, 304, 10, UI_BG);
		ui_text(8, 200, s, UI_DIM, 1);
		ui_flush();
#endif
		if (wrong && wrong != shown) {
			shown = wrong;
			status(wrong);
		}
	}
done:
	if (thread) {
		svcSignalEvent(c.cancel);
		threadJoin(thread, U64_MAX);
		threadFree(thread);
	}
	if (c.cancel) svcCloseHandle(c.cancel);
	if (c.error) svcCloseHandle(c.error);
	if (cam_on) cam_stop();
	if (q) quirc_destroy(q);
	free(frame);
	if (c.ready) linearFree(c.ready);
	if (c.receiving) linearFree(c.receiving);
	return result;
}
