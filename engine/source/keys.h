// Button mapping: which Neo Geo inputs each 3DS button presses, saved per game on the SD card.
#ifndef NEO3DS_KEYS_H
#define NEO3DS_KEYS_H

#include <3ds.h>
#include <stdbool.h>

/* Neo Geo inputs as returned by keys_neo */
enum { NEO_A = 1, NEO_B = 2, NEO_C = 4, NEO_D = 8, NEO_START = 16, NEO_COIN = 32 };

extern u32 keys_turbo; /* 3DS button with turbo, 0 = off */

void keys_load(void);
bool keys_save(void);
/* The Neo Geo inputs pressed by the held 3DS buttons (directions are not included). */
unsigned keys_neo(u32 held);
/* True when R is free to be the turbo modifier (R + button). */
bool keys_r_free(void);
const char *keys_button_name(u32 key);
/* Prints "3DS button  Neo Geo input" lines from the given console row. Returns the next row. */
int keys_print(int row);
/* The key config screen. Blocks until the player leaves it; the game is paused meanwhile. */
void keys_menu(void (*flush)(void));

#endif
