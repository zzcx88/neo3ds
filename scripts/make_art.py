"""Builds HOME menu art (48x48 icon, 256x128 banner) from 304x224 screen grabs (scripts/vdump_png.py).
usage: py make_art.py <out_dir> <game> <icon_src.png> <x> <y> <size> <banner_src.png> <y>
  icon:   the size x size square at (x, y) of icon_src, scaled to 48x48
  banner: the 304x152 strip starting at row y of banner_src, scaled to 256x128
Writes <out_dir>/<game>_icon.png and <out_dir>/<game>_banner.png (the converter picks them up)."""
import os
import sys
from PIL import Image

out, game, isrc, ix, iy, isz, bsrc, by = sys.argv[1:9]
ix, iy, isz, by = int(ix), int(iy), int(isz), int(by)

icon = Image.open(isrc).convert('RGB').crop((ix, iy, ix + isz, iy + isz)).resize((48, 48), Image.LANCZOS)
icon.save(os.path.join(out, game + '_icon.png'))
banner = Image.open(bsrc).convert('RGB').crop((0, by, 304, by + 152)).resize((256, 128), Image.LANCZOS)
banner.save(os.path.join(out, game + '_banner.png'))
print('art for', game)
