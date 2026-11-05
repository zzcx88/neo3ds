// The launcher's receive screen: gets a .neo3ds file from the PC over the local network.
#ifndef NEO3DS_RECEIVE_H
#define NEO3DS_RECEIVE_H

#include <stdbool.h>

/* Runs the screen until the player leaves it. True when a game file was saved: the list must be
 * read again. The screens are left for the caller to redraw. */
bool receive_run(void);

#endif
