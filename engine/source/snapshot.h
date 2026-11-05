// Game pictures for the launcher's list, taken by the console itself and kept on the SD card.
#ifndef NEO3DS_SNAPSHOT_H
#define NEO3DS_SNAPSHOT_H

#include <3ds.h>
#include <stdbool.h>

/* A whole top screen: 400 columns of 240 RGB565 pixels, as in its framebuffer. */
enum { SNAPSHOT_BYTES = 400 * 240 * 2 };

/* pack_name is the .neo3ds file's name. A picture the player took (manual) is not replaced by one
 * taken on leaving a game. False if nothing was written; pictures of one color are not kept. */
bool snapshot_save(const char *pack_name, const u16 *pixels, bool manual);

/* False when the game has no picture. */
bool snapshot_load(const char *pack_name, u16 *pixels);

#endif
