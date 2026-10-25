/*  gngeo a neogeo emulator
 *  Copyright (C) 2001 Peponas Mathieu
 * 
 *  This program is free software; you can redistribute it and/or modify  
 *  it under the terms of the GNU General Public License as published by   
 *  the Free Software Foundation; either version 2 of the License, or    
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Library General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA. 
 */

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include <string.h>
#include <stdlib.h>
#include <zlib.h>
#include "video.h"
#include "lz4.h"
#include "zstd.h"
#define GN_TRUE 1
#define GN_FALSE 0
#include "memory.h"
#include "emu.h"

#include "screen.h"
#include "frame_skip.h"
#include "transpack.h"


extern int neogeo_fix_bank_type;
unsigned int neogeo_frame_counter;

#ifdef PROCESSOR_ARM
/* global declaration for video_arm.S */
Uint8 *mem_gfx = NULL; /*=memory.rom.tiles.p;*/
Uint8 *mem_video = NULL; //memory.vid.ram;
//#define TOTAL_GFX_BANK 4096
Uint32 *mem_bank_usage;

//GFX_CACHE gcache;

void draw_one_char_arm(int byte1, int byte2, unsigned short *br);
int draw_tile_arm_norm(unsigned int tileno, int color, unsigned char *bmp, int zy);
#endif

#ifdef I386_ASM
/* global declaration for video_i386.asm */
Uint8 **mem_gfx; //=&memory.rom.tiles.p;
Uint8 *mem_video; //=memory.vid.ram;

/* prototype */
void draw_tile_i386_norm(unsigned int tileno, int sx, int sy, int zx, int zy,
		int color, int xflip, int yflip, unsigned char *bmp);
void draw_tile_i386_50(unsigned int tileno, int sx, int sy, int zx, int zy,
		int color, int xflip, int yflip, unsigned char *bmp);
void draw_one_char_i386(int byte1, int byte2, unsigned short *br);

void draw_scanline_tile_i386_norm(unsigned int tileno, int yoffs, int sx, int line, int zx,
		int color, int xflip, unsigned char *bmp);

void draw_scanline_tile_i386_50(unsigned int tileno, int yoffs, int sx, int line, int zx,
		int color, int xflip, unsigned char *bmp);
#endif

//Uint8 strip_usage[0x300];
#define PEN_USAGE(tileno) ((((Uint32*) memory.rom.spr_usage.p)[tileno>>4]>>((tileno&0xF)*2))&0x3)


char *ldda_y_skip;
char *dda_x_skip;
char ddaxskip[16][16] = {
	{ 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0},
	{ 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0},
	{ 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0},
	{ 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0},
	{ 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0},
	{ 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0},
	{ 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0},
	{ 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0},
	{ 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0},
	{ 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0},
	{ 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1},
	{ 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1},
	{ 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1},
	{ 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1},
	{ 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1},
	{ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}
};
Uint32 ddaxskip_i[16] = {
	0x0080, 0x0880, 0x0888, 0x2888, 0x288a, 0x2a8a, 0x2aaa, 0xaaaa,
	0xaaea, 0xbaea, 0xbaeb, 0xbbeb, 0xbbef, 0xfbef, 0xfbff, 0xffff
};
Uint32 dda_x_skip_i;

static __inline__ Uint16 alpha_blend(Uint16 dest, Uint16 src, Uint8 a) {
	static Uint8 dr, dg, db, sr, sg, sb;

	dr = ((dest & 0xF800) >> 11) << 3;
	dg = ((dest & 0x7E0) >> 5) << 2;
	db = ((dest & 0x1F)) << 3;

	sr = ((src & 0xF800) >> 11) << 3;
	sg = ((src & 0x7E0) >> 5) << 2;
	sb = ((src & 0x1F)) << 3;

	dr = (((sr - dr)*(a)) >> 8) + dr;
	dg = (((sg - dg)*(a)) >> 8) + dg;
	db = (((sb - db)*(a)) >> 8) + db;

	return ((dr >> 3) << 11) | ((dg >> 2) << 5) | (db >> 3);
}
#define BLEND16_50(a,b) ((((a)&0xf7de)>>1)+(((b)&0xf7de)>>1))
#define BLEND16_25(a,b) alpha_blend(a,b,63)


