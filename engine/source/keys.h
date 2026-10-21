// Button mapping: which Neo Geo inputs each 3DS button presses, saved per game on the SD card.
#ifndef NEO3DS_KEYS_H
#define NEO3DS_KEYS_H

#include <3ds.h>
#include <stdbool.h>
#include <stddef.h>

/* Neo Geo inputs as returned by keys_neo */
enum { NEO_A = 1, NEO_B = 2, NEO_C = 4, NEO_D = 8, NEO_START = 16, NEO_COIN = 32 };

extern u32 keys_turbo; /* 3DS button with turbo, 0 = off */
extern bool keys_full_screen; /* the picture stretched to the whole top screen instead of 1:1 */
/* The BIOS to run, saved with the keys: 1 for the arcade (MVS) BIOS, 0 for the home (AES) one. */
int keys_bios_mvs(void);

void keys_load(void);
bool keys_save(void);
/* The Neo Geo inputs pressed by the held 3DS buttons (directions are not included). */
unsigned keys_neo(u32 held);
/* True when R is free to be the turbo modifier (R + button). */
bool keys_r_free(void);
const char *keys_button_name(u32 key);
/* The mapped buttons for the main screen, in A B X Y L R ZL ZR START SELECT order; START and
 * SELECT are left out while they are Start and Coin. Returns the count. */
typedef struct { const char *button; unsigned bits; } KeyEntry;
int keys_mapped(KeyEntry *out, int max);
/* Main screen shortcuts, saved at once: turbo off -> A -> B -> X -> Y, and the BIOS. */
void keys_cycle_turbo(void);
void keys_set_bios_mvs(int mvs);
/* The key config screen. Blocks until the player leaves it; the game is paused meanwhile. */
void keys_menu(void);

#endif
