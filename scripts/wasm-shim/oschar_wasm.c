// WASM shim: manual UTF-8 <-> UTF-16LE converters replacing iconv
// (Emscripten libc has no iconv). Compiled only under __EMSCRIPTEN__;
// oschar.c keeps its iconv path for native builds. BMP + surrogates,
// unpaired surrogates -> U+FFFD. Callers free() the result (calloc'd),
// same contract as the iconv versions.
#ifdef __EMSCRIPTEN__
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "oschar.h"

utf16char_t* strcopy_UTF8toUTF16(const char *src)
{
	uint32_t src_len, i, o;
	utf16char_t *dst;

	if (!src)
		return NULL;

	src_len = strlen(src);
	// Worst case: every byte becomes one UTF-16 unit, plus NUL.
	dst = calloc(src_len + 1, sizeof(utf16char_t));
	if (!dst)
		return NULL;

	for (i = 0, o = 0; i < src_len;) {
		unsigned char c = (unsigned char)src[i];
		uint32_t cp;
		size_t extra;
		if (c < 0x80) { cp = c; extra = 0; }
		else if ((c & 0xE0) == 0xC0) { cp = c & 0x1F; extra = 1; }
		else if ((c & 0xF0) == 0xE0) { cp = c & 0x0F; extra = 2; }
		else if ((c & 0xF8) == 0xF0) { cp = c & 0x07; extra = 3; }
		else { dst[o++] = 0xFFFD; i++; continue; }
		if (i + extra >= src_len)
			break;
		size_t k;
		for (k = 1; k <= extra; k++) {
			unsigned char cc = (unsigned char)src[i + k];
			if ((cc & 0xC0) != 0x80) { cp = 0xFFFD; extra = k - 1; break; }
			cp = (cp << 6) | (cc & 0x3F);
		}
		i += extra + 1;
		if (cp > 0xFFFF) {
			cp -= 0x10000;
			dst[o++] = (utf16char_t)(0xD800 + (cp >> 10));
			dst[o++] = (utf16char_t)(0xDC00 + (cp & 0x3FF));
		} else {
			dst[o++] = (utf16char_t)cp;
		}
	}
	dst[o] = 0;
	return dst;
}

char* strcopy_UTF16toUTF8(const utf16char_t *src)
{
	uint32_t src_len, i, o;
	char *dst;

	if (!src)
		return NULL;

	src_len = utf16_strlen(src);
	// Worst case: 3 bytes per unit + surrogate pairs, plus NUL.
	dst = calloc(src_len * 3 + 1, sizeof(char));
	if (!dst)
		return NULL;

	for (i = 0, o = 0; i < src_len; i++) {
		uint32_t cp = src[i];
		if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < src_len) {
			uint32_t lo = src[i + 1];
			if (lo >= 0xDC00 && lo <= 0xDFFF) {
				cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
				i++;
			} else {
				cp = 0xFFFD;
			}
		} else if (cp >= 0xDC00 && cp <= 0xDFFF) {
			cp = 0xFFFD;
		}
		if (cp < 0x80) {
			dst[o++] = (char)cp;
		} else if (cp < 0x800) {
			dst[o++] = (char)(0xC0 | (cp >> 6));
			dst[o++] = (char)(0x80 | (cp & 0x3F));
		} else if (cp < 0x10000) {
			dst[o++] = (char)(0xE0 | (cp >> 12));
			dst[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
			dst[o++] = (char)(0x80 | (cp & 0x3F));
		} else {
			dst[o++] = (char)(0xF0 | (cp >> 18));
			dst[o++] = (char)(0x80 | ((cp >> 12) & 0x3F));
			dst[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
			dst[o++] = (char)(0x80 | (cp & 0x3F));
		}
	}
	dst[o] = 0;
	return dst;
}
#endif
