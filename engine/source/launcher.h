// The launcher's game list (see launcher.c).
#ifndef NEO3DS_LAUNCHER_H
#define NEO3DS_LAUNCHER_H

#include <stdbool.h>
#include <stddef.h>

/* Shows the list until a game is picked (its .neo3ds path in path) or the app is closed (false). */
bool launcher_pick(char *path, size_t size);

#endif
