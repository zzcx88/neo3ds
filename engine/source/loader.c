// Loads a game prepared by the neo3ds converter from romfs:/game/ into memory.rom.
//
// Layout (all files written by the PC converter):
//   p.bin     68k program, as dumped (16-bit words already little-endian)
//   s.bin     game fix layer          sfix.bin  BIOS fix layer
//   m1.bin    Z80 program             v.bin     ADPCM-A samples (vb.bin: ADPCM-B if separate)
//   bios.bin  68k BIOS                lo.bin    000-lo.lo zoom table
//   c.idx     sprite block index      c.pak     compressed sprite blocks
//   sma.bin   SMA carts: bank switching and random number addresses
//   fixbank.bin  one byte: fix layer bank type for fix ROMs past 128KB
//   pvc.bin   present on PVC carts (cart RAM + bank switching at 0x2fe000)
#include <3ds.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "loader.h"
#include "emu.h"
#include "memory.h"
#include "video.h"

#define GAME_DIR "romfs:/game/"

void convert_all_char(Uint8 *Ptr, int Taille, Uint8 *usage_ptr);

static char error[256];

const char *loader_error(void) { return error; }

static void fail(const char *fmt, const char *arg) { snprintf(error, sizeof error, fmt, arg); }

// Reads a whole file. Large reads are chunked so the progress callback can redraw.
static Uint8 *read_file(const char *name, Uint32 *size_out, bool required, LoaderProgress progress) {
	char path[64];
	snprintf(path, sizeof path, GAME_DIR "%s", name);
	FILE *f = fopen(path, "rb");
	if (!f) {
		if (required) fail("missing %s", name);
		if (size_out) *size_out = 0;
		return NULL;
	}
	fseek(f, 0, SEEK_END);
	Uint32 size = ftell(f);
	fseek(f, 0, SEEK_SET);
	Uint8 *buf = malloc(size ? size : 1);
	if (!buf) {
		fclose(f);
		fail("out of memory loading %s", name);
		return NULL;
	}
	const Uint32 chunk = 1 << 20;
	for (Uint32 done = 0; done < size; done += chunk) {
		Uint32 n = size - done < chunk ? size - done : chunk;
		if (fread(buf + done, 1, n, f) != n) {
			fclose(f);
			free(buf);
			fail("read error in %s", name);
			return NULL;
		}
		if (progress) progress(name, done + n, size);
	}
	fclose(f);
	if (size_out) *size_out = size;
	return buf;
}

typedef struct {
	char magic[4];
	Uint32 version;
	Uint32 nb_tiles;
	Uint32 block_size;
	Uint32 nb_blocks;
} SpriteIndexHeader;

static bool load_sprites(LoaderProgress progress, Uint32 cache_bytes) {
	Uint32 idx_size, pak_size;
	Uint8 *idx = read_file("c.idx", &idx_size, true, NULL);
	if (!idx) return false;
	SpriteIndexHeader *h = (SpriteIndexHeader *)idx;
	/* version = sprite codec: 1 LZ4, 2 zstd */
	if (memcmp(h->magic, "NEOC", 4) || (h->version != SPR_CODEC_LZ4 && h->version != SPR_CODEC_ZSTD)) {
		fail("bad sprite index%s", "");
		return false;
	}
	Uint32 *offsets = (Uint32 *)(idx + sizeof *h);
	Uint32 *usage = offsets + h->nb_blocks + 1;

	Uint8 *pak = read_file("c.pak", &pak_size, true, progress);
	if (!pak) return false;

	memory.nb_of_tiles = h->nb_tiles;
	memory.rom.tiles.p = NULL;
	memory.rom.tiles.size = h->nb_tiles << 7;
	memory.rom.spr_usage.p = (Uint8 *)usage;
	memory.rom.spr_usage.size = (h->nb_tiles >> 4) * sizeof(Uint32);

	if (!init_sprite_cache(cache_bytes, h->block_size, h->version, pak, offsets, h->nb_blocks)) {
		fail("out of memory for sprite cache%s", "");
		return false;
	}
	return true;
}

// sma.bin (SMA carts only): bank select address, the 6 source bits of the bank number
// (most significant first), two random number addresses and the 64 bank offsets.
typedef struct {
	char magic[4];
	Uint32 bank_addr;
	Uint8 bits[6];
	Uint16 pad;
	Uint32 rng_addr[2];
	Sint32 offsets[64];
} SmaConfig;

