/*  gngeo a neogeo emulator
 *  Copyright (C) 2001 Peponas Mathieu
 *  GPL v2 or later. Trimmed for neo3ds: the conf struct is declared here and
 *  defined once in emu_glue.c (modern gcc defaults to -fno-common).
 */
#ifndef _EMU_H_
#define _EMU_H_

#include <config.h>
#include <string.h>
#include <stdint.h>
#include "SDL.h"
#define Uintptr uintptr_t

typedef enum SYSTEM {
	SYS_ARCADE = 0,
	SYS_HOME,
	SYS_UNIBIOS,
	SYS_MAX
} SYSTEM;

typedef enum COUNTRY {
	CTY_JAPAN = 0,
	CTY_EUROPE,
	CTY_USA,
	CTY_ASIA,
	CTY_MAX
} COUNTRY;

typedef struct neo_conf {
	char *game;
	Uint16 sample_rate;
	Uint16 test_switch;

	Uint8 sound;
	Uint8 raster;
	Uint8 debug;
	Uint8 rom_type;
	Uint8 pal;
	Uint8 do_message;
	Uint8 show_fps;
	SYSTEM system;
	COUNTRY country;
	char message[128];
} neo_conf;

extern neo_conf conf;

void neogeo_reset(void);

#endif
