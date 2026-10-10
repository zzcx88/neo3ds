/* Host framebuffer the gngeo renderer draws into (RGB565, 512x256; the visible 320x224 starts at 16,16). */
#ifndef _SCREEN_H_
#define _SCREEN_H_
#include "SDL.h"
extern SDL_Surface *buffer;
extern SDL_Rect visible_area;
void screen_update(void);
/* Called by draw_screen at the end of every emulated frame. */
void screen_frame_end(void);
#endif
