// See sdfiles.h.
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#include "loader.h"
#include "sdfiles.h"

void sd_make_data_dir(const char *sub) {
	mkdir("sdmc:/3ds", 0777);
	mkdir(SD_DATA_DIR, 0777);
	if (!sub) return;
	char path[64];
	snprintf(path, sizeof path, SD_DATA_DIR "/%s", sub);
	mkdir(path, 0777);
}

void sd_game_file(char *out, size_t size, const char *sub, const char *ext) {
	snprintf(out, size, SD_DATA_DIR "/%s/%016llX%s", sub, (unsigned long long)loader_game_id(), ext);
}

bool sd_has_suffix(const char *name, const char *suffix) {
	const size_t n = strlen(name), s = strlen(suffix);
	return n > s && !strcasecmp(name + n - s, suffix);
}

int sd_pack_base(const char *pack_name) {
	const size_t n = strlen(pack_name), s = strlen(PACK_SUFFIX);
	return n > s ? (int)(n - s) : (int)n;
}
