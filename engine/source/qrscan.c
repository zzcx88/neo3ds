// The receive screen's camera (see qrscan.h). The camera delivers QVGA YUV422, packed Y U Y V: every
// second byte is the grey image, which is both the preview and what quirc reads. Decoding takes much
// longer than a frame, so it runs a few times a second and the preview keeps moving in between.
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

/* The frame arrives (0) or the camera's buffer overflowed while no one was reading (1). */
enum { EV_FRAME, EV_ERROR };

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
	          R_SUCCEEDED(CAMU_ClearBuffer(PORT_CAM1)) &&
	          R_SUCCEEDED(CAMU_StartCapture(PORT_CAM1));
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

/* Looks for codes in the frame. Of those check accepts, the one nearest the middle goes to out. */
static bool decode_frame(struct quirc *q, const u8 *frame, char *out, size_t size, QrCheck check, const char **wrong) {
	static struct quirc_code code;
	static struct quirc_data data;
	u8 *image = quirc_begin(q, NULL, NULL);
	for (int i = 0; i < W * H; i++) image[i] = frame[i * 2];
	quirc_end(q);

	long best = -1;
	for (int i = 0; i < quirc_count(q); i++) {
		quirc_extract(q, i, &code);
		if (quirc_decode(&code, &data) != QUIRC_SUCCESS) continue;
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
	u8 *frame = linearAlloc(FRAME_BYTES);
	struct quirc *q = quirc_new();
	if (!frame || !q || quirc_resize(q, W, H) < 0) goto done;

	u32 unit = 0;
	Handle events[2] = {0, 0};
	if (!cam_start(&unit, &events[EV_ERROR])) goto done;
	if (R_FAILED(CAMU_SetReceiving(&events[EV_FRAME], frame, PORT_CAM1, FRAME_BYTES, (s16)unit))) {
		svcCloseHandle(events[EV_ERROR]);
		cam_stop();
		goto done;
	}

	u16 *fb = (u16 *)gfxGetFramebuffer(GFX_TOP, GFX_LEFT, NULL, NULL);
	for (int i = 0; i < 400 * 240; i++) fb[i] = UI_BG;
	u64 last_frame = osGetTime(), last_decode = 0;
	const char *shown = NULL;
	result = QR_CANCELLED;
	for (;;) {
		if (!aptMainLoop()) break;
		hidScanInput();
		if (RECEIVE_KEYS_DOWN() & KEY_B) break;

		s32 which = -1;
		const Result r = svcWaitSynchronizationN(&which, events, 2, false, 16 * 1000000LL);
		const u64 now = osGetTime();
		if (R_FAILED(r)) { /* nothing yet */
			if (now - last_frame > NO_FRAME_MS) {
				result = QR_NO_CAMERA;
				break;
			}
			continue;
		}
		if (which == EV_ERROR) { /* frames were lost during a decode: start again */
			svcClearEvent(events[EV_ERROR]);
			svcCloseHandle(events[EV_FRAME]);
			events[EV_FRAME] = 0;
			CAMU_ClearBuffer(PORT_CAM1);
			CAMU_StartCapture(PORT_CAM1);
		} else {
			svcCloseHandle(events[EV_FRAME]);
			events[EV_FRAME] = 0;
			last_frame = now;
			svcInvalidateProcessDataCache(CUR_PROCESS_HANDLE, (u32)frame, FRAME_BYTES);
			draw_preview(fb, frame);
			if (now - last_decode >= DECODE_EVERY_MS) {
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
				snprintf(s, sizeof s, "decode %lu ms, worst %lu  ", (unsigned long)(last_decode - now), (unsigned long)worst);
				ui_fill(8, 200, 304, 10, UI_BG);
				ui_text(8, 200, s, UI_DIM, 1);
				ui_flush();
#endif
				if (wrong && wrong != shown) {
					shown = wrong;
					status(wrong);
				}
			}
		}
		if (R_FAILED(CAMU_SetReceiving(&events[EV_FRAME], frame, PORT_CAM1, FRAME_BYTES, (s16)unit))) {
			result = QR_NO_CAMERA;
			events[EV_FRAME] = 0;
			break;
		}
	}
	if (events[EV_FRAME]) svcCloseHandle(events[EV_FRAME]);
	svcCloseHandle(events[EV_ERROR]);
	cam_stop();
done:
	if (q) quirc_destroy(q);
	if (frame) linearFree(frame);
	return result;
}