char dda_y_skip[17];
Uint32 dda_y_skip_i;
Uint32 full_y_skip_i = 0xFFFE;
char full_y_skip[16] = {0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
unsigned int neogeo_frame_counter_speed = 8;
static Uint16 fix_addr[40][32];
static Uint8 fix_shift[40];


static ZSTD_DCtx *zstd_ctx; /* used under cache_lock */

int init_sprite_cache(Uint32 size, Uint32 bsize, int codec, const Uint8 *packed, const Uint32 *offset, Uint32 nb_blocks) {
	GFX_CACHE *gcache = &memory.vid.spr_cache;
	int i;

	free_sprite_cache();
	if (codec == SPR_CODEC_ZSTD && !zstd_ctx && !(zstd_ctx = ZSTD_createDCtx()))
		return GN_FALSE;
	gcache->codec = codec;
	gcache->slot_size = bsize;
	gcache->total_bank = nb_blocks;
	gcache->packed = packed;
	gcache->offset = offset;
	gcache->ptr = calloc(nb_blocks, sizeof (Uint8*));
	gcache->max_slot = size / bsize;
	gcache->size = gcache->max_slot * bsize;
	gcache->data = malloc(gcache->size);
	gcache->usage = malloc(gcache->max_slot * sizeof (int));
	if (!gcache->ptr || !gcache->data || !gcache->usage) {
		free_sprite_cache();
		return GN_FALSE;
	}
	for (i = 0; i < gcache->max_slot; i++)
		gcache->usage[i] = -1;
	gcache->misses = 0;
	return GN_TRUE;
}

void free_sprite_cache(void) {
	GFX_CACHE *gcache = &memory.vid.spr_cache;
	free(gcache->data);
	free(gcache->ptr);
	free(gcache->usage);
	gcache->data = NULL;
	gcache->ptr = NULL;
	gcache->usage = NULL;
}

/* Both cores draw bands, so a miss is handled under a lock; hits read the table without one. A
 * slot evicted while the other core still draws from it would show wrong pixels for that frame,
 * which takes a frame needing about as many slots as the cache has. */
static int cache_lock;

Uint8 *get_cached_sprite_ptr(Uint32 tileno) {
	GFX_CACHE *gcache = &memory.vid.spr_cache;
	static int pos = 0;
	Uint32 bank = tileno / (gcache->slot_size >> 7);
	Uint8 *slot;
	int a;

	if (gcache->ptr[bank])
		return gcache->ptr[bank];

	while (__atomic_exchange_n(&cache_lock, 1, __ATOMIC_ACQUIRE)) {}
	if ((slot = gcache->ptr[bank])) { /* the other core just decompressed it */
		__atomic_store_n(&cache_lock, 0, __ATOMIC_RELEASE);
		return slot;
	}
	/* Round-robin replacement: evict whatever held the next slot. */
	a = pos;
	if (++pos >= gcache->max_slot) pos = 0;
	if (gcache->usage[a] != -1)
		gcache->ptr[gcache->usage[a]] = NULL;

	slot = gcache->data + a * gcache->slot_size;
	{
		const Uint8 *src = gcache->packed + gcache->offset[bank];
		const Uint32 n = gcache->offset[bank + 1] - gcache->offset[bank];
		if (gcache->codec == SPR_CODEC_ZSTD) {
			if (ZSTD_isError(ZSTD_decompressDCtx(zstd_ctx, slot, gcache->slot_size, src, n)))
				memset(slot, 0, gcache->slot_size);
		} else
			LZ4_decompress_safe((const char *) src, (char *) slot, n, gcache->slot_size);
	}
	gcache->usage[a] = bank;
	gcache->misses++;
	__atomic_store_n(&gcache->ptr[bank], slot, __ATOMIC_RELEASE); /* published once filled */
	__atomic_store_n(&cache_lock, 0, __ATOMIC_RELEASE);
	return slot;
}

static void fix_value_init(void) {
	int x, y;
	for (x = 0; x < 40; x++) {
		for (y = 0; y < 32; y++) {
			fix_addr[x][y] = 0xea00 + (y << 1) + 64 * (x / 6);
		}
		fix_shift[x] = (5 - (x % 6));
	}
}

#define fix_add(x, y) ((((READ_WORD(snap_vram + 0xEA00 + (((y-1)&31)*2 + 64 * (x/6))) >> (5-(x%6))*2) & 3) ^ 3))

/* Drawing function generation */
#define RENAME(name) name##_tile
#define PUTPIXEL(dst,src) dst=src
#include "video_template.h"

#define RENAME(name) name##_tile_50
#define PUTPIXEL(dst,src) dst=BLEND16_50(src,dst)
#include "video_template.h"

#define RENAME(name) name##_tile_25
#define PUTPIXEL(dst,src) dst=BLEND16_25(src,dst)
#include "video_template.h"

#ifdef PROCESSOR_ARM

static __inline__ void draw_tile_arm(unsigned int tileno, int sx, int sy, int zx, int zy,
		int color, int xflip, int yflip, unsigned char *bmp) {
	Uint32 pitch = 352/*buffer->pitch>>1*/;
	//static SDL_Rect blit_rect={0,0,16,16};

	if (zy == 16)
		ldda_y_skip = full_y_skip;
	else
		ldda_y_skip = dda_y_skip;

	//if (yskip==16) dda_y_skip_i=0xFFFE;
	if (zx == 16) {
		if (!xflip) {
			if (!yflip) {
				draw_tile_arm_norm(tileno, color, (unsigned short*) bmp + (sy) * pitch + sx, zy);
				//draw_tile_arm_norm(tileno,color,(unsigned short*)sprbuf->pixels,zy);
			} else {
				draw_tile_arm_yflip_norm(tileno, color, (unsigned short*) bmp + ((zy - 1) + sy) * pitch + sx, zy);
				//draw_tile_arm_yflip_norm(tileno,color,(unsigned short*)sprbuf->pixels+(zy-1)*32,zy);
			}
		} else {
			if (!yflip) {
				//draw_tile_arm_xflip_norm(tileno,color,(unsigned short*)sprbuf->pixels,zy);
				draw_tile_arm_xflip_norm(tileno, color, (unsigned short*) bmp + (sy) * pitch + sx, zy);
			} else {
				draw_tile_arm_xyflip_norm(tileno, color, (unsigned short*) bmp + ((zy - 1) + sy) * pitch + sx, zy);
				//draw_tile_arm_xyflip_norm(tileno,color,(unsigned short*)sprbuf->pixels+(zy-1)*32,zy);
			}
		}
	} else {
		dda_x_skip_i = ddaxskip_i[zx];
		/*
		  draw_tile(tileno,sx+16,sy,rzx,yskip,tileatr>>8,
		  tileatr & 0x01,tileatr & 0x02,
		  (unsigned char*)buffer->pixels);
		 */
		if (!xflip) {
			if (!yflip) {
				draw_tile_arm_xzoom(tileno, color,
						(unsigned short*) bmp + (sy) * pitch + sx,
						zy);
			} else {
				draw_tile_arm_yflip_xzoom(tileno, color,
						(unsigned short*) bmp + ((zy - 1) + sy) * pitch + sx,
						zy);
			}
		} else {
			if (!yflip) {
				draw_tile_arm_xflip_xzoom(tileno, color,
						(unsigned short*) bmp + (sy) * pitch + sx,
						zy);
			} else {
				draw_tile_arm_xyflip_xzoom(tileno, color,
						(unsigned short*) bmp + ((zy - 1) + sy) * pitch + sx,
						zy);
			}
		}
	}
}
#endif

/* Renderer input, copied by video_snapshot(). Bytes 0..0x10c00 of video RAM cover SCB1, the fix
 * map and SCB2-SCB4. */
#define SNAP_VRAM_BYTES 0x10c00
static Uint8 snap_vram[SNAP_VRAM_BYTES] __attribute__((aligned(32)));
static Uint32 snap_pal[4096];
static unsigned int snap_frame_counter, snap_irq2control;
static const Uint8 *snap_fix, *snap_fix_usage;

/* Tile-based rendering: the 224 visible lines are drawn as VIDEO_BANDS bands of VIDEO_BAND_LINES
 * lines, each into a band buffer small enough to stay in the L1 cache, and only the finished band
 * is written to the 3DS top framebuffer. Overdraw then never leaves the cache, and the framebuffer
 * is written once, in runs of whole columns.
 * A band buffer is laid out like the framebuffer, the screen rotated: 320 columns of XSTEP
 * pixels, each column bottom line first. Moving one pixel right is +XSTEP, one line down is -1.
 * The draw functions take cv, the address of column 0 on scanline 0 (visible scanlines are
 * 16..239), which for a band lies outside its buffer; only the band's lines are drawn. */
#define XSTEP VIDEO_BAND_STRIDE

/* Fix layer banking for the frame (Garou, Metal Slug 3/4, KOF2000...), set by prepare_fix */
static int fix_banked, fix_garou[32];

static void prepare_fix(void) {
	/* as MAME: only fix ROMs past 128KB are banked */
	fix_banked = snap_fix == memory.rom.game_sfix.p && neogeo_fix_bank_type && memory.rom.game_sfix.size > 0x20000;
	if (fix_banked && neogeo_fix_bank_type == 1) {
		int bank = 0, k = 0, y = 0;
		while (y < 32) {
			if (READ_WORD(&snap_vram[0xea00 + (k << 1)]) == 0x0200 &&
					(READ_WORD(&snap_vram[0xeb00 + (k << 1)]) & 0xff00) == 0xff00) {
				bank = READ_WORD(&snap_vram[0xeb00 + (k << 1)]) & 3;
				fix_garou[y++] = bank;
				if (y == 32) break; /* neo3ds: the next write would be past the array */
			}
			fix_garou[y++] = bank;
			k += 2;
		}
	}
}

/* The fix layer (8x8 characters, pen 0 transparent) on scanlines first..last-1 */
static void draw_fix_band(Uint16 *cv, int first, int last) {
	int y, x, yy;
	for (y = first >> 3; y <= (last - 1) >> 3; y++) { /* rows 2..29 cover scanlines 16..239 */
		const int top = y << 3;
		const int y0 = first > top ? first - top : 0, y1 = last < top + 8 ? last - top : 8;
		for (x = 1; x < 39; x++) {
			unsigned int byte1 = READ_WORD(&snap_vram[0xE000 + ((y + (x << 5)) << 1)]);
			const unsigned int byte2 = byte1 >> 12;
			const Uint32 *pal, *gfx;
			Uint16 *br;

			byte1 &= 0xfff;
			if (fix_banked) {
				switch (neogeo_fix_bank_type) {
					case 1: /* Garou, MSlug 3 */
						byte1 += 0x1000 * (fix_garou[(y - 2) & 31] ^ 3);
						break;
					case 2:
						byte1 += 0x1000 * fix_add(x, y);
						break;
				}
			}
			if ((byte1 >= (memory.rom.game_sfix.size >> 5)) || (snap_fix_usage[byte1] == 0x00)) continue;

			pal = &snap_pal[byte2 << 4];
			gfx = (const Uint32 *) &snap_fix[byte1 << 5];
			br = cv + (x << 3) * XSTEP - top;
			for (yy = y0; yy < y1; yy++) {
				const Uint32 w = gfx[yy];
				Uint16 *const p = br - yy;
				unsigned int c;
				if ((c = (w >> 28) & 0xf)) p[7 * XSTEP] = pal[c];
				if ((c = (w >> 24) & 0xf)) p[6 * XSTEP] = pal[c];
				if ((c = (w >> 20) & 0xf)) p[5 * XSTEP] = pal[c];
				if ((c = (w >> 16) & 0xf)) p[4 * XSTEP] = pal[c];
				if ((c = (w >> 12) & 0xf)) p[3 * XSTEP] = pal[c];
				if ((c = (w >> 8) & 0xf)) p[2 * XSTEP] = pal[c];
				if ((c = (w >> 4) & 0xf)) p[1 * XSTEP] = pal[c];
				if ((c = w & 0xf)) p[0] = pal[c];
			}
		}
	}
}

/* Sprite renderer following MAME's neosprite.cpp: every visible scanline of every sprite looks
 * up its tile and tile row in the 000-lo.lo zoom table, so y-zoom, sticky chains and the
 * "fullmode" (size > 0x20) wrap-around all behave as on hardware. */
#define MAX_SPRITES 381
#define FIRST_LINE 16  /* first visible scanline / buffer row */
#define LAST_LINE 240

static const Uint8 zoom_x_tables[16][16] = {
	{0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0},
	{0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0},
	{0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0},
	{0,0,1,0,1,0,0,0,1,0,0,0,1,0,0,0},
	{0,0,1,0,1,0,0,0,1,0,0,0,1,0,1,0},
	{0,0,1,0,1,0,1,0,1,0,0,0,1,0,1,0},
	{0,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0},
	{1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0},
	{1,0,1,0,1,0,1,0,1,1,1,0,1,0,1,0},
	{1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,0},
	{1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,1},
	{1,0,1,1,1,0,1,1,1,1,1,0,1,0,1,1},
	{1,0,1,1,1,0,1,1,1,1,1,0,1,1,1,1},
	{1,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1},
	{1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1},
	{1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1},
};

/* Source columns drawn for each x zoom, left to right (from zoom_x_tables). */
static Uint8 zoom_cols[16][16], zoom_width[16];
static int lo_identity; /* 000-lo.lo maps zoom 0xff line n to n (as it does on real hardware) */
/* Sprite tile numbers are masked to a power of two like the address lines of the C ROMs; numbers
 * past the end of a ROM that is not a power of two in size (Metal Slug X: 0x60000 tiles) are
 * transparent. */
static Uint32 tile_mask;

static void init_zoom_cols(void) {
	int z, i;
	for (z = 0; z < 16; z++) {
		zoom_width[z] = 0;
		for (i = 0; i < 16; i++)
			if (zoom_x_tables[z][i]) zoom_cols[z][zoom_width[z]++] = i;
	}
	for (tile_mask = 1; tile_mask < memory.nb_of_tiles; tile_mask <<= 1)
		;
	tile_mask--;
	lo_identity = 1;
	for (i = 0; i < 256; i++)
		if (memory.ng_lo[0xff00 | i] != i) lo_identity = 0;
}

#define PIX(w, i) (((w) >> (28 - ((i) << 2))) & 0xf)
#define PUT(n, w, i) if ((c = PIX(w, i)) != 0) dst[(n) * XSTEP] = pal[c]

/* Eight opaque pixels (no pen 0) from one tile-row word, in ARM assembly: one "and" with a
 * shifted operand gives each pen's palette offset, so a pixel costs and + ldr + strh. Loads are
 * grouped four at a time to hide their latency. dst advances one pixel (XSTEP) per store. */
#define PUT8_OPAQUE(body) do { \
	Uint32 a, b, c, d; \
	Uint16 *p = dst; \
	__asm__ volatile (body \
		: [dst] "+r" (p), [a] "=&r" (a), [b] "=&r" (b), [c] "=&r" (c), [d] "=&r" (d) \
		: [w] "r" (w), [pal] "r" (pal), [m] "r" (0x3c), [s] "r" (XSTEP * 2) \
		: "memory"); \
} while (0)

