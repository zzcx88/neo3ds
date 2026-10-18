// Per-game backup RAM on the SD card (see save.c).
#ifndef NEO3DS_SAVE_H
#define NEO3DS_SAVE_H

void save_load(void);  /* before the console starts: reads the file into the backup RAM */
void save_frame(void); /* every frame: writes the RAM in the background a few seconds after it changes */
void save_flush(void); /* writes any change now (restart, HOME menu) */
void save_exit(void);  /* last write, then stops the writer thread */

#endif
