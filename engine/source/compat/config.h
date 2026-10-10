/* neo3ds build configuration for the gngeo core */
#ifndef NEO3DS_CONFIG_H
#define NEO3DS_CONFIG_H
#define USE_CYCLONE 1
#define USE_DRZ80 1
#define VERSION "neo3ds"

/* gngeo core diagnostics; compiled out unless NEO3DS_CORE_LOG is defined */
#ifdef NEO3DS_CORE_LOG
#include <stdio.h>
#define core_log(...) printf(__VA_ARGS__)
#else
#define core_log(...) ((void)0)
#endif

#endif