/* Non-zero when one of the eight 4-bit pens in w is 0 (transparent). */
#define HAS_CLEAR(w) (((w) - 0x11111111u) & ~(w) & 0x88888888u)

/* Eight pixels from one tile-row word (pen 0 is transparent); rev = horizontally flipped.
 * Fully transparent and fully opaque halves skip the per-pixel test. */
static __inline__ __attribute__((always_inline)) void put_half(Uint16 *dst, Uint32 w, const Uint32 *pal, int rev) {
	Uint32 c;
	if (!w) return;
	if (!HAS_CLEAR(w)) {
		if (!rev)
			PUT8_OPAQUE(
		"and %[a], %[m], %[w], lsr #26\n\t"
		"and %[b], %[m], %[w], lsr #22\n\t"
		"and %[c], %[m], %[w], lsr #18\n\t"
		"and %[d], %[m], %[w], lsr #14\n\t"
		"ldr %[a], [%[pal], %[a]]\n\t"
		"ldr %[b], [%[pal], %[b]]\n\t"
		"ldr %[c], [%[pal], %[c]]\n\t"
		"ldr %[d], [%[pal], %[d]]\n\t"
		"strh %[a], [%[dst]], %[s]\n\t"
		"and %[a], %[m], %[w], lsr #10\n\t"
		"strh %[b], [%[dst]], %[s]\n\t"
		"and %[b], %[m], %[w], lsr #6\n\t"
		"strh %[c], [%[dst]], %[s]\n\t"
		"and %[c], %[m], %[w], lsr #2\n\t"
		"strh %[d], [%[dst]], %[s]\n\t"
		"and %[d], %[m], %[w], lsl #2\n\t"
		"ldr %[a], [%[pal], %[a]]\n\t"
		"ldr %[b], [%[pal], %[b]]\n\t"
		"ldr %[c], [%[pal], %[c]]\n\t"
		"ldr %[d], [%[pal], %[d]]\n\t"
		"strh %[a], [%[dst]], %[s]\n\t"
		"strh %[b], [%[dst]], %[s]\n\t"
		"strh %[c], [%[dst]], %[s]\n\t"
		"strh %[d], [%[dst]], %[s]\n\t");
		else
			PUT8_OPAQUE(
		"and %[a], %[m], %[w], lsl #2\n\t"
		"and %[b], %[m], %[w], lsr #2\n\t"
		"and %[c], %[m], %[w], lsr #6\n\t"
		"and %[d], %[m], %[w], lsr #10\n\t"
		"ldr %[a], [%[pal], %[a]]\n\t"
		"ldr %[b], [%[pal], %[b]]\n\t"
		"ldr %[c], [%[pal], %[c]]\n\t"
		"ldr %[d], [%[pal], %[d]]\n\t"
		"strh %[a], [%[dst]], %[s]\n\t"
		"and %[a], %[m], %[w], lsr #14\n\t"
		"strh %[b], [%[dst]], %[s]\n\t"
		"and %[b], %[m], %[w], lsr #18\n\t"
		"strh %[c], [%[dst]], %[s]\n\t"
		"and %[c], %[m], %[w], lsr #22\n\t"
		"strh %[d], [%[dst]], %[s]\n\t"
		"and %[d], %[m], %[w], lsr #26\n\t"
		"ldr %[a], [%[pal], %[a]]\n\t"
		"ldr %[b], [%[pal], %[b]]\n\t"
		"ldr %[c], [%[pal], %[c]]\n\t"
		"ldr %[d], [%[pal], %[d]]\n\t"
		"strh %[a], [%[dst]], %[s]\n\t"
		"strh %[b], [%[dst]], %[s]\n\t"
		"strh %[c], [%[dst]], %[s]\n\t"
		"strh %[d], [%[dst]], %[s]\n\t");
	} else if (!rev) {
		PUT(0, w, 0); PUT(1, w, 1); PUT(2, w, 2); PUT(3, w, 3);
		PUT(4, w, 4); PUT(5, w, 5); PUT(6, w, 6); PUT(7, w, 7);
	} else {
		PUT(0, w, 7); PUT(1, w, 6); PUT(2, w, 5); PUT(3, w, 4);
		PUT(4, w, 3); PUT(5, w, 2); PUT(6, w, 1); PUT(7, w, 0);
	}
}

