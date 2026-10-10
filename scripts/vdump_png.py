"""Converts an engine screen dump (sdmc:/neo3ds/vdump_NN.bin) to a 304x224 PNG of the game picture.
usage: py vdump_png.py <vdump.bin> <out.png>   (needs Pillow)

Dump layout (main.c dump_video_state): 8 u32 header, video RAM (0x20000), Neo Geo palette (0x4000),
host palette (0x8000), then the 400x240 top-screen framebuffer, RGB565, stored as 400 columns of
240 pixels with the bottom row first. The game picture is the middle 320x224; the 8 columns at each
side are blanked (overscan), leaving 304x224."""
import struct
import sys
from PIL import Image

data = open(sys.argv[1], 'rb').read()
off = 32 + 0x20000 + 0x4000 + 0x8000
fb = struct.unpack_from('<%dH' % (400 * 240), data, off)
img = Image.new('RGB', (304, 224))
px = img.load()
for x in range(304):
    col = (x + 8 + 40) * 240
    for y in range(224):
        v = fb[col + 239 - 8 - y]
        px[x, y] = (((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31)
img.save(sys.argv[2])
print('saved', sys.argv[2])
