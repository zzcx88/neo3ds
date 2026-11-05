// Where neo3ds keeps its own files on the SD card, and the small path rules they share.
#ifndef NEO3DS_SDFILES_H
#define NEO3DS_SDFILES_H

#include <stdbool.h>
#include <stddef.h>

#define SD_DATA_DIR "sdmc:/3ds/neo3ds"
#define PACK_SUFFIX ".neo3ds"

/* Makes SD_DATA_DIR and the folder sub in it (NULL: only SD_DATA_DIR). */
void sd_make_data_dir(const char *sub);

/* SD_DATA_DIR/<sub>/<the running game's title id><ext> */
void sd_game_file(char *out, size_t size, const char *sub, const char *ext);

/* True when name ends in suffix (either case) with something before it. */
bool sd_has_suffix(const char *name, const char *suffix);

/* The length of a .neo3ds file's name without PACK_SUFFIX. */
int sd_pack_base(const char *pack_name);

#endif