/* Unzoomed 16-pixel row that lies fully inside the visible 320 columns; dst is its first pixel. */
static __inline__ __attribute__((always_inline)) void put_row16(Uint16 *dst, Uint32 w0, Uint32 w1, const Uint32 *pal, int xflip) {
	if (!xflip) {
		put_half(dst, w0, pal, 0);
		put_half(dst + 8 * XSTEP, w1, pal, 0);
	} else {
		put_half(dst, w1, pal, 1);
		put_half(dst + 8 * XSTEP, w0, pal, 1);
	}
}

/* Any zoom; columns past the right edge are skipped and x wraps at 512 like the hardware.
 * row points at column 0 of the scanline. */
static void put_row_zoomed(Uint16 *row, int x, int zoom_x, Uint32 w0, Uint32 w1, const Uint32 *pal, int xflip) {
	const Uint8 *cols = zoom_cols[zoom_x];
	const int n = zoom_width[zoom_x];
	int k;
	for (k = 0; k < n; k++, x = (x + 1) & 0x1ff) {
		int p = xflip ? 15 - cols[k] : cols[k];
		Uint32 c = PIX(p < 8 ? w0 : w1, p & 7);
		if (c && x < 320) row[x * XSTEP] = pal[c];
	}
}

/* A zoomed row that lies fully inside the visible columns, for one x zoom and flip known at
 * compile time: the column list unrolls into straight-line code, so a pixel costs a shift, a
 * test and the palette store, as in put_half. Zoomed-out scenes (Samurai Shodown) draw most
 * of the screen through here. */
static __inline__ __attribute__((always_inline)) void put_row_zoom_k(Uint16 *dst, Uint32 w0, Uint32 w1,
		const Uint32 *pal, const int z, const int xflip) {
	int k = 0, i;
	Uint32 c;
#pragma GCC unroll 16
	for (i = 0; i < 16; i++) {
		if (!zoom_x_tables[z][i]) continue;
		const int p = xflip ? 15 - i : i;
		if ((c = PIX(p < 8 ? w0 : w1, p & 7)) != 0) dst[k * XSTEP] = pal[c];
		k++;
	}
}

#define ZOOM_CASE(z) \
	case (z) * 2: put_row_zoom_k(dst, w0, w1, pal, z, 0); break; \
	case (z) * 2 + 1: put_row_zoom_k(dst, w0, w1, pal, z, 1); break;

/* dst is the row's first pixel; x + zoom_width[zoom_x] <= 320. */
static void put_row_zoomed_in(Uint16 *dst, int zoom_x, Uint32 w0, Uint32 w1, const Uint32 *pal, int xflip) {
	switch (zoom_x * 2 + xflip) {
	ZOOM_CASE(0) ZOOM_CASE(1) ZOOM_CASE(2) ZOOM_CASE(3) ZOOM_CASE(4) ZOOM_CASE(5) ZOOM_CASE(6) ZOOM_CASE(7)
	ZOOM_CASE(8) ZOOM_CASE(9) ZOOM_CASE(10) ZOOM_CASE(11) ZOOM_CASE(12) ZOOM_CASE(13) ZOOM_CASE(14)
	ZOOM_CASE(15)
	}
}

#undef ZOOM_CASE

#undef PUT
#undef PUT8_OPAQUE

/* Tile data of one 16x16 tile of a sprite (after auto-animation), or NULL if fully transparent. */
static __inline__ const Uint32 *sprite_tile(int sprite, int tile, const Uint16 *vram, int *attr_out) {
	const int attr = vram[(sprite << 6) | (tile << 1) | 1];
	Uint32 code = ((attr << 12) & 0x70000) | vram[(sprite << 6) | (tile << 1)];
	if (!(snap_irq2control & 0x08)) {
		if (attr & 0x08) code = (code & ~7) | (snap_frame_counter & 7);
		else if (attr & 0x04) code = (code & ~3) | (snap_frame_counter & 3);
	}
	code &= tile_mask;
	if (code >= memory.nb_of_tiles || PEN_USAGE(code) == TILE_INVISIBLE) return NULL;
	*attr_out = attr;
	if (memory.vid.spr_cache.data)
		return (const Uint32 *) (get_cached_sprite_ptr(code) +
				((code & ((memory.vid.spr_cache.slot_size >> 7) - 1)) << 7));
	return (const Uint32 *) (memory.rom.tiles.p + (code << 7));
}

