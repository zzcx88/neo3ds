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

#endif
