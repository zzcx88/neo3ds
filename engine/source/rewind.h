// Rewind: the last few in-memory states of the running game (see rewind.c).
#ifndef NEO3DS_REWIND_H
#define NEO3DS_REWIND_H

#include <stdbool.h>

void rewind_init(void);  /* after the game is loaded: sizes the ring from one measured state */
void rewind_free(void);
void rewind_reset(void); /* the game restarted: the states before it are gone */
void rewind_capture(void); /* at the end of a frame, with core 1 idle */
void rewind_capture_now(void); /* the same, ignoring the two-frame cadence */
bool rewind_ready(void);  /* false when the ring could not be allocated: the button says so */
bool rewind_step_back(void); /* back to the oldest state kept; false when there is none */

#endif
