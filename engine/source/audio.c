// Sound output. The Z80's YM2610 writes are applied at once to the control chip on the main
// core (timers, IRQs, status) and logged; at the end of each frame the log is handed to core 1,
// which replays it on a second chip (ym2610_audio.c), synthesizes the frame and queues it to ndsp.
#include <3ds.h>
#include <stdlib.h>
#include <string.h>

#include "audio.h"
#include "emu.h"
#include "memory.h"
#include "ym2610/ym2610.h"

#define CHANNEL 0
#define NBUF 6
#define MAX_SAMPLES 1024 /* per buffer, stereo frames */
#define LOG_MAX 16384    /* YM2610 port writes per frame */
#define LOG_RESET 0xffff /* log entry: reset the chip */
#define LOG_LINE 0xf000  /* log entry: the entries after it happened on scanline (e & 0x3ff) */
#define LINES 264        /* scanlines per frame (neo_glue.c) */
#define MAX_PARTS 3      /* emulated frames in one log: the 68k's and up to two sound-only ones */

/* gngeo's YM2610Update_stream() writes interleaved stereo s16 here, from sample play_pos on
 * (core 1 only) */
Uint16 play_buffer[16384];
int play_pos;

extern int current_line; /* neo_glue.c */

void ym_audio_Init(int baseclock, int rate, void *pcmroma, int pcmsizea, void *pcmromb, int pcmsizeb,
                   FM_TIMERHANDLER TimerHandler, FM_IRQHANDLER IRQHandler);
void ym_audio_Reset(void);
int ym_audio_Write(int addr, u8 value);
u8 ym_audio_Read(int addr);
void ym_audio_Update_stream(int length);

extern u64 prof_ticks[6]; /* neo_glue.c */

static bool enabled;
static ndspWaveBuf wave[NBUF];
static s16 *pcm;
static int next;
static double frac;

/* Port writes: the main core fills log[fill]; core 1 replays log[fill ^ 1]. */
static u16 ym_log[2][LOG_MAX];
static int log_len[2], log_fill;
static int frame_samples;           /* samples core 1 generates for the handed-over log */
static int frame_lines;             /* scanlines that log covers (LINES per emulated frame) */
static int log_parts = 1;           /* emulated frames in log[fill] */
static unsigned frames_logged;      /* frames handed to core 1 */
static volatile unsigned frames_played; /* frames whose log core 1 has applied */

/* ADPCM end flags cleared by the Z80 but not yet replayed on the synthesis chip. */
static u8 pending_clear;
static unsigned pending_clear_frame;
static int latched_addr_a;

static void no_timer(int c, int count, double step) { (void)c; (void)count; (void)step; }
static void no_irq(int irq) { (void)irq; }

bool audio_init(int rate) {
	ym_audio_Init(8000000, rate, memory.rom.adpcma.p, memory.rom.adpcma.size, memory.rom.adpcmb.p,
	              memory.rom.adpcmb.size, no_timer, no_irq);
	if (R_FAILED(ndspInit())) return false; /* needs sdmc:/3ds/dspfirm.cdc */
	pcm = linearAlloc(NBUF * MAX_SAMPLES * 2 * sizeof(s16));
	if (!pcm) {
		ndspExit();
		return false;
	}
	memset(pcm, 0, NBUF * MAX_SAMPLES * 2 * sizeof(s16));
	ndspSetOutputMode(NDSP_OUTPUT_STEREO);
	ndspChnReset(CHANNEL);
	ndspChnSetInterp(CHANNEL, NDSP_INTERP_LINEAR);
	/* The main loop runs at the 3DS's 59.83Hz, so 59.83 Neo Geo frames (59.185Hz each) are emulated
	 * a second: play them that much faster, or the DSP falls 1.1% behind and a whole frame of sound
	 * is dropped every 1.5s, which stumbles the music */
	ndspChnSetRate(CHANNEL, rate * (59.83f / 59.185f));
	ndspChnSetFormat(CHANNEL, NDSP_FORMAT_STEREO_PCM16);
	float mix[12] = {1.0f, 1.0f};
	ndspChnSetMix(CHANNEL, mix);
	memset(wave, 0, sizeof wave);
	for (int i = 0; i < NBUF; i++) {
		wave[i].data_vaddr = pcm + i * MAX_SAMPLES * 2;
		wave[i].status = NDSP_WBUF_DONE;
	}
	next = 0;
	frac = 0;
	enabled = true;
	return true;
}

