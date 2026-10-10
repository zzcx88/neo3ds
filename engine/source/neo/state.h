/* Save states are not implemented in neo3ds yet; keep the names the core uses. */
#ifndef _STATE_H_
#define _STATE_H_
#include "zlib.h"
#include "SDL.h"
#define STREAD  0
#define STWRITE 1
static inline int mkstate_data(gzFile gzf, void *data, int size, int mode) {
	(void)gzf; (void)data; (void)size; (void)mode;
	return 0;
}
#endif