/* Rows of one tile: n lines from dst downwards, tile rows from src stepping by step words. */
#define TILE_ROWS(xflip) do { \
	do { \
		const Uint32 w0 = src[0], w1 = src[1]; \
		if (w0 | w1) put_row16(dst, w0, w1, pal, xflip); \
		src += step; \
		dst--; \
	} while (--n); \
} while (0)

/* Lines first..last-1 of a sprite with no y zoom and no x zoom, fully inside
 * the visible columns: a tile at a time, so the per-line work is just reading the tile row. */
static void draw_sprite_tiles(Uint16 *cv, int sprite, int first, int last, int y, int x, const Uint16 *vram) {
	Uint16 *const col = cv + x * XSTEP;
	int line = first;

	while (line < last) {
		const int s = (line - y) & 0x1ff;
		int tile_y = s & 0x0f, n = 16 - tile_y, attr;
		const Uint32 *src;

		if (n > last - line) n = last - line;
		src = sprite_tile(sprite, (s >> 4) & 0x1f, vram, &attr);
		line += n;
		if (src) {
			const Uint32 *pal = &snap_pal[(attr >> 8) << 4];
			Uint16 *dst = col - (line - n);
			int step = 2;
			if (attr & 0x02) { /* y flip */
				tile_y ^= 0x0f;
				step = -2;
			}
			src += tile_y << 1;
			if (attr & 0x01)
				TILE_ROWS(1);
			else
				TILE_ROWS(0);
		}
	}
}

#undef TILE_ROWS

#ifdef NEO3DS_BENCH
int render_zoom_fast = 1; /* the benchmark compares the renderer with and without put_row_zoomed_in */
#define RENDER_ZOOM_FAST render_zoom_fast
#else
#define RENDER_ZOOM_FAST 1
#endif

/* Diagnostics: sprite lines drawn by each path (0 whole tiles, 1 unzoomed per line, 2 x zoom or
 * screen edge, 3 y zoom), summed until main.c reads and clears them. */
unsigned spr_lines[4];

static void draw_sprite_lines(Uint16 *cv, int sprite, int first, int last, int y, int x, int zoom_x, int zoom_y,
		int size, const Uint16 *vram) {
	const int animate = !(snap_irq2control & 0x08);
	const int fast = zoom_x == 15 && x <= 320 - 16;
	const int inside = RENDER_ZOOM_FAST && x + zoom_width[zoom_x] <= 320; /* x < 512, so no wrap either */
	/* With zoom 0xff the size > 0x20 wrap-around never changes the line, so it needs no check. */
	const int unzoomed = zoom_y == 0xff && lo_identity;
	const int tiles_per_slot = memory.vid.spr_cache.slot_size >> 7;
	int line, cur_tile = -1, attr = 0, visible = 0;
	const Uint32 *tile_data = NULL;
	const Uint32 *pal = NULL;

	spr_lines[unzoomed ? (fast ? 0 : 2) : 3] += last - first;
	if (unzoomed && fast) {
		draw_sprite_tiles(cv, sprite, first, last, y, x, vram);
		return;
	}
	for (line = first; line < last; line++) {
		int sprite_line = (line - y) & 0x1ff;
		int zoom_line = sprite_line & 0xff;
		int invert = sprite_line & 0x100;
		int y_and_tile, tile_y, tile;
		const Uint32 *src;

		if (unzoomed) { /* same result as the general path below, without the table */
			tile_y = sprite_line & 0x0f;
			tile = (sprite_line >> 4) & 0x1f;
			goto have_tile;
		}
		if (invert) zoom_line ^= 0xff;
		if (size > 0x20) {
			zoom_line %= (zoom_y + 1) << 1;
			if (zoom_line > zoom_y) {
				zoom_line = ((zoom_y + 1) << 1) - 1 - zoom_line;
				invert = !invert;
			}
		}
		y_and_tile = memory.ng_lo[(zoom_y << 8) | zoom_line];
		tile_y = y_and_tile & 0x0f;
		tile = y_and_tile >> 4;
		if (invert) {
			tile_y ^= 0x0f;
			tile ^= 0x1f;
		}
have_tile:
		if (tile != cur_tile) { /* consecutive lines usually stay in the same tile */
			Uint32 code;
			cur_tile = tile;
			attr = vram[(sprite << 6) | (tile << 1) | 1];
			code = ((attr << 12) & 0x70000) | vram[(sprite << 6) | (tile << 1)];
			if (animate) {
				if (attr & 0x08) code = (code & ~7) | (snap_frame_counter & 7);
				else if (attr & 0x04) code = (code & ~3) | (snap_frame_counter & 3);
			}
			code &= tile_mask;
			visible = code < memory.nb_of_tiles && PEN_USAGE(code) != TILE_INVISIBLE;
			if (!visible) continue;
			if (memory.vid.spr_cache.data)
				tile_data = (const Uint32 *) (get_cached_sprite_ptr(code) + ((code & (tiles_per_slot - 1)) << 7));
			else
				tile_data = (const Uint32 *) (memory.rom.tiles.p + (code << 7));
			pal = &snap_pal[(attr >> 8) << 4];
		}
		if (!visible) continue;
		if (attr & 0x02) tile_y ^= 0x0f; /* y flip */

		src = tile_data + (tile_y << 1);
		if (!(src[0] | src[1])) continue;
		if (fast)
			put_row16(cv + x * XSTEP - line, src[0], src[1], pal, attr & 0x01);
		else if (inside)
			put_row_zoomed_in(cv + x * XSTEP - line, zoom_x, src[0], src[1], pal, attr & 0x01);
		else
			put_row_zoomed(cv - line, x, zoom_x, src[0], src[1], pal, attr & 0x01);
	}
}

/* Sprites in drawing order with the visible lines they cover (at most two runs each: the 512-line
 * space wraps), found once per frame by prepare_sprites; each band draws the runs it crosses. */
typedef struct {
	short sprite, first, last, y, x;
	Uint8 zoom_x, zoom_y, size;
} SpriteRun;
#define MAX_RUNS 4096 /* two a sprite, more with raster effects */
static SpriteRun runs[MAX_RUNS];
static int nruns;

/* Adds the run's part within lines a..b-1 */
static void add_run(int sprite, int first, int last, int y, int x, int zoom_x, int zoom_y, int size, int a, int b) {
	SpriteRun *r;
	if (first < a) first = a;
	if (last > b) last = b;
	if (first >= last || nruns == MAX_RUNS) return;
	r = &runs[nruns++];
	r->sprite = sprite;
	r->first = first;
	r->last = last;
	r->y = y;
	r->x = x;
	r->zoom_x = zoom_x;
	r->zoom_y = zoom_y;
	r->size = size;
}