/* Each write is replayed at its place in the frame: a LOG_LINE entry goes before the first
 * write of every scanline that has any, so drivers that change a register several times a
 * frame (pitch sweeps, short notes) sound as they do on the chip. */
static int log_line = -1; /* scanline of the last LOG_LINE entry in log[fill] */

static void log_entry(u16 e) {
	int *len = &log_len[log_fill];
	const int line = (log_parts - 1) * LINES + current_line; /* counted from the log's first frame */
	if (line != log_line && *len < LOG_MAX) {
		log_line = line;
		ym_log[log_fill][(*len)++] = LOG_LINE | (line & 0x3ff);
	}
	if (*len < LOG_MAX) ym_log[log_fill][(*len)++] = e;
}

#ifdef NEO3DS_YMLOG
/* Dev aid: logs sound commands and YM2610 writes in the format of a MAME Lua tap, for comparison. */
#include <stdio.h>
static char *ymlog_buf; /* 3MB */
static size_t ymlog_len;
int ymlog_frame;
void ymlog_line(char kind, int port, int data) {
	if (!ymlog_buf) ymlog_buf = malloc(3 << 20);
	if (!ymlog_buf || ymlog_len > (3 << 20) - 32) return;
	if (kind == 'C') ymlog_len += sprintf(ymlog_buf + ymlog_len, "C %d %02x\n", ymlog_frame, data & 0xff);
	else if (kind == 'R') ymlog_len += sprintf(ymlog_buf + ymlog_len, "R %d %04x %02x\n", ymlog_frame, port, data & 0xff);
	else ymlog_len += sprintf(ymlog_buf + ymlog_len, "Y %d %d %02x\n", ymlog_frame, port, data & 0xff);
}
void ymlog_save(void) {
	FILE *f = fopen("sdmc:/neo3ds/ymlog.txt", "w");
	if (f) { fwrite(ymlog_buf, 1, ymlog_len, f); fclose(f); }
}
#endif

int dbg_adpcma_keyons, dbg_adpcma_oob; /* diagnostics: ADPCM-A key-ons, and those starting past the V ROM */

void audio_ym_write(int port, int data) {
	static int latched_addr_b, start[6];
#ifdef NEO3DS_YMLOG
	ymlog_line('Y', port, data);
#endif
	if (port == 2) latched_addr_b = data;
	else if (port == 3) {
		int r = latched_addr_b, ch = r & 7;
		if (r >= 0x10 && r <= 0x15) start[ch] = (start[ch] & 0xff00) | data;
		else if (r >= 0x18 && r <= 0x1d) start[ch] = (start[ch] & 0xff) | data << 8;
		else if (r == 0x00 && !(data & 0x80))
			for (int c = 0; c < 6; c++)
				if (data >> c & 1) {
					dbg_adpcma_keyons++;
					if ((u32)start[c] << 8 >= memory.rom.adpcma.size) dbg_adpcma_oob++;
				}
	}
	if (port == 0) latched_addr_a = data;
	else if (port == 1 && latched_addr_a == 0x1c && data) { /* FLAG CONTROL: clears end flags */
		pending_clear |= data;
		pending_clear_frame = frames_logged;
	}
	log_entry((u16)((port << 8) | (data & 0xff)));
}

void audio_ym_reset(void) {
	log_entry(LOG_RESET);
}

