/* Minimal SDL 1.2 surface/type shim so the gngeo core builds on 3DS without SDL.
 * Only what the core touches is provided; drawing goes to an RGB565 buffer. */
#ifndef NEO3DS_SDL_SHIM_H
#define NEO3DS_SDL_SHIM_H

#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef uint8_t Uint8;
typedef int8_t Sint8;
typedef uint16_t Uint16;
typedef int16_t Sint16;
typedef uint32_t Uint32;
typedef int32_t Sint32;
typedef uint64_t Uint64;
typedef int64_t Sint64;

#define SDL_Swap16(x) __builtin_bswap16(x)
#define SDL_Swap32(x) __builtin_bswap32(x)

typedef struct SDL_Rect {
	Sint16 x, y;
	Uint16 w, h;
} SDL_Rect;

typedef struct SDL_Surface {
	int w, h;
	int pitch; /* bytes */
	void *pixels;
	SDL_Rect clip;
} SDL_Surface;

typedef struct SDL_Joystick SDL_Joystick;

#define SDLK_LAST 512

static inline void SDL_SetClipRect(SDL_Surface *s, const SDL_Rect *r) {
	if (r) s->clip = *r;
	else {
		s->clip.x = s->clip.y = 0;
		s->clip.w = s->w;
		s->clip.h = s->h;
	}
}

static inline int SDL_FillRect(SDL_Surface *s, SDL_Rect *r, Uint32 color) {
	int x0 = 0, y0 = 0, w = s->w, h = s->h;
	if (r) {
		x0 = r->x; y0 = r->y; w = r->w; h = r->h;
	}
	if (x0 < 0) { w += x0; x0 = 0; }
	if (y0 < 0) { h += y0; y0 = 0; }
	if (x0 + w > s->w) w = s->w - x0;
	if (y0 + h > s->h) h = s->h - y0;
	if (w <= 0 || h <= 0) return 0;
	Uint16 c = (Uint16)color;
	Uint32 c2 = c | ((Uint32)c << 16);
	for (int y = y0; y < y0 + h; y++) {
		Uint16 *row = (Uint16 *)((Uint8 *)s->pixels + y * s->pitch) + x0;
		int x = 0;
		if (((uintptr_t)row & 2) && w > 0) { row[0] = c; x = 1; }
		for (; x + 1 < w; x += 2) *(Uint32 *)&row[x] = c2;
		if (x < w) row[x] = c;
	}
	return 0;
}

static inline int SDL_LockSurface(SDL_Surface *s) { (void)s; return 0; }
static inline void SDL_UnlockSurface(SDL_Surface *s) { (void)s; }
static inline void SDL_textout(SDL_Surface *s, int x, int y, const char *t) { (void)s; (void)x; (void)y; (void)t; }

#endif
