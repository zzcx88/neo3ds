// Rewind: states of the running game kept in RAM, taken at frame ends.
//
// A state is ~400KB (see savestate.c), so the ring stays small: four states, one every two frames.
// A tap on [Rewind] stores the frame it came from and steps back to the oldest of the four, five
// or six frames (about 0.1s) behind, and the ring starts again from there. Five or six because the
// states are two frames apart: the tap frame is stored, so the depth is three intervals, and the
// last interval is one frame when the tap lands between two captures.
// The capture runs where a quick save does: core 1 has finished the frame, so both sound chips
// have taken every write and none is touched while the state is copied.
// The cost of the copy is the reason for the two-frame spacing (see the ticket for the numbers).
#include <3ds.h>
#include <stdlib.h>

#include "rewind.h"
#include "savestate.h"

enum { REWIND_SLOTS = 4, REWIND_EVERY = 2 };

static u8 *slots;
static size_t state_bytes;
static int next, count, frames; /* next: where the next state goes (the oldest once full) */

void rewind_free(void) {
	free(slots);
	slots = NULL;
	state_bytes = 0;
	next = count = frames = 0;
}

void rewind_reset(void) { next = count = frames = 0; }

void rewind_init(void) {
	rewind_free();
	state_bytes = savestate_state_size();
	if (!state_bytes) return;
	slots = malloc(state_bytes * REWIND_SLOTS);
	if (!slots) state_bytes = 0;
}

bool rewind_ready(void) { return slots != NULL; }

void rewind_capture(void) {
	if (!slots || ++frames % REWIND_EVERY) return;
	rewind_capture_now();
}

/* A state whatever the cadence says: the frame a rewind is served from stores itself first, so the
 * oldest state is always REWIND_EVERY * (REWIND_SLOTS - 1) frames back and not one interval more. */
void rewind_capture_now(void) {
	if (!slots) return;
	if (!savestate_store_memory(slots + (size_t)next * state_bytes, state_bytes)) return;
	next = (next + 1) % REWIND_SLOTS;
	if (count < REWIND_SLOTS) count++;
}

bool rewind_step_back(void) {
	if (!slots || !count) return false;
	const int oldest = count < REWIND_SLOTS ? 0 : next;
	if (!savestate_restore_memory(slots + (size_t)oldest * state_bytes, state_bytes)) return false;
	rewind_reset(); /* everything after the state we went back to is gone */
	return true;
}
