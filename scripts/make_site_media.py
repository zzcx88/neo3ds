"""Builds the landing page's hero images (site/media/) from the real-hardware captures in docs/images/.

usage: python scripts/make_site_media.py

docs/images/*_kof99.png are 2x captures with both screens stacked: the top screen (400x240) above the
touch screen (320x240). mslug3_play.png is a 2x capture of the top screen alone. The boxes below were
measured from those files (black bars around each screen), so a re-captured image may need new numbers.

The hero GIFs are a slideshow of those captures - real frames of real hardware, not a recorded video.
"""
import numpy as np
from PIL import Image

SRC = 'docs/images'
OUT = 'site/media'

# 2x boxes: (left, top, right, bottom)
TOP_BOX = (2, 16, 802, 496)          # 800x480 -> 400x240 (visible area 304x224 inside)
MSLUG_BOX = (2, 1, 802, 481)         # same, from the top-screen-only capture
BOTTOM_BOX = (82, 491, 722, 965)     # 640x474 -> 320x240 (the capture ends 6 rows early)

TOP_FRAMES = [                        # 실기 캡처 5장 순환: 플레이 → 대전 → 캐릭터 → 타이틀
    ('mslug3_play', 1500),            # Metal Slug 3
    ('main_kof99', 1400),             # KOF '99 fight
    ('turbo2_kof99', 1200),           # character screen
    ('diag2_kof99', 900),             # title + PRESS 1P OR 2P START
    ('keyconfig3_kof99', 900),        # title screen
]
BOTTOM_FRAMES = [                     # 하단 GUI 페이지(작은 화면에서도 읽히는 것만): 메인·키 설정·연사
    ('main_kof99', 1800),
    ('keyconfig3_kof99', 1800),
    ('turbo2_kof99', 1800),
]


def frame(name, box, size):
    img = Image.open(f'{SRC}/{name}.png').convert('RGB')
    img = img.crop(box).resize(size, Image.LANCZOS)
    # Keep the pixel art clean: no error-diffusion noise in the 256-colour GIF palette.
    return img.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.NONE)


def build(frames, size, gif, poster):
    images = [frame(n, MSLUG_BOX if n == 'mslug3_play' else (BOTTOM_BOX if size == (320, 240) else TOP_BOX), size)
              for n, _ in frames]
    images[0].save(poster)                                    # 정지 화면(reduced motion / GIF 실패 시)
    images[0].save(gif, save_all=True, append_images=images[1:],
                   duration=[d for _, d in frames], loop=0, optimize=True)
    print(f'{gif}: {len(images)} frames')


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    build(TOP_FRAMES, (400, 240), f'{OUT}/hero-top.gif', f'{OUT}/hero-top.png')
    build(BOTTOM_FRAMES, (320, 240), f'{OUT}/hero-bottom.gif', f'{OUT}/hero-bottom.png')
    for name in ('hero-top', 'hero-bottom'):
        for ext in ('gif', 'png'):
            path = f'{OUT}/{name}.{ext}'
            print(f'  {path}: {os.path.getsize(path) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