/* Raster effects. Games move sprites in IRQ2 handlers while the picture is drawn: Neo Turf
 * Masters shifts the water and the hills a little every two lines. As MAME, which draws the lines
 * above at every IRQ2, a write shows from the line of the last IRQ2 before it. The emulator logs
 * the SCB2-SCB4 writes (sprite zoom, y, x) after the first IRQ2 in a frame; the snapshot keeps the
 * frame's end, and prepare_sprites draws the sprite chains the log touches segment by segment. */
#define RASTER_WRITES 2048
typedef struct {
	Uint16 line, addr, old, val;
} RasterWrite;
static RasterWrite raster_log[RASTER_WRITES], snap_raster[RASTER_WRITES];
static int nraster, snap_nraster; /* RASTER_WRITES + 1: too many, the frame is drawn without */
int raster_from;

void video_raster_reset(void) {
	raster_from = 0;
	nraster = 0;
}

/* An IRQ2 before line (counted from VBlank, 0..264, as neo_run_frame's current_line) */
void video_raster_irq(int line) {
	int at = (line + 240) % 264; /* the frame starts at MAME's line 240 */
	if (at >= LAST_LINE || at < FIRST_LINE) at = FIRST_LINE; /* before the visible lines */
	if (at > raster_from) raster_from = at;
}

void video_raster_write(Uint32 addr, Uint16 old, Uint16 val) {
	RasterWrite *w;
	if (nraster >= RASTER_WRITES) {
		nraster = RASTER_WRITES + 1;
		return;
	}
	w = &raster_log[nraster++];
	w->line = raster_from;
	w->addr = addr;
	w->old = old;
	w->val = val;
}

/* Adds the runs of sprites begin..end-1 (begin starting a chain) within lines a..b-1, from the
 * SCB2-SCB4 words scb (scb[0] is video RAM word 0x8000); with skip, not those it marks. */
static void walk_sprites(const Uint16 *scb, int begin, int end, int a, int b, const Uint8 *skip) {
	int x = 0, y = 0, zoom_x = 0, zoom_y = 0, size = 0;
	int sprite;

	for (sprite = begin; sprite < end; sprite++) {
		int y_control = scb[0x200 + sprite];
		int zoom_control = scb[sprite];
		int height, off, n, start;

		if (y_control & 0x40) { /* sticky: chain to the right of the previous sprite */
			x = (x + zoom_x + 1) & 0x1ff;
			zoom_x = (zoom_control >> 8) & 0x0f;
		} else {
			y = 0x200 - (y_control >> 7);
			x = scb[0x400 + sprite] >> 7;
			zoom_y = zoom_control & 0xff;
			zoom_x = (zoom_control >> 8) & 0x0f;
			size = y_control & 0x3f;
		}
		if (size == 0 || (skip && skip[sprite])) continue;
		if (x >= 320 && x < 0x1f0) continue; /* fully off screen to the right */

		/* The sprite covers lines y .. y+height-1 of the 512-line space (all of it for size >= 0x20).
		 * Its intersection with the visible lines is at most two runs. */
		height = (size > 0x20 ? 0x20 : size) << 4;
		off = (FIRST_LINE - y) & 0x1ff; /* sprite line shown on the first visible line */
		n = 0;
		if (off < height) {
			n = height - off;
			if (n > LAST_LINE - FIRST_LINE) n = LAST_LINE - FIRST_LINE;
			add_run(sprite, FIRST_LINE, FIRST_LINE + n, y, x, zoom_x, zoom_y, size, a, b);
		}
		start = y & 0x1ff;
		if (start >= FIRST_LINE + n && start < LAST_LINE) {
			int stop = start + height;
			if (stop > LAST_LINE) stop = LAST_LINE;
			add_run(sprite, start, stop, y, x, zoom_x, zoom_y, size, a, b);
		}
	}
}

/* Puts the runs back in sprite order (the drawing order) after the raster segments */
static void sort_runs(void) {
	static SpriteRun sorted[MAX_RUNS];
	static unsigned short at[MAX_SPRITES + 1];
	int i;
	memset(at, 0, sizeof at);
	for (i = 0; i < nruns; i++) at[runs[i].sprite + 1]++;
	for (i = 1; i <= MAX_SPRITES; i++) at[i] += at[i - 1];
	for (i = 0; i < nruns; i++) sorted[at[runs[i].sprite]++] = runs[i];
	memcpy(runs, sorted, nruns * sizeof *runs);
}

/* With raster writes in the snapshot: the sprite chains they touch, each split at the lines where
 * its own SCB2-SCB4 words change, the others drawn once. False when the frame has none (or too
 * many to log). */
static int prepare_raster(const Uint16 *scb) {
	static Uint16 seg[0x600];
	static Uint8 touched[MAX_SPRITES], sticky[MAX_SPRITES];
	static short span[MAX_SPRITES][2];
	int nspan = 0, i, k, s, a, first = 0, any = 0;

	if (snap_nraster == 0 || snap_nraster > RASTER_WRITES) return 0;
	memset(touched, 0, sizeof touched);
	for (s = 0; s < MAX_SPRITES; s++) sticky[s] = (scb[0x200 + s] & 0x40) != 0;
	for (i = 0; i < snap_nraster; i++) {
		const RasterWrite *w = &snap_raster[i];
		s = w->addr & 0x1ff;
		if (s >= MAX_SPRITES) continue;
		touched[s] = 1;
		if ((w->addr & 0x0600) == 0x0200 && (w->old & 0x40)) sticky[s] = 1;
	}
	/* Spans: from a sprite never sticky in the frame up to the next one, so a span holds whole
	 * chains at every line. A span is touched when one of its sprites is. */
	for (s = 0; s <= MAX_SPRITES; s++) {
		if (s == MAX_SPRITES || !sticky[s]) {
			if (any) {
				for (i = first; i < s; i++) touched[i] = 1;
				span[nspan][0] = first;
				span[nspan++][1] = s;
			}
			first = s;
			any = 0;
		}
		if (s < MAX_SPRITES && touched[s]) any = 1;
	}
	walk_sprites(scb, 0, MAX_SPRITES, FIRST_LINE, LAST_LINE, touched);

	/* the words at the first visible line: the frame's end with the writes undone; each span then
	 * redoes only its own writes, so the others' words in seg do not matter to it */
	memcpy(seg, scb, sizeof seg);
	for (i = snap_nraster - 1; i >= 0; i--) seg[snap_raster[i].addr - 0x8000] = snap_raster[i].old;
	for (k = 0; k < nspan; k++) {
		const int f = span[k][0], e = span[k][1];
		for (a = FIRST_LINE, i = 0;; i++) {
			const RasterWrite *w;
			while (i < snap_nraster && ((snap_raster[i].addr & 0x1ff) < f || (snap_raster[i].addr & 0x1ff) >= e)) i++;
			if (i == snap_nraster || snap_raster[i].line >= LAST_LINE) {
				walk_sprites(seg, f, e, a, LAST_LINE, NULL);
				break;
			}
			w = &snap_raster[i];
			if (w->line > a) {
				walk_sprites(seg, f, e, a, w->line, NULL);
				a = w->line;
			}
			seg[w->addr - 0x8000] = w->val;
		}
	}
	sort_runs();
	return 1;
}

