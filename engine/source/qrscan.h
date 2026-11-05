// The receive screen's camera: reads a QR code with the outer camera.
#ifndef NEO3DS_QRSCAN_H
#define NEO3DS_QRSCAN_H

#include <stdbool.h>
#include <stddef.h>

typedef enum { QR_FOUND, QR_CANCELLED, QR_NO_CAMERA } QrResult;

/* NULL when the code's text is one the caller can use, else what to tell the player. */
typedef const char *(*QrCheck)(const char *text);

/* Shows the camera on the top screen until a code passes check (its text in out), B is pressed or
 * the app is closing. Other codes only change the status line. The camera is off on return. */
QrResult qr_scan(char *out, size_t size, QrCheck check, void (*status)(const char *));

#endif
