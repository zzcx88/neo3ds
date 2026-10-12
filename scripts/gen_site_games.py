"""Builds site/games.js (the landing page's compatibility explorer) from converter/assets/neogeo_games.json.

usage: python scripts/gen_site_games.py [converter/assets/neogeo_games.json] [site/games.js]

Convertibility mirrors the converter itself, so the page never claims more than the tool does:
  - Protection.Supported(cart)        converter/Neo3dsConverter/Protection.cs:13
  - GameDb.Unsupported(game)          converter/Neo3dsConverter/GameDb.cs:45
  - GameDb.Title                      converter/Neo3dsConverter/GameDb.cs:26
The "verified on real hardware" notes come from the compatibility table in README.md; every other
convertible set is listed as unverified.
"""
import json
import os
import re
import sys

# Protection.Supported (Protection.cs:13): the cart types the converter can decrypt.
SUPPORTED_PREFIXES = ('cmc42_', 'sma_', 'pcm2_', 'k2k2_', 'pvc_')
SUPPORTED_EXACT = {'rom', 'rom_mslugx', 'cmc50_kof2001', 'cmc50_kof2000n',
                   'pvc_mslug5', 'pvc_svc', 'pvc_kf2k3', 'pvc_kf2k3h', 'boot_svcplus'}

# Scheme shown per cart type; the key goes to the page, which has the ko/en wording.
SCHEME_PREFIX = {'cmc42_': 'cmc42', 'cmc50_': 'cmc50', 'sma_': 'sma', 'pcm2_': 'pcm2',
                 'k2k2_': 'k2k2', 'pvc_': 'pvc', 'boot_': 'boot'}
# SMA carts also sit behind CMC42 or CMC50 (Protection.cs:61-66).
SMA_CMC = {'sma_kof99': 'cmc42', 'sma_garou': 'cmc42', 'sma_garouh': 'cmc42',
           'sma_mslug3': 'cmc42', 'sma_mslug3a': 'cmc42', 'sma_kof2k': 'cmc50'}

# GameDb.Unsupported (GameDb.cs:45): the same wording the converter shows.
REASONS = {
    'irrmaze': ('트랙볼 전용 게임', 'needs a trackball'),
    'rom_kof98': ('보호 칩이 달린 MVS판입니다 (가정용 kof98h 롬이 있으면 그걸로 변환됩니다)',
                  'MVS version with a protection chip (the home set kof98h converts when its ROMs are in the zip)'),
    'rom_fatfur2': ('보호 칩 미지원', 'protection chip not supported'),
    'rom_vliner': ('도박기판 게임', 'gambling board'),
    'cmc50_jockeygp': ('도박기판 게임', 'gambling board'),
}
BOOTLEG_REASON = ('해적판(부트렉) 롬셋 미지원', 'bootleg romsets are not supported')
DEFAULT_REASON = ('보호 칩 미지원', 'protection chip not supported')

# README.md "실기(구형 3DS)에서 확인한 게임": what was actually played on hardware.
VERIFIED = {
    'kof98h': ('실기 확인 · 풀 스피드 · kof98.zip에서 자동 선택', 'verified · full speed · picked automatically from kof98.zip'),
    'kof99': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'mslug2': ('실기 확인 · 플레이 가능 · 원래 기판도 느려지던 장면에서 느려짐', 'verified · playable · slows down where the original board did too'),
    'mslugx': ('실기 확인 · 풀 스피드 · 보호칩 검사 패치', 'verified · full speed · protection check patched'),
    'mslug3': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'kof2000': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'kof2002': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'svc': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'svcplus': ('실기 확인 · 풀 스피드 · MVS 바이오스로 시작', 'verified · full speed · starts on the MVS BIOS'),
    'samsh5sp': ('실기 확인 · 풀 스피드 · 줌 아웃 장면 최적화', 'verified · full speed · zoomed-out scenes optimized'),
    'kof2003': ('60fps · 유저 제보', '60 fps · user reported'),
    'mslug5': ('60fps · 유저 제보', '60 fps · user reported'),
    'garou': ('60fps · 유저 제보', '60 fps · user reported'),
}


def title(desc):
    """GameDb.Title (GameDb.cs:26): drop the trailing NGM/NGH numbers and the clone suffix."""
    t = desc.split(' / ')[0]
    return re.sub(r'\s*\([^)]*\)\s*$', '', t).strip()


def scheme(cart):
    """The decrypt chain the converter runs for this cart (Protection.cs:47)."""
    if cart == 'rom':
        return ''
    if cart == 'rom_mslugx':
        return 'patch'
    for prefix, key in SCHEME_PREFIX.items():
        if cart.startswith(prefix):
            if key == 'sma':
                return 'sma+' + SMA_CMC.get(cart, 'cmc42')
            if key == 'pcm2':
                # PCM2 carts are CMC50 carts too (Protection.cs:68-71).
                return 'cmc50+pcm2'
            if key == 'k2k2':
                return 'cmc50+pcm2+k2k2'
            if key == 'pvc':
                return 'cmc50+pcm2+pvc'
            if key == 'boot':
                return 'boot'
            return key
    return ''


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'converter/assets/neogeo_games.json'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'site/games.js'
    games = json.load(open(src, encoding='utf-8'))

    rows, counts = [], {'total': 0, 'ok': 0, 'no': 0, 'verified': 0}
    schemes = {}
    for g in games:
        cart, name = g['cart'], g['name']
        regions = g['regions']
        rom_bytes = sum(r['size'] for r in regions.values())
        # RomPack converts the sprites region only, one tile per 128 bytes (RomPack.cs: ConvertTile).
        sprite_mb = round(regions.get('sprites', {}).get('size', 0) / 1048576, 1)
        if cart in SUPPORTED_EXACT or cart.startswith(SUPPORTED_PREFIXES):
            status, note = (1, VERIFIED[name]) if name in VERIFIED else (0, ('', ''))
        else:
            status = 2
            note = REASONS.get(cart) or (BOOTLEG_REASON if cart.startswith('boot_') else DEFAULT_REASON)
        rows.append([name, title(g['desc']), g['year'], g['maker'], round(rom_bytes / 1048576, 1),
                     scheme(cart), status, note[0], note[1], sprite_mb])
        counts['total'] += 1
        counts['ok' if status != 2 else 'no'] += 1
        counts['verified'] += status == 1
        s = scheme(cart) or 'none'
        schemes[s] = schemes.get(s, 0) + 1

    # Verified sets first, then the rest by title: the proof leads, the catalogue follows.
    rows.sort(key=lambda r: (r[6] != 1, r[1].lower()))

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('// Generated by scripts/gen_site_games.py from converter/assets/neogeo_games.json.'
                ' Do not edit by hand.\n')
        f.write('// Row: [set, title, year, maker, ROM MB, decrypt chain, status, note ko, note en, sprite MB].\n')
        f.write('// status: 1 = played on real hardware, 0 = converts, not verified yet, 2 = cannot convert.\n')
        f.write('window.NEO3DS_DB = ')
        json.dump({'counts': counts, 'schemes': schemes, 'games': rows}, f, ensure_ascii=False,
                  separators=(',', ':'))
        f.write(';\n')
    print(f'{dst}: {counts}')
    print('schemes: ' + ', '.join(f'{k}={v}' for k, v in sorted(schemes.items(), key=lambda kv: -kv[1])))


if __name__ == '__main__':
    main()
