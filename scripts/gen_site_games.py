"""Builds the site's compatibility surfaces from converter/assets/neogeo_games.json.

usage: python scripts/gen_site_games.py [converter/assets/neogeo_games.json] [site/games.js]

Outputs (all generated, committed, drift-checked in CI):
  - site/games.js            landing page's JS explorer
  - site/compat.html         every romset as a static table (#130 P3, crawlable)
  - site/en/compat.html      the same table in English

Convertibility mirrors the converter itself, so the page never claims more than the tool does:
  - Protection.Supported(cart)        converter/Neo3dsConverter/Protection.cs:13
  - GameDb.Unsupported(game)          converter/Neo3dsConverter/GameDb.cs:45
  - GameDb.Title                      converter/Neo3dsConverter/GameDb.cs:26
The "verified on real hardware" notes come from the compatibility table in README.md; every other
convertible set is listed as unverified.
"""
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_site_seo import SITE  # single source for the deployed base URL (#130 P1)

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
    'mslug': ('실기 확인 · 풀 스피드 · 1.1.0에서 배경음악 처짐 수정', 'verified · full speed · music that dragged fixed in 1.1.0'),
    'sonicwi3': ('실기 확인 · 플레이 가능 · 1.1.0에서 음악 멈춤 수정', 'verified · playable · music freeze fixed in 1.1.0'),
    'mslug2': ('실기 확인 · 플레이 가능 · 원래 기판에서 느려지던 장면은 똑같이 느려짐', 'verified · playable · slows down exactly where the original board did'),
    'mslugx': ('실기 확인 · 풀 스피드 · 보호칩 검사 패치 · 원래 기판에서 느려지던 장면은 똑같이 느려짐', 'verified · full speed · protection check patched · slows down where the original board did'),
    'mslug3': ('실기 확인 · 풀 스피드 · 원래 기판에서 느려지던 장면은 똑같이 느려짐', 'verified · full speed · slows down where the original board did'),
    'kof2000': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'kof2002': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'svc': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'svcplus': ('실기 확인 · 풀 스피드 · MVS 바이오스로 시작', 'verified · full speed · starts on the MVS BIOS'),
    'samsh5sp': ('실기 확인 · 풀 스피드 · 줌 아웃 장면 최적화', 'verified · full speed · zoomed-out scenes optimized'),
    'kof95': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'kof96': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'kof97': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'mslug5': ('실기 확인 · 풀 스피드', 'verified · full speed'),
    'turfmast': ('실기 확인 · 풀 스피드 · 1.3.0부터 물 표시', 'verified · full speed · water shows from 1.3.0'),
    'neodrift': ('실기 확인 · 풀 스피드 · 1.3.0부터 스테이지 시작·커브 정상', 'verified · full speed · stage starts and curves correct from 1.3.0'),
    'kof2003': ('60fps · 유저 제보', '60 fps · user reported'),
    'garou': ('60fps · 유저 제보', '60 fps · user reported'),
    'mslug4': ('정상 · 유저 제보', 'plays fine · user reported'),
    'neobombe': ('정상 · 유저 제보', 'plays fine · user reported'),
    'strhoop': ('정상 · 유저 제보', 'plays fine · user reported'),
    'shocktro': ('정상 · 유저 제보', 'plays fine · user reported'),
    'tophuntr': ('정상 · 유저 제보', 'plays fine · user reported'),
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
        counts['verified'] += int(status == 1)
        s = scheme(cart) or 'none'
        schemes[s] = schemes.get(s, 0) + 1

    # Verified sets first, then the rest by title: the proof leads, the catalogue follows.
    rows.sort(key=lambda r: (r[6] != 1, r[1].lower()))

    write_games_js(dst, rows, counts, schemes)
    write_compat(rows, counts)


def write_games_js(dst, rows, counts, schemes):
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


