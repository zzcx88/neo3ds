#ifndef NEO3DS_LOADER_H
#define NEO3DS_LOADER_H

#include <stdbool.h>
#include "SDL.h"

typedef void (*LoaderProgress)(const char *file, Uint32 done, Uint32 total);

// Loads romfs:/game/* into memory.rom. Returns false and sets loader_error() on failure.
bool loader_load(LoaderProgress progress, Uint32 sprite_cache_bytes);
const char *loader_error(void);
// The packed BIOSes: mvs = 0 home console (AES), 1 arcade board (MVS).
bool loader_has_bios(int mvs);
int loader_default_bios(void);
void loader_use_bios(int mvs); /* takes effect at the next reset (neo_restart) */

#endif
