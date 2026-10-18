#ifndef NEO3DS_AUDIO_H
#define NEO3DS_AUDIO_H

#include <stdbool.h>

bool audio_init(int rate);
void audio_exit(void);

/* Main core: YM2610 port traffic from the Z80 (port 0-3 as in YM2610Write) */
void audio_ym_write(int port, int data);
void audio_ym_reset(void);
unsigned char audio_adpcm_status(void);

/* End of each emulated frame: audio_end_frame on the main core while core 1 is idle, then
 * audio_render on core 1. */
void audio_end_frame(int rate);
void audio_render(void);

/* When the 3DS falls behind, the Z80 and the sound chip run a frame on their own before the 68k's
 * frame (neo_glue.c), as the sound board keeps its tempo while a game slows down on hardware:
 * audio_behind() says when, audio_next_part() goes between the two in the same log. */
bool audio_behind(void);
void audio_state_loaded(void);
void audio_next_part(void);
extern unsigned audio_catchups, audio_drops;

#endif