STATUS = {
    'ko': {1: '실기 확인', 0: '변환 가능', 2: '변환 불가'},
    'en': {1: 'verified', 0: 'converts', 2: 'cannot convert'},
}
COMPAT = {
    'ko': {
        'file': 'site/ko/compat.html',
        'url': 'ko/compat.html',
        'css': '../styles.css',
        'css_icon': '../media/favicon.svg',
        'og_image': 'media/og-ko.png',
        'title': '네오지오 3DS 호환 게임 282종 목록 | neo3ds',
        'og_title': '네오지오 3DS 호환 게임 목록 | neo3ds',
        'desc': 'neo3ds가 인식하는 네오지오(MAME) 롬셋 282종과 게임별 변환 지원 상태를 한 표로 정리했습니다. 242종 변환 지원, 25종은 구형 3DS 실기에서 확인.',
        'h1': '호환 게임 282종 전체 목록',
        'lede': '롬셋 이름은 MAME 규격입니다. 변환 가능한 롬셋을 zip에 넣으면 해당 게임만 CIA로 나옵니다.',
        'caption': '실기 확인 → 변환 가능 → 변환 불가 순',
        'counts': '롬셋 {total}종 · {ok}종 변환 가능 · {verified}종 실기 확인',
        'th': ['게임', '롬셋', '연도', '제작사', '롬 MB', '상태', '비고'],
        'back': '← 소개 페이지로',
        'foot': ['소개', '변환기', '3DS 사용 안내', '저장소'],
        'note': '게임 화면과 상표의 권리는 각 권리자에게 있습니다.',
        'lang_label': '언어',
        'sections': '섹션',
        'nav': ['게임 호환성', '변환기'],
        'cta': '변환하기',
    },
    'en': {
        'file': 'site/compat.html',
        'url': 'compat.html',
        'css': 'styles.css',
        'css_icon': 'media/favicon.svg',
        'og_image': 'media/og.png',
        'title': 'Neo Geo games on 3DS — 282 romsets, 242 supported | neo3ds',
        'og_title': 'Neo Geo games on 3DS — full romset list | neo3ds',
        'desc': 'Every Neo Geo (MAME) romset neo3ds recognises — 282 of them — with its conversion status. 242 convert, 25 verified on real Old 3DS hardware.',
        'h1': 'All 282 compatible games',
        'lede': 'Romset names follow the MAME set list. Drop the convertible ones in the zip and each game becomes its own CIA.',
        'caption': 'Verified first, then convertible, then unsupported',
        'counts': '{total} romsets · {ok} convert · {verified} verified on hardware',
        'th': ['Game', 'Romset', 'Year', 'Maker', 'ROM MB', 'Status', 'Note'],
        'back': '← Back to the intro page',
        'foot': ['Intro', 'Converter', '3DS manual', 'Repository'],
        'note': 'Game footage and trademarks belong to their respective owners.',
        'lang_label': 'Language',
        'sections': 'Sections',
        'nav': ['Compatibility', 'Converter'],
        'cta': 'Convert',
    },
}