static void prepare_sprites(void) {
	const Uint16 *scb = (const Uint16 *) snap_vram + 0x8000;

	if (!zoom_width[0]) init_zoom_cols();

	nruns = 0;
	if (!prepare_raster(scb)) walk_sprites(scb, 0, MAX_SPRITES, FIRST_LINE, LAST_LINE, NULL);
}

/* Copies the frame state the renderer reads, at the end of an emulated frame, so the frame can be
 * drawn (on the other core) while the emulator already runs the next one. */
void video_snapshot(void) {
	memcpy(snap_vram, memory.vid.ram, SNAP_VRAM_BYTES);
	memcpy(snap_pal, current_pc_pal, sizeof snap_pal);
	snap_frame_counter = neogeo_frame_counter;
	snap_irq2control = memory.vid.irq2control;
	snap_nraster = nraster;
	if (nraster <= RASTER_WRITES) memcpy(snap_raster, raster_log, nraster * sizeof *raster_log);
	snap_fix = current_fix;
	snap_fix_usage = fix_usage;
}

/* Games only keep the middle 304 of the 320 columns clean; the 8 at each side, hidden by TV
 * overscan, show sprites popping in and the backdrop. Like FinalBurn Neo, show 304x224. */
#define EDGE 8

/* Full screen: the band column shown in each of the 400 screen columns (304 stretched to 400,
 * nearest neighbour; every 25 screen columns take 19 band columns). */
static Uint16 full_col[400];

/* Fills columns first..last-1 of a band buffer with one color. */
static void fill_band(Uint16 *buf, int first, int last, Uint16 color) {
	const Uint32 c = color | ((Uint32) color << 16);
	Uint32 *col = (Uint32 *) (buf + first * XSTEP);
	int x, k;
	for (x = first; x < last; x++, col += XSTEP / 2)
		for (k = 0; k < VIDEO_BAND_LINES / 2; k++) col[k] = c;
}

/* 1:1, the 320x224 picture centered on the 400x240 screen: each band column goes to screen
 * column 40 + x, 14 pixels from row index 218 - 14 * band up (the screen's row 21 + 14 * band is
 * the band's bottom line). */
static void band_out(const Uint16 *buf, Uint16 *fb, int band) {
	const Uint32 *s = (const Uint32 *) buf;
	Uint32 *d = (Uint32 *) (fb + 40 * 240 + 218 - VIDEO_BAND_LINES * band);
	int x;
	for (x = 0; x < 320; x++, s += XSTEP / 2, d += 240 / 2) {
		d[0] = s[0], d[1] = s[1], d[2] = s[2], d[3] = s[3];
		d[4] = s[4], d[5] = s[5], d[6] = s[6];
	}
}

/* Full screen: the 14 band lines become 15 screen rows (224 to 240, the 8th line shown twice),
 * from row index 225 - 15 * band up. That start alternates between odd and even, so the 15
 * pixels are written as a halfword and seven words, or seven words and a halfword. */
static void band_out_full(const Uint16 *buf, Uint16 *fb, int band) {
	const int odd = !(band & 1); /* 225 - 15 * band is odd */
	Uint16 *d = fb + 225 - 15 * band;
	int x;
	for (x = 0; x < 400; x++, d += 240) {
		const Uint32 *s = (const Uint32 *) (buf + full_col[x] * XSTEP);
		const Uint32 w0 = s[0], w1 = s[1], w2 = s[2], w3 = s[3], w4 = s[4], w5 = s[5], w6 = s[6];
		const int twice = x + 1 < 400 && full_col[x + 1] == full_col[x];
		int k;
		for (k = 0; k <= twice; k++) {
			Uint16 *const p = d + k * 240;
			if (odd) {
				Uint32 *const q = (Uint32 *) (p + 1);
				p[0] = w0;
				q[0] = (w0 >> 16) | (w1 << 16), q[1] = (w1 >> 16) | (w2 << 16), q[2] = (w2 >> 16) | (w3 << 16);
				q[3] = w3, q[4] = w4, q[5] = w5, q[6] = w6;
			} else {
				Uint32 *const q = (Uint32 *) p;
				q[0] = w0, q[1] = w1, q[2] = w2, q[3] = (w3 & 0xffff) | (w3 << 16);
				q[4] = (w3 >> 16) | (w4 << 16), q[5] = (w4 >> 16) | (w5 << 16), q[6] = (w5 >> 16) | (w6 << 16);
				p[14] = w6 >> 16;
			}
		}
		if (twice) x++, d += 240;
	}
}

/* Per-frame setup from the last snapshot, before any band is drawn. */
void video_prepare(void) {
	if (!full_col[399]) {
		int x;
		for (x = 0; x < 400; x++) full_col[x] = EDGE + (2 * x + 1) * 304 / 800;
	}
	prepare_sprites();
	prepare_fix();
}

/* Draws one band of the last snapshot into buf (VIDEO_BAND_PIXELS, 32-byte aligned) and writes it
 * to fb, the 400x240 rotated top-screen framebuffer, 1:1 or stretched to the full screen. Bands
 * may be drawn in any order and on both cores at once, each with its own buf. */
void video_band(int band, Uint16 *buf, Uint16 *fb, int full) {
	const Uint16 *vram = (const Uint16 *) snap_vram;
	const int first = FIRST_LINE + VIDEO_BAND_LINES * band, last = first + VIDEO_BAND_LINES;
	Uint16 *const cv = buf + last - 1; /* the band's bottom line is index 0 of each column */
	int i;

	fill_band(buf, EDGE, 320 - EDGE, snap_pal[4095]); /* backdrop color */
	for (i = 0; i < nruns; i++) {
		const SpriteRun *r = &runs[i];
		if (r->first < last && r->last > first)
			draw_sprite_lines(cv, r->sprite, r->first > first ? r->first : first, r->last < last ? r->last : last,
					r->y, r->x, r->zoom_x, r->zoom_y, r->size, vram);
	}
	draw_fix_band(cv, first, last);
	if (full) band_out_full(buf, fb, band);
	else {
		fill_band(buf, 0, EDGE, 0); /* black edges */
		fill_band(buf, 320 - EDGE, 320, 0);
		band_out(buf, fb, band);
	}
}

/* Draws the last snapshot 1:1 into fb on this core alone. */
void video_render(Uint16 *fb) {
	static Uint16 buf[VIDEO_BAND_PIXELS] __attribute__((aligned(32)));
	int band;
	video_prepare();
	for (band = 0; band < VIDEO_BANDS; band++) video_band(band, buf, fb, 0);
}

