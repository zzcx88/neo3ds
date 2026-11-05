// The launcher's receive screen: gets a .neo3ds file from the PC over the local network.
#ifndef NEO3DS_RECEIVE_H
#define NEO3DS_RECEIVE_H

#include <stdbool.h>

/* Runs the screen until the player leaves it. True when a game file was saved: the list must be
 * read again. The screens are left for the caller to redraw. */
bool receive_run(void);

/* True once the HOME menu or sleep came up during the screen: a transfer or the camera stops. */
bool receive_interrupted(void);

/* At the launcher's start: clears what a receive cut short by a crash or power loss left behind. */
void receive_recover(void);

/* The launcher's Y button and the receive screen: off until the converter can send .neo3ds files. */
#if defined(NEO3DS_RECEIVE) || defined(NEO3DS_RECV_TEST)
#define HAS_RECEIVE 1
#else
#define HAS_RECEIVE 0
#endif

#endif
