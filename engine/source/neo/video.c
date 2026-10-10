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


static ZSTD_DCtx *zstd_ctx; /* only the render thread decompresses */

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

Uint8 *get_cached_sprite_ptr(Uint32 tileno) {
	GFX_CACHE *gcache = &memory.vid.spr_cache;
	static int pos = 0;
	Uint32 bank = tileno / (gcache->slot_size >> 7);
	Uint8 *slot;
	int a;

	if (gcache->ptr[bank])
		return gcache->ptr[bank];

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
	gcache->ptr[bank] = slot;
	gcache->usage[a] = bank;
	gcache->misses++;
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

#define fix_add(x, y) ((((READ_WORD(memory.vid.ram + 0xEA00 + (((y-1)&31)*2 + 64 * (x/6))) >> (5-(x%6))*2) & 3) ^ 3))

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

/* The renderer draws straight into the 3DS top framebuffer, which is the screen rotated: 400
 * columns of 240 pixels, each column stored bottom row first. Moving one pixel right is +XSTEP,
 * one line down is -1. canvas points at visible column 0, scanline 0 (scanlines 16..239 are
 * visible), with the 320x224 picture centered on the 400x240 screen. */
#define XSTEP 240
static Uint16 *canvas;
#define CANVAS(fb) ((fb) + ((400 - 320) / 2) * XSTEP + (240 - (240 - 224) / 2 - 1) + 16)

static __inline__ void draw_fix_char(unsigned char *buf, int start, int end) {
	unsigned int *gfxdata, myword;
	int x, y, yy;
	unsigned char col;
	unsigned short *br;
	unsigned int *paldata;
	unsigned int byte1, byte2;
	int banked, garouoffsets[32];
	SDL_Rect clip;
	int ystart = 2, yend = 30; /* fix rows on visible scanlines 16..239 */

	//banked = (snap_fix == memory.rom.game_sfix.p && memory.rom.game_sfix.size > 0x1000) ? 1 : 0;
	banked = (snap_fix == memory.rom.game_sfix.p && neogeo_fix_bank_type && memory.rom.game_sfix.size > 0x1000) ? 1 : 0;
	//if (banked && conf.rom_type==MVS_CMC42)
	if (banked && neogeo_fix_bank_type == 1) {
		int garoubank = 0;
		int k = 0;
		y = 0;

		while (y < 32) {
			if (READ_WORD(&snap_vram[0xea00 + (k << 1)]) == 0x0200 &&
					(READ_WORD(&snap_vram[0xeb00 + (k << 1)]) & 0xff00) == 0xff00) {

				garoubank = READ_WORD(&snap_vram[0xeb00 + (k << 1)]) & 3;
				garouoffsets[y++] = garoubank;
			}
			garouoffsets[y++] = garoubank;
			k += 2;
		}
	}

	if (start != 0 && end != 0) {
		ystart = start >> 3;
		yend = (end >> 3) + 1;
		if (ystart < 1) ystart = 1;
		clip.x = 0;
		clip.y = start + 16;
		clip.w = buffer->w;
		clip.h = (end - start) + 16;
		SDL_SetClipRect(buffer, &clip);
	}

	for (y = ystart; y < yend; y++)
		for (x = 1; x < 39; x++) {
			byte1 = (READ_WORD(&snap_vram[0xE000 + ((y + (x << 5)) << 1)]));
			byte2 = byte1 >> 12;
			byte1 = byte1 & 0xfff;

			if (banked) {
				switch (neogeo_fix_bank_type) {
					case 1:
						/* Garou, MSlug 3 */
						byte1 += 0x1000 * (garouoffsets[(y - 2)&31] ^ 3);
						break;
					case 2:
						byte1 += 0x1000 * fix_add(x, y);
						break;
				}
			}

			if ((byte1 >= (memory.rom.game_sfix.size >> 5)) || (snap_fix_usage[byte1] == 0x00)) continue;

			br = canvas + (x << 3) * XSTEP - (y << 3);
#ifdef PROCESSOR_ARM
			draw_one_char_arm(byte1, byte2, br);
#elif I386_ASM
			draw_one_char_i386(byte1, byte2, br);
#else
			paldata = (unsigned int *) &snap_pal[16 * byte2];
			gfxdata = (unsigned int *) &snap_fix[ byte1 << 5];

			for (yy = 0; yy < 8; yy++) {
				myword = gfxdata[yy];
				col = (myword >> 28)&0xf;
				if (col) br[7 * XSTEP] = paldata[col];
				col = (myword >> 24)&0xf;
				if (col) br[6 * XSTEP] = paldata[col];
				col = (myword >> 20)&0xf;
				if (col) br[5 * XSTEP] = paldata[col];
				col = (myword >> 16)&0xf;
				if (col) br[4 * XSTEP] = paldata[col];
				col = (myword >> 12)&0xf;
				if (col) br[3 * XSTEP] = paldata[col];
				col = (myword >> 8)&0xf;
				if (col) br[2 * XSTEP] = paldata[col];
				col = (myword >> 4)&0xf;
				if (col) br[1 * XSTEP] = paldata[col];
				col = (myword >> 0)&0xf;
				if (col) br[0 * XSTEP] = paldata[col];
				br--;
			}
#endif

		}
	if (start != 0 && end != 0) SDL_SetClipRect(buffer, NULL);
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
static void draw_sprite_tiles(int sprite, int first, int last, int y, int x, const Uint16 *vram) {
	Uint16 *const col = canvas + x * XSTEP;
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

static void draw_sprite_lines(int sprite, int first, int last, int y, int x, int zoom_x, int zoom_y,
		int size, const Uint16 *vram) {
	const int animate = !(snap_irq2control & 0x08);
	const int fast = zoom_x == 15 && x <= 320 - 16;
	/* With zoom 0xff the size > 0x20 wrap-around never changes the line, so it needs no check. */
	const int unzoomed = zoom_y == 0xff && lo_identity;
	const int tiles_per_slot = memory.vid.spr_cache.slot_size >> 7;
	int line, cur_tile = -1, attr = 0, visible = 0;
	const Uint32 *tile_data = NULL;
	const Uint32 *pal = NULL;

	if (unzoomed && fast) {
		draw_sprite_tiles(sprite, first, last, y, x, vram);
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
			put_row16(canvas + x * XSTEP - line, src[0], src[1], pal, attr & 0x01);
		else
			put_row_zoomed(canvas - line, x, zoom_x, src[0], src[1], pal, attr & 0x01);
	}
}

static void draw_sprites(void) {
	const Uint16 *vram = (const Uint16 *) snap_vram;
	int x = 0, y = 0, zoom_x = 0, zoom_y = 0, size = 0;
	int sprite;

	if (!zoom_width[0]) init_zoom_cols();

	for (sprite = 0; sprite < MAX_SPRITES; sprite++) {
		int y_control = vram[0x8200 + sprite];
		int zoom_control = vram[0x8000 + sprite];
		int height, off, n, start;

		if (y_control & 0x40) { /* sticky: chain to the right of the previous sprite */
			x = (x + zoom_x + 1) & 0x1ff;
			zoom_x = (zoom_control >> 8) & 0x0f;
		} else {
			y = 0x200 - (y_control >> 7);
			x = vram[0x8400 + sprite] >> 7;
			zoom_y = zoom_control & 0xff;
			zoom_x = (zoom_control >> 8) & 0x0f;
			size = y_control & 0x3f;
		}
		if (size == 0) continue;
		if (x >= 320 && x < 0x1f0) continue; /* fully off screen to the right */

		/* The sprite covers lines y .. y+height-1 of the 512-line space (all of it for size >= 0x20).
		 * Its intersection with the visible lines is at most two runs. */
		height = (size > 0x20 ? 0x20 : size) << 4;
		off = (FIRST_LINE - y) & 0x1ff; /* sprite line shown on the first visible line */
		n = 0;
		if (off < height) {
			n = height - off;
			if (n > LAST_LINE - FIRST_LINE) n = LAST_LINE - FIRST_LINE;
			draw_sprite_lines(sprite, FIRST_LINE, FIRST_LINE + n, y, x, zoom_x, zoom_y, size, vram);
		}
		start = y & 0x1ff;
		if (start >= FIRST_LINE + n && start < LAST_LINE) {
			int end = start + height;
			if (end > LAST_LINE) end = LAST_LINE;
			draw_sprite_lines(sprite, start, end, y, x, zoom_x, zoom_y, size, vram);
		}
	}
}

/* Copies the frame state the renderer reads, at the end of an emulated frame, so the frame can be
 * drawn (on the other core) while the emulator already runs the next one. */
void video_snapshot(void) {
	memcpy(snap_vram, memory.vid.ram, SNAP_VRAM_BYTES);
	memcpy(snap_pal, current_pc_pal, sizeof snap_pal);
	snap_frame_counter = neogeo_frame_counter;
	snap_irq2control = memory.vid.irq2control;
	snap_fix = current_fix;
	snap_fix_usage = fix_usage;
}

/* Fills the visible picture with the backdrop color (palette entry 4095). */
/* Games only keep the middle 304 of the 320 columns clean; the 8 at each side, hidden by TV
 * overscan, show sprites popping in and the backdrop. Like FinalBurn Neo, show 304x224. */
#define EDGE 8

static void fill_columns(int first, int last, Uint16 color) {
	const Uint32 c = color | ((Uint32) color << 16);
	int x, k;
	for (x = first; x < last; x++) {
		Uint32 *col = (Uint32 *) (canvas + x * XSTEP - (LAST_LINE - 1)); /* 224 pixels, bottom first */
		for (k = 0; k < 224 / 2; k++) col[k] = c;
	}
}

/* Draws the last snapshot into fb, the 400x240 rotated top-screen framebuffer. */
void video_render(Uint16 *fb) {
	canvas = CANVAS(fb);
	fill_columns(EDGE, 320 - EDGE, snap_pal[4095]); /* backdrop color */
	draw_sprites();
	draw_fix_char(NULL, 0, 0);
	fill_columns(0, EDGE, 0); /* black edges */
	fill_columns(320 - EDGE, 320, 0);
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
		draw_fix_char(buffer->pixels, 0, 0);

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
