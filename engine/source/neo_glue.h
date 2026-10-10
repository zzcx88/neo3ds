#ifndef NEO3DS_GLUE_H
#define NEO3DS_GLUE_H

#include <stdbool.h>
#include "SDL.h"

void neo_init(void);
void neo_set_input(Uint8 p1, Uint8 p2, Uint8 start, Uint8 coin);
void neo_run_frame(bool render);

extern int neo_watchdog_resets;

#endif