u8 audio_adpcm_status(void) {
	if (pending_clear && (int)(frames_played - pending_clear_frame) > 0) pending_clear = 0;
	return ym_audio_Read(2) & ~pending_clear;
}

unsigned audio_catchups, audio_drops; /* diagnostics: sound-only frames run, frames dropped */

/* The DSP is about to run out: fewer than two frames' buffers are still queued. Then the 3DS is not
 * keeping up with 60 emulated frames a second, and the music would slow down with the game. */
/* After a save state was loaded: the logged writes belong to the frames before it. */
void audio_state_loaded(void) {
	log_len[0] = log_len[1] = 0;
	log_parts = 1;
	log_line = -1;
	pending_clear = 0;
}

bool audio_behind(void) {
#ifdef NEO3DS_STATE_TEST
	return false; /* sound-only frames depend on host timing: the test needs the same run twice */
#endif
	if (!enabled || log_parts >= MAX_PARTS) return false;
	int queued = 0;
	for (int i = 0; i < NBUF; i++)
		if (wave[i].status == NDSP_WBUF_QUEUED || wave[i].status == NDSP_WBUF_PLAYING) queued++;
	return queued < 2;
}

void audio_next_part(void) {
	log_parts++;
	audio_catchups++;
}

// Main core, end of frame (core 1 is idle): hand this frame's writes over and start a new log.
void audio_end_frame(int rate) {
	frac += log_parts * rate / 59.185;
	frame_lines = log_parts * LINES;
	log_parts = 1;
	frame_samples = (int)frac;
	frac -= frame_samples;
	if (frame_samples > MAX_SAMPLES) frame_samples = MAX_SAMPLES;
	log_fill ^= 1;
	log_len[log_fill] = 0;
	log_line = -1;
	frames_logged++;
}

// Core 1: replay the handed-over writes, synthesize the frame and queue it.
// If the DSP has fallen behind and every buffer is still queued, the frame is dropped.
void audio_render(void) {
	const u16 *e = ym_log[log_fill ^ 1];
	const int len = log_len[log_fill ^ 1];
	const int n = frame_samples;
	u64 t0 = svcGetSystemTick();
	play_pos = 0;
	for (int i = 0; i < len; i++) {
		if ((e[i] & 0xf000) == LOG_LINE && e[i] != LOG_RESET) {
			/* synthesize up to this scanline's place in the frame, then apply its writes */
			const int to = (e[i] & 0x3ff) * n / frame_lines;
			if (enabled && to > play_pos) {
				ym_audio_Update_stream(to - play_pos);
				play_pos = to;
			}
		} else if (e[i] == LOG_RESET) ym_audio_Reset();
		else ym_audio_Write(e[i] >> 8, e[i] & 0xff);
	}
	__atomic_store_n(&frames_played, frames_logged, __ATOMIC_RELEASE);
	if (!enabled) return;

	if (n > play_pos) ym_audio_Update_stream(n - play_pos);
	prof_ticks[5] += svcGetSystemTick() - t0;

	ndspWaveBuf *wb = &wave[next];
	if (wb->status != NDSP_WBUF_DONE && wb->status != NDSP_WBUF_FREE) {
		audio_drops++;
		return;
	}
	memcpy(wb->data_pcm16, play_buffer, n * 2 * sizeof(s16));
	wb->nsamples = n;
	/* kernel call instead of DSP_FlushDataCache, which waits on the DSP service (see screen_update) */
	svcStoreProcessDataCache(CUR_PROCESS_HANDLE, (u32)wb->data_pcm16, n * 2 * sizeof(s16));
	ndspChnWaveBufAdd(CHANNEL, wb);
	next = (next + 1) % NBUF;
}

void audio_exit(void) {
	if (!enabled) return;
	enabled = false;
	ndspChnReset(CHANNEL);
	ndspExit();
	linearFree(pcm);
}
