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

#ifndef _VIDEO_H_
#define _VIDEO_H_

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include "SDL.h"

/* neo3ds: sprite tiles live in RAM as compressed blocks (packed/offset)
 * and are decompressed on demand into a fixed pool of slots. */
enum { SPR_CODEC_LZ4 = 1, SPR_CODEC_ZSTD = 2 }; /* = c.idx version */
typedef struct gfx_cache {
	int codec;          /* SPR_CODEC_* */
	Uint8 *data;        /* slot pool */
	Uint32 size;        /* bytes in the slot pool */
	Uint32 total_bank;  /* number of compressed blocks */
	Uint8 **ptr;        /* ptr[bank] -> decompressed slot, or NULL */
	int max_slot;       /* number of slots in the pool */
	int slot_size;      /* bytes per block (power of two, multiple of 128) */
	int *usage;         /* usage[slot] -> bank held by that slot, -1 if free */
	const Uint8 *packed;   /* all compressed blocks back to back */
	const Uint32 *offset;  /* total_bank+1 offsets into packed */
	Uint32 misses;      /* decompressions since last reset (profiling) */
}GFX_CACHE;

typedef struct VIDEO {
	/* Video Ram&Pal */
	Uint8 ram[0x20000];
	Uint8 pal_neo[2][0x2000];
	Uint8 pal_host[2][0x4000];
	Uint8 currentpal;
        Uint8 currentfix; /* 0=bios fix */
	Uint16 rbuf;

	/* Auto anim counter */
	Uint32 fc;
	Uint32 fc_speed;

	Uint32 vptr;
	Sint16 modulo;

	Uint32 current_line;

	/* IRQ2 related */
	Uint32 irq2control;
	Uint32 irq2taken;
	Uint32 irq2start;
	Uint32 irq2pos;

    GFX_CACHE spr_cache;
}VIDEO;

#define RASTER_LINES 261

extern unsigned int neogeo_frame_counter;
extern unsigned int neogeo_frame_counter_speed;

void init_video(void);
void debug_draw_tile(unsigned int tileno,int sx,int sy,int zx,int zy,
		     int color,int xflip,int yflip,unsigned char *bmp);
void draw_screen_scanline(int start_line, int end_line, int refresh);
void draw_screen(void);
void video_snapshot(void);
/* Tile-based renderer: 16 bands of 14 of the 224 visible lines, drawn in a band buffer of 320
 * columns of VIDEO_BAND_STRIDE pixels (see video.c). */
#define VIDEO_BANDS 16
#define VIDEO_BAND_LINES 14
#define VIDEO_BAND_STRIDE 16
#define VIDEO_BAND_PIXELS (320 * VIDEO_BAND_STRIDE)
void video_prepare(void);
void video_band(int band, Uint16 *buf, Uint16 *fb, int full);
void video_render(Uint16 *fb);
// void show_cache(void);
int init_sprite_cache(Uint32 size, Uint32 bsize, int codec, const Uint8 *packed, const Uint32 *offset, Uint32 nb_blocks);
void free_sprite_cache(void);

#endif
