/* neo3ds: a second YM2610 used only to synthesize sound on core 1 (see audio.c).
 * The instance in ym2610.c follows the Z80's writes on the main core for timers, IRQs and
 * status; this one replays the same writes a frame later and generates the samples. */
#define YM2610Init ym_audio_Init
#define YM2610ChangeSamplerate ym_audio_ChangeSamplerate
#define YM2610Reset ym_audio_Reset
#define YM2610Write ym_audio_Write
#define YM2610Read ym_audio_Read
#define YM2610TimerOver ym_audio_TimerOver
#define YM2610Update ym_audio_Update
#define YM2610Update_stream ym_audio_Update_stream
#define mixing_buffer ym_audio_mixing_buffer
#include "ym2610.c"