def write_compat(rows, counts):
    """The crawlable half of the compatibility table (#130 P3): no JS, one row per romset."""
    home = {'ko': 'index.html', 'en': 'index.html'}
    convert = {'ko': 'convert.html', 'en': 'convert.html'}
    for locale, c in COMPAT.items():
        # The EN page is the root one; Korean sits one level down in site/ko/.
        ko_href = 'compat.html' if locale == 'ko' else 'ko/compat.html'
        en_href = '../compat.html' if locale == 'ko' else 'compat.html'
        body = []
        for set_name, title, year, maker, rom_mb, _scheme, status, note_ko, note_en, _sprite in rows:
            note = (note_ko if locale == 'ko' else note_en) or '—'
            # The status column already says "verified"; the note repeats it as a prefix.
            if status == 1:
                note = re.sub(r'^(실기 확인|verified) · ', '', note)
            body.append(
                '<tr data-status="%d"><td>%s</td><td class="set">%s</td><td class="num">%s</td>'
                '<td>%s</td><td class="num">%s</td><td class="status">%s</td><td class="note">%s</td></tr>'
                % (status, html.escape(title), html.escape(set_name), year, html.escape(maker),
                   rom_mb, STATUS[locale][status], html.escape(note)))
        th = ''.join('<th>%s</th>' % html.escape(h) for h in c['th'])
        page = COMPAT_PAGE.format(
            lang='ko' if locale == 'ko' else 'en',
            site=SITE, url=SITE + c['url'],
            ko_url=SITE + 'ko/compat.html', en_url=SITE + 'compat.html',
            og_locale='ko_KR' if locale == 'ko' else 'en_US',
            og_locale_alt='en_US' if locale == 'ko' else 'ko_KR',
            css=c['css'], css_icon=c['css_icon'], og_image=c['og_image'],
            title=html.escape(c['title']), og_title=html.escape(c['og_title']),
            desc=html.escape(c['desc']),
            h1=html.escape(c['h1']), lede=html.escape(c['lede']),
            caption=html.escape(c['caption']), th=th,
            counts=c['counts'].format(total=counts['total'], ok=counts['ok'],
                                      verified=counts['verified']),
            home=home[locale], convert=convert[locale], back=html.escape(c['back']),
            foot0=html.escape(c['foot'][0]), foot1=html.escape(c['foot'][1]),
            foot2=html.escape(c['foot'][2]), foot3=html.escape(c['foot'][3]),
            note=html.escape(c['note']), lang_label=html.escape(c['lang_label']),
            sections=html.escape(c['sections']),
            nav0=html.escape(c['nav'][0]), nav1=html.escape(c['nav'][1]),
            cta=html.escape(c['cta']),
            ko_href=ko_href, en_href=en_href,
            ko_current=' aria-current="true"' if locale == 'ko' else '',
            en_current=' aria-current="true"' if locale == 'en' else '',
            rows='\n      '.join(body),
        )
        os.makedirs(os.path.dirname(c['file']), exist_ok=True)
        with open(c['file'], 'w', encoding='utf-8') as f:
            f.write(page)
        print('%s: %d rows' % (c['file'], len(body)))


COMPAT_PAGE = '''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#16161C">
<link rel="canonical" href="{url}">
<link rel="alternate" hreflang="ko" href="{ko_url}">
<link rel="alternate" hreflang="en" href="{en_url}">
<link rel="alternate" hreflang="x-default" href="{site}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="neo3ds">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{site}{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="neo3ds">
<meta property="og:locale" content="{og_locale}">
<meta property="og:locale:alternate" content="{og_locale_alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{og_title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{site}{og_image}">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "{og_title}",
  "url": "{url}",
  "inLanguage": "{lang}",
  "isPartOf": {{ "@type": "WebSite", "name": "neo3ds", "url": "{site}" }}
}}
</script>
<link rel="icon" href="{css_icon}">
<link rel="stylesheet" href="{css}">
<script defer src="https://cloud.umami.is/script.js" data-website-id="cf5cd373-6021-4643-a392-c3823e8f3cdd" data-domains="zzcx88.github.io"></script>
</head>
<body>
<header class="bar">
  <a class="brand" href="{home}" aria-label="neo3ds"><span class="brand-plate">neo3ds</span></a>
  <nav class="bar-nav" aria-label="{sections}">
    <a href="{home}#games">{nav0}</a>
    <a href="{convert}">{nav1}</a>
  </nav>
  <div class="bar-end">
    <div class="lang" role="group" aria-label="{lang_label}">
      <a href="{ko_href}"{ko_current}>KO</a>
      <a href="{en_href}"{en_current}>EN</a>
    </div>
    <a class="btn btn-primary" href="{convert}">{cta}</a>
  </div>
</header>
<main id="main" class="compat">
  <div class="compat-wrap">
    <h1>{h1}</h1>
    <p class="lede">{lede}</p>
    <p class="tiny">{counts}</p>
    <table>
      <caption>{caption}</caption>
      <thead><tr>{th}</tr></thead>
      <tbody>
      {rows}
      </tbody>
    </table>
    <p class="compat-back"><a href="{home}">{back}</a></p>
  </div>
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <span class="brand-plate">neo3ds</span>
    <nav>
      <a href="{home}">{foot0}</a>
      <a href="{convert}">{foot1}</a>
      <a href="manual.html">{foot2}</a>
      <a href="https://github.com/zzcx88/neo3ds">{foot3}</a>
    </nav>
    <p class="tiny">{note}</p>
  </div>
</footer>
</body>
</html>
'''

if __name__ == '__main__':
    main()
