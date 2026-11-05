// Game pictures for the launcher's list (see snapshot.h). One file a game, named after its .neo3ds
// file: "NSNP", flags, then the pixels. Written to a temporary name first, so a cut leaves the old
// picture or none, never half of one.
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "snapshot.h"

#define SNAP_DIR "sdmc:/3ds/neo3ds/snaps"

enum { FLAG_MANUAL = 1 };
typedef struct {
	char magic[4];
	u32 flags;
} Head;

/* <name without .neo3ds>.bin */
static void path_of(const char *pack_name, char *out, size_t size) {
	const size_t n = strlen(pack_name);
	const int base = n > 7 ? (int)(n - 7) : (int)n;
	snprintf(out, size, SNAP_DIR "/%.*s.bin", base, pack_name);
}

static bool read_head(FILE *f, Head *h) {
	return fread(h, sizeof *h, 1, f) == 1 && !memcmp(h->magic, "NSNP", 4);
}

bool snapshot_save(const char *pack_name, const u16 *pixels, bool manual) {
	char path[192], tmp[200];
	path_of(pack_name, path, sizeof path);
	snprintf(tmp, sizeof tmp, "%s.tmp", path);

	bool varied = false;
	for (int i = 1; i < SNAPSHOT_BYTES / 2 && !varied; i++) varied = pixels[i] != pixels[0];
	if (!varied) return false;

	Head h = {{'N', 'S', 'N', 'P'}, manual ? FLAG_MANUAL : 0};
	if (!manual) {
		FILE *old = fopen(path, "rb");
		if (old) {
			Head o;
			const bool kept = read_head(old, &o) && (o.flags & FLAG_MANUAL);
			fclose(old);
			if (kept) return false;
		}
	}
	mkdir("sdmc:/3ds", 0777);
	mkdir("sdmc:/3ds/neo3ds", 0777);
	mkdir(SNAP_DIR, 0777);
	FILE *f = fopen(tmp, "wb");
	if (!f) return false;
	bool ok = fwrite(&h, sizeof h, 1, f) == 1 && fwrite(pixels, SNAPSHOT_BYTES, 1, f) == 1;
	if (fclose(f)) ok = false;
	if (ok) {
		remove(path);
		ok = rename(tmp, path) == 0;
	}
	if (!ok) remove(tmp);
	return ok;
}

bool snapshot_load(const char *pack_name, u16 *pixels) {
	char path[192];
	path_of(pack_name, path, sizeof path);
	FILE *f = fopen(path, "rb");
	if (!f) return false;
	Head h;
	const bool ok = read_head(f, &h) && fread(pixels, SNAPSHOT_BYTES, 1, f) == 1;
	fclose(f);
	return ok;
}
