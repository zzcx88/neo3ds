// The receive screen's files: the checked file taking its place, the SD card's room, the log, and what
// a receive cut short leaves behind.
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <time.h>

#include "launcher.h"
#include "receive.h"
#include "receive_internal.h"
#include "recv_test.h"
#include "sdfiles.h"

#define LOG_FILE SD_DATA_DIR "/receive.log"
#define LOG_OLD LOG_FILE ".old"

enum {
	LOG_MAX = 32 * 1024,    /* then it becomes the .old file: two of these at most */
	RECOVER_MAX = 16,       /* leftovers handled per start */
};

/* Puts the checked file in place. An old file with the same name moves aside first, and back
 * if the new one can't take its name. */
bool recv_install(const char *part, const char *final) {
	char bak[PATH_BYTES + 8];
	struct stat st;
	const bool replacing = stat(final, &st) == 0;
	snprintf(bak, sizeof bak, "%s" BAK_SUFFIX, final);
	if (replacing) {
		remove(bak);
		if (rename(final, bak)) {
			recv_set_reason("Can't move the old file on the SD card.");
			return false;
		}
	}
	if (rename(part, final)) {
		if (replacing) rename(bak, final);
		recv_set_reason("Can't name the new file on the SD card.");
		return false;
	}
	if (replacing) remove(bak);
	return true;
}

bool recv_free_space(u64 *available, u64 *cluster) {
	struct statvfs v;
	if (statvfs("sdmc:/", &v)) return false;
	*cluster = v.f_bsize ? v.f_bsize : 1;
	*available = (u64)v.f_bavail * *cluster;
	recv_test_free_space(available);
	return true;
}

/* Room for these bytes in this many files, checked before a byte is written. */
bool recv_space_ok(u64 bytes, int files) {
	u64 available, cluster;
	if (!recv_free_space(&available, &cluster)) {
		recv_set_reason("Can't read the SD card's free space.");
		return false;
	}
	/* Each file ends in a part of a cluster and may need one for its folder entry; the two game
	 * folders may have to be made first */
	const u64 needed = bytes + ((u64)files * 2 + 2) * cluster;
	if (available >= needed) return true;
	snprintf(recv_reason, sizeof recv_reason, "Not enough space on the SD card: needs %lu MB, %lu MB free.",
		(unsigned long)(needed >> 20) + 1, (unsigned long)(available >> 20));
	return false;
}

/* One line per attempt. The address is not written: its path holds the sender's token. */
void recv_log(const char *name, const char *what, u64 bytes) {
	sd_make_data_dir(NULL);
	struct stat st;
	if (stat(LOG_FILE, &st) == 0 && st.st_size >= LOG_MAX) {
		remove(LOG_OLD);
		if (rename(LOG_FILE, LOG_OLD)) { /* it must not keep growing: start it again */
			FILE *emptied = fopen(LOG_FILE, "w");
			if (emptied) fclose(emptied);
		}
	}
	FILE *f = fopen(LOG_FILE, "a");
	if (!f) return;
	char when[32] = "";
	const time_t now = time(NULL);
	const struct tm *t = gmtime(&now); /* the console clock is local time */
	if (t) strftime(when, sizeof when, "%Y-%m-%d %H:%M:%S", t);
	fprintf(f, "%s %s %s bytes=%llu status=%d %s\n", when, what, name, (unsigned long long)bytes, recv_http_status, recv_reason);
	fclose(f);
}

void receive_recover(void) {
	char (*found)[NAME_MAX_BYTES + 16] = malloc(RECOVER_MAX * sizeof *found);
	if (!found) return;
	/* Lists a batch at a time: the folder is not changed while it is being read. A failure ends it
	 * (the file would be listed again and again) and is logged; the next start tries once more. */
	bool failed = false;
	int n;
	do {
		n = 0;
		DIR *d = opendir(LAUNCHER_GAMES_DIR);
		if (d) {
			struct dirent *e;
			while (n < RECOVER_MAX && (e = readdir(d))) {
				const size_t len = strlen(e->d_name);
				if (len >= sizeof found[0]) continue;
				if (sd_has_suffix(e->d_name, PACK_SUFFIX PART_SUFFIX) || sd_has_suffix(e->d_name, PACK_SUFFIX BAK_SUFFIX))
					strcpy(found[n++], e->d_name);
			}
			closedir(d);
		}
		for (int i = 0; i < n; i++) {
			char path[PATH_BYTES + 32], final[PATH_BYTES + 32];
			snprintf(path, sizeof path, LAUNCHER_GAMES_DIR "/%s", found[i]);
			const size_t len = strlen(path);
			int result;
			if (sd_has_suffix(path, PART_SUFFIX)) { /* never a whole, checked file */
				result = remove(path);
			} else {
				/* .bak: the old game. With a game of that name, the new one had taken its
				 * place; without, the old one goes back. */
				struct stat st;
				snprintf(final, sizeof final, "%.*s", (int)(len - strlen(BAK_SUFFIX)), path);
				result = stat(final, &st) == 0 ? remove(path) : rename(path, final);
			}
			if (result) {
				failed = true;
				recv_http_status = 0;
				recv_set_reason("Can't clear this leftover file.");
				recv_log(found[i], "failed", 0);
			}
		}
	} while (n == RECOVER_MAX && !failed);
	free(found);
}
