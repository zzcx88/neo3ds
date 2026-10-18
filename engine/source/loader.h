#ifndef NEO3DS_LOADER_H
#define NEO3DS_LOADER_H

#include <3ds.h>
#include <stdbool.h>
#include <stddef.h>
#include "SDL.h"

typedef void (*LoaderProgress)(const char *file, Uint32 done, Uint32 total);

// Loads romfs:/game/* into memory.rom. Returns false and sets loader_error() on failure.
bool loader_load(LoaderProgress progress, Uint32 sprite_cache_bytes);
// A game's own CIA has romfs:/game/; the launcher CIA has none and opens a .neo3ds file first.
bool loader_standalone(void);
bool loader_open_pack(const char *path);
bool loader_peek_pack(const char *path, const char *name, char *out, size_t size); /* game list */
// One of the game's small text files (title.txt...), whichever way it was loaded.
bool loader_read_text(const char *name, char *out, size_t size);
// The game's title ID, also in the launcher: keys, backup RAM and save states are kept under it.
u64 loader_game_id(void);
const char *loader_error(void);
// The packed BIOSes: mvs = 0 home console (AES), 1 arcade board (MVS).
bool loader_has_bios(int mvs);
int loader_default_bios(void);
void loader_use_bios(int mvs); /* takes effect at the next reset (neo_restart) */

#endif
