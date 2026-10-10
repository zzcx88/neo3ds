#ifndef NEO3DS_LOADER_H
#define NEO3DS_LOADER_H

#include <stdbool.h>
#include "SDL.h"

typedef void (*LoaderProgress)(const char *file, Uint32 done, Uint32 total);

// Loads romfs:/game/* into memory.rom. Returns false and sets loader_error() on failure.
bool loader_load(LoaderProgress progress, Uint32 sprite_cache_bytes);
const char *loader_error(void);

#endif
