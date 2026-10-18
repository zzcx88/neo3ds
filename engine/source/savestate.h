// Quick save states: three slots per game in sdmc:/3ds/neo3ds/states/<title id>.<slot> (see savestate.c).
#ifndef NEO3DS_SAVESTATE_H
#define NEO3DS_SAVESTATE_H

#include <stdbool.h>
#include <stddef.h>

enum { STATE_SLOTS = 3 };
typedef enum { STATE_OK, STATE_EMPTY, STATE_OTHER_BUILD, STATE_IO_ERROR } StateResult;

/* Between frames, with core 1 idle (main.c) */
StateResult savestate_save(int slot);
StateResult savestate_load(int slot);
/* The board a slot was saved on (0 AES, 1 MVS), or -1 when it can't be loaded. */
int savestate_board(int slot);
/* "Slot 2: 10-18 14:05" or "Slot 2: empty", for the status line */
void savestate_describe(int slot, char *out, size_t size);

/* For the modules' *_state() functions: copies n bytes to or from the file being written or read. */
void st_bytes(void *p, size_t n);
bool st_reading(void);

#endif