void draw_screen(void) {
	screen_frame_end();
}

void draw_screen_scanline(int start_line, int end_line, int refresh) {
	int sx = 0, sy = 0, my = 0, zx = 1, zy = 1;
	int offs, count, y;
	int tileno, tileatr;
	int tctl1, tctl2, tctl3;
	unsigned char *vidram = memory.vid.ram;
	static SDL_Rect clear_rect;
	int yy;
	int otile, tile, yoffs;
	int zoom_line;
	int invert;
	Uint8 *zoomy_rom;
	Uint8 penusage;

	if (start_line > 255) start_line = 255;
	if (end_line > 255) end_line = 255;

	clear_rect.x = visible_area.x;
	clear_rect.w = visible_area.w;
	clear_rect.y = start_line;
	clear_rect.h = end_line - start_line + 1;


	SDL_FillRect(buffer, &clear_rect, current_pc_pal[4095]);

	/* Draw sprites */
	for (count = 0; count < 0x300; count += 2) {


		tctl3 = READ_WORD(&vidram[0x10000 + count]);
		tctl1 = READ_WORD(&vidram[0x10400 + count]);
		tctl2 = READ_WORD(&vidram[0x10800 + count]);

		/* If this bit is set this new column is placed next to last one */
		if (tctl1 & 0x40) {
			sx += zx + 1; /* new x */


			/* Get new zoom for this column */
			zx = (tctl3 >> 8) & 0x0f;
		} else { /* nope it is a new block */
			/* Sprite scaling */
			zx = (tctl3 >> 8) & 0x0f; /* zomm x */
			zy = tctl3 & 0xff; /* zoom y */

			sx = (tctl2 >> 7); /* x pos 0 - 512  */


			/* Number of tiles in this strip */
			my = tctl1 & 0x3f;

			sy = 512 - (tctl1 >> 7); /* y pos 512 - 0 */

			if (my > 0x20) my = 0x20;
		}


		/* No point doing anything if tile strip is 0 */
		if (my == 0) continue;
		if (sx >= 496) { /* after 496, we consider sx negative */
			//core_log("SX=%d\n",sx);
			sx -= 512;
			//continue;
		}

		if (sx > 320) {
			continue;
			//sx-=16;
			//core_log("SX=%d\n",sx);
		}

		if (sx<-16) continue;
		//sx&=0x1ff;

		/* Process x zoom */
		if (zx != 16) {
			dda_x_skip = ddaxskip[zx];
		} else zx = 16;



		offs = count << 6;
		zoomy_rom = memory.ng_lo + (zy << 8);

		otile = -1;
		for (yy = start_line; yy <= end_line; yy++) {
			y = yy - sy; /* y: 0 -> my*16 */

			if (y < 0) y += 512;

			if (y >= (my << 4)) continue;

			invert = 0;

			zoom_line = y & 0xff;

			if (y & 0x100) {
				zoom_line ^= 0xff; /* zoom_line = 255 - zoom_line */
				invert = 1;
			}

			if (my == 0x20) /* fix for joyjoy, trally... */ {
				if (zy) {
					zoom_line %= (zy << 1);
					if (zoom_line >= zy) {
						zoom_line = (zy << 1) - 1 - zoom_line;
						invert ^= 1;
					}
				}
			}

			yoffs = zoomy_rom[zoom_line] & 0x0f;
			tile = zoomy_rom[zoom_line] >> 4;

			if (invert) {
				tile ^= 0x1f; // tile=31 - tile;
				yoffs ^= 0x0f; // yoffs= 15 - yoffs;
			}

			tileno = READ_WORD(&vidram[offs + (tile << 2)]);
			tileatr = READ_WORD(&vidram[offs + (tile << 2) + 2]);

			if (memory.nb_of_tiles > 0x10000 && (tileatr & 0x10)) tileno += 0x10000;
			if (memory.nb_of_tiles > 0x20000 && (tileatr & 0x20)) tileno += 0x20000;
			if (memory.nb_of_tiles > 0x40000 && (tileatr & 0x40)) tileno += 0x40000;

			/* animation automatique */
			if (tileatr & 0x8) tileno = (tileno&~7)+((tileno + neogeo_frame_counter)&7);
			else if (tileatr & 0x4) tileno = (tileno&~3)+((tileno + neogeo_frame_counter)&3);
			if (tileatr & 0x02) yoffs ^= 0x0f; /* flip y */

			penusage = PEN_USAGE(tileno);
			if (memory.vid.spr_cache.data) {
				memory.rom.tiles.p = get_cached_sprite_ptr(tileno);
				tileno = (tileno & ((memory.vid.spr_cache.slot_size >> 7) - 1));
			}

			switch (penusage) {
#ifdef I386_ASM
					mem_gfx = &memory.rom.tiles.p;
				case TILE_NORMAL:
					draw_scanline_tile_i386_norm(tileno, yoffs, sx + 16, yy, zx, tileatr >> 8,
							tileatr & 0x01, (unsigned char*) buffer->pixels);
					break;
				case TILE_TRANSPARENT50:
					draw_scanline_tile_i386_50(tileno, yoffs, sx + 16, yy, zx, tileatr >> 8,
							tileatr & 0x01, (unsigned char*) buffer->pixels);
					break;
				case TILE_TRANSPARENT25:
					draw_scanline_tile_25(tileno, yoffs, sx + 16, yy, zx, tileatr >> 8,
							tileatr & 0x01, (unsigned char*) buffer->pixels);
					break;
#else
				case TILE_NORMAL:
					draw_scanline_tile(tileno, yoffs, sx + 16, yy, zx, tileatr >> 8,
							tileatr & 0x01, (unsigned char*) buffer->pixels);
					break;
				case TILE_TRANSPARENT50:
					draw_scanline_tile_50(tileno, yoffs, sx + 16, yy, zx, tileatr >> 8,
							tileatr & 0x01, (unsigned char*) buffer->pixels);
					break;
				case TILE_TRANSPARENT25:
					draw_scanline_tile_25(tileno, yoffs, sx + 16, yy, zx, tileatr >> 8,
							tileatr & 0x01, (unsigned char*) buffer->pixels);
					break;
#endif
			}


		}
	} /* for count */

	if (refresh) {

		if (conf.do_message) {
			SDL_textout(buffer, visible_area.x, visible_area.h + visible_area.y - 13, conf.message);
			conf.do_message--;
		}
		if (conf.show_fps)
			SDL_textout(buffer, visible_area.x, visible_area.y, fps_str);
		screen_update();
	}
}

void init_video(void) {
#ifdef PROCESSOR_ARM
	if (!mem_gfx) {
		mem_gfx = memory.rom.tiles.p;
	}
	if (!mem_video) {
		mem_video = memory.vid.ram;
	}
#elif I386_ASM
	mem_gfx = &memory.rom.tiles.p;
	mem_video = memory.vid.ram;
#endif
	fix_value_init();
	memory.vid.modulo = 1;
}