static void load_sma(void) {
	static Uint8 unscramble[7];
	static int offsets[64];
	Uint32 size;
	SmaConfig *c = (SmaConfig *)read_file("sma.bin", &size, false, NULL);
	memory.bksw_unscramble = NULL;
	memory.bksw_offset = NULL;
	memory.sma_rng_addr = 0;
	if (!c) return;
	if (size == sizeof *c && !memcmp(c->magic, "NSMA", 4)) {
		/* gngeo's form: [0] = low byte of the select address, [1..6] = source of bank bits 0..5 */
		unscramble[0] = c->bank_addr & 0xff;
		for (int i = 0; i < 6; i++) unscramble[1 + i] = c->bits[5 - i];
		memcpy(offsets, c->offsets, sizeof offsets);
		memory.bksw_unscramble = unscramble;
		memory.bksw_offset = offsets;
		if (c->rng_addr[0]) memory.sma_rng_addr = (c->rng_addr[0] & 0xff) | (c->rng_addr[1] & 0xff) << 8;
	}
	free(c);
}

bool loader_load(LoaderProgress progress, Uint32 sprite_cache_bytes) {
	GAME_ROMS *r = &memory.rom;
	memset(r, 0, sizeof *r);

	if (!(r->cpu_m68k.p = read_file("p.bin", &r->cpu_m68k.size, true, progress))) return false;
	if (!(r->game_sfix.p = read_file("s.bin", &r->game_sfix.size, true, progress))) return false;
	if (!(r->cpu_z80.p = read_file("m1.bin", &r->cpu_z80.size, true, progress))) return false;
	if (!(r->adpcma.p = read_file("v.bin", &r->adpcma.size, true, progress))) return false;
	r->adpcmb.p = read_file("vb.bin", &r->adpcmb.size, false, progress);
	if (!r->adpcmb.p) r->adpcmb = r->adpcma;
	if (!(r->bios_m68k.p = read_file("bios.bin", &r->bios_m68k.size, true, progress))) return false;
	r->bios_sfix.p = read_file("sfix.bin", &r->bios_sfix.size, false, progress); /* absent for AES */
	if (!(memory.ng_lo = read_file("lo.bin", NULL, true, progress))) return false;
	if (!load_sprites(progress, sprite_cache_bytes)) return false;
	load_sma();
	{ /* fixbank.bin: how a fix ROM past 128KB is banked (1 Garou type, 2 KOF2000 type) */
		extern int neogeo_fix_bank_type;
		Uint8 *t = read_file("fixbank.bin", NULL, false, NULL);
		neogeo_fix_bank_type = t ? t[0] : 0;
		free(t);
	}
	{ /* pvc.bin (empty): PVC cart, see pvc_write in memory.c */
		extern Uint16 pvc_ram[0x1000];
		Uint8 *t = read_file("pvc.bin", NULL, false, NULL);
		memory.pvc = t != NULL;
		memset(pvc_ram, 0, sizeof pvc_ram);
		free(t);
	}

	// Same post-load steps as gngeo's dr_load_game/dr_load_bios.
	r->gfix_usage.size = r->game_sfix.size >> 5;
	r->gfix_usage.p = malloc(r->gfix_usage.size);
	memory.fix_game_usage = r->gfix_usage.p;
	if (r->bios_sfix.p) convert_all_char(r->bios_sfix.p, 0x20000, memory.fix_board_usage);
	convert_all_char(r->game_sfix.p, r->game_sfix.size, memory.fix_game_usage);

	memcpy(memory.game_vector, r->cpu_m68k.p, 0x80);
	memcpy(r->cpu_m68k.p, r->bios_m68k.p, 0x80);
	return true;
}

// From gngeo roms.c: reorder 8x8 fix-layer chars into the layout draw_fix_char expects.
void convert_all_char(Uint8 *Ptr, int Taille, Uint8 *usage_ptr) {
	int i, j;
	unsigned char usage;
	Uint8 *Src = malloc(Taille);
	Uint8 *sav_src = Src;
	if (!Src) return;
	memcpy(Src, Ptr, Taille);
#define CONVERT_TILE *Ptr++ = *(Src+16);\
	usage |= *(Src+16);\
	*Ptr++ = *(Src+24);\
	usage |= *(Src+24);\
	*Ptr++ = *(Src);\
	usage |= *(Src);\
	*Ptr++ = *(Src+8);\
	usage |= *(Src+8);\
	Src++;
	for (i = Taille; i > 0; i -= 32) {
		usage = 0;
		for (j = 0; j < 8; j++) {
			CONVERT_TILE
		}
		Src += 24;
		*usage_ptr++ = usage;
	}
	free(sav_src);
#undef CONVERT_TILE
}
