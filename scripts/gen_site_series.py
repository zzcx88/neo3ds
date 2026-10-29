"""Writes the series pages for the site (#186).

usage: python3 scripts/gen_site_series.py

One page per series per locale: site/series/<slug>.html and site/ko/series/<slug>.html.
Both are generated; neither is hand-written. The game rows come from the same
converter/assets/neogeo_games.json as compat.html, and the series definition lives in
site_series_data.py, so a page cannot list a romset the game database does not have.
"""
import html
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_site_games import STATUS, build_rows
from gen_site_seo import SITE
from site_series_data import SERIES

MIN_ROWS = 4  # a page with fewer rows is thin content, not a landing page


def locales():
    """(locale, file, url path, depth) for both locales of one series page."""
    return {
        'en': ('site/series/%s.html', 'series/%s.html', 1),
        'ko': ('site/ko/series/%s.html', 'ko/series/%s.html', 2),
    }


TEXT = {
    'en': {
        'th': ['Game', 'Romset', 'Year', 'ROM MB', 'Status'],
        'stats': '{count} romsets · {ok} convert · {verified} verified on hardware',
        'caption': 'Verified first, then convertible, then unsupported',
        'all': 'All {total} romsets',
        'convert': 'Convert a romset',
        'home': 'Intro',
        'nav': ['Compatibility', 'Converter'],
        'sections': 'Sections',
        'lang_label': 'Language',
        'foot': ['Intro', 'Compatibility', '3DS manual', 'Changelog', 'Repository', 'Report a problem'],
        'note': 'Game footage and trademarks belong to their respective owners.',
        'series': 'More series',
    },
    'ko': {
        'th': ['게임', '롬셋', '연도', '롬 MB', '상태'],
        'stats': '롬셋 {count}종 · {ok}종 변환 가능 · {verified}종 실기 확인',
        'caption': '실기 확인 → 변환 가능 → 변환 불가 순',
        'all': '롬셋 {total}종 전체 목록',
        'convert': '변환하기',
        'home': '소개',
        'nav': ['게임 호환성', '변환기'],
        'sections': '섹션',
        'lang_label': '언어',
        'foot': ['소개', '게임 호환성', '3DS 사용 안내', '패치노트', '저장소', '문제 신고'],
        'note': '게임 화면과 상표의 권리는 각 권리자에게 있습니다.',
        'series': '다른 시리즈',
    },
}


def validate(rows):
    """Fail before writing anything if a series references a romset the database lacks."""
    by_set = {r[0]: r for r in rows}
    seen, errs = {}, []
    for s in SERIES:
        missing = [n for n in s['sets'] if n not in by_set]
        if missing:
            errs.append('%s: not in the game database: %s' % (s['slug'], ', '.join(missing)))
        if len(s['sets']) < MIN_ROWS:
            errs.append('%s: %d rows, needs %d' % (s['slug'], len(s['sets']), MIN_ROWS))
        for n in s['sets']:
            if n in seen:
                errs.append('%s: claimed by both %s and %s' % (n, seen[n], s['slug']))
            seen[n] = s['slug']
    slugs = [s['slug'] for s in SERIES]
    if len(set(slugs)) != len(slugs):
        errs.append('duplicate series slug')
    if errs:
        raise SystemExit('series data:\n  ' + '\n  '.join(errs))
    return by_set


def page(series, rows, counts, total, locale):
    file_tpl, url_path, depth = locales()[locale]
    up = '../' * depth
    other = 'ko' if locale == 'en' else 'en'
    t, copy = TEXT[locale], series[locale]
    url = SITE + url_path % series['slug']
    ko_url = SITE + 'ko/series/%s.html' % series['slug']
    en_url = SITE + 'series/%s.html' % series['slug']

    subset = sorted((r for r in rows if r[0] in series['sets']),
                    key=lambda r: (r[2], r[1].lower()))
    ok = sum(1 for r in subset if r[6] != 2)
    verified = sum(1 for r in subset if r[6] == 1)

    body = []
    for set_name, title, year, maker, rom_mb, _scheme, status, _ko, _en, _sprite in subset:
        body.append('<tr data-status="%d"><td>%s</td><td class="set">%s</td>'
                    '<td class="num">%s</td><td class="num">%s</td><td class="status">%s</td></tr>'
                    % (status, html.escape(title), html.escape(set_name), year, rom_mb,
                       STATUS[locale][status]))

    fields = {'count': len(subset), 'ok': ok, 'verified': verified,
              'first': subset[0][2], 'last': subset[-1][2], 'total': total}
    stats = t['stats'].format(**fields)
    th = ''.join('<th>%s</th>' % html.escape(h) for h in t['th'])
    prose = '\n    '.join('<p>%s</p>' % html.escape(p) for p in copy['prose'])

    peers = '\n        '.join('<a href="%s.html">%s</a>' % (s['slug'], html.escape(s[locale]['name']))
                              for s in SERIES if s['slug'] != series['slug'])

    # Links that leave the page: the pair for the language switch, and the one-level-up targets.
    if locale == 'en':
        ko_href, en_href = '../ko/series/%s.html' % series['slug'], '%s.html' % series['slug']
    else:
        ko_href, en_href = '%s.html' % series['slug'], '../../series/%s.html' % series['slug']

    jsonld = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        'name': copy['title'].format(**fields),
        'url': url,
        'inLanguage': locale,
        'isPartOf': {'@type': 'WebSite', 'name': 'neo3ds', 'url': SITE},
        'mainEntity': {
            '@type': 'ItemList',
            'numberOfItems': len(subset),
            'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': r[1]}
                                for i, r in enumerate(subset)],
        },
    }

    return PAGE.format(
        lang=locale, url=url, ko_url=ko_url, en_url=en_url,
        title=html.escape(copy['title'].format(**fields)),
        desc=html.escape(copy['desc'].format(**fields)),
        h1=html.escape(copy['h1'].format(**fields)),
        lede=html.escape(copy['lede'].format(**fields)),
        prose=prose, stats=stats, th=th,
        caption=html.escape(t['caption']),
        jsonld=json.dumps(jsonld, ensure_ascii=False, indent=2),
        css=up + 'styles.css', icon=up + 'media/favicon.svg',
        og_image=SITE + ('media/og-ko.png' if locale == 'ko' else 'media/og.png'),
        og_locale='ko_KR' if locale == 'ko' else 'en_US',
        og_locale_alt='en_US' if locale == 'ko' else 'ko_KR',
        # One level up reaches the page's own locale root: site/series/ -> site/, site/ko/series/ -> site/ko/.
        home='../index.html', convert='../convert.html', compat='../compat.html',
        page_up='../',
        all=t['all'].format(total=total), convert_label=html.escape(t['convert']),
        home_label=html.escape(t['home']),
        nav0=html.escape(t['nav'][0]), nav1=html.escape(t['nav'][1]),
        sections=html.escape(t['sections']), lang_label=html.escape(t['lang_label']),
        foot0=html.escape(t['foot'][0]), foot1=html.escape(t['foot'][1]),
        foot2=html.escape(t['foot'][2]), foot3=html.escape(t['foot'][3]),
        foot4=html.escape(t['foot'][4]), foot5=html.escape(t['foot'][5]), note=html.escape(t['note']), site=SITE, up=up,
        series_label=html.escape(t['series']), peers=peers,
        ko_href=ko_href, en_href=en_href,
        ko_current=' aria-current="true"' if locale == 'ko' else '',
        en_current=' aria-current="true"' if locale == 'en' else '',
        rows='\n      '.join(body),
    )


def main():
    rows, counts, _schemes = build_rows()
    validate(rows)
    total = counts['total']
    os.makedirs('site/series', exist_ok=True)
    os.makedirs('site/ko/series', exist_ok=True)
    written = 0
    for series in SERIES:
        for locale in ('en', 'ko'):
            path = locales()[locale][0] % series['slug']
            with open(path, 'w', encoding='utf-8') as f:
                f.write(page(series, rows, counts, total, locale))
            written += 1
    print('series pages: %d (%d series x 2 locales)' % (written, len(SERIES)))


PAGE = '''<!doctype html>
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
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="neo3ds">
<meta property="og:locale" content="{og_locale}">
<meta property="og:locale:alternate" content="{og_locale_alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{og_image}">
<script type="application/ld+json">
{jsonld}
</script>
<link rel="icon" href="{icon}">
<link rel="stylesheet" href="{css}">
<script defer src="https://cloud.umami.is/script.js" data-website-id="cf5cd373-6021-4643-a392-c3823e8f3cdd" data-domains="zzcx88.github.io"></script>
</head>
<body>
<header class="bar">
  <a class="brand" href="{home}" aria-label="neo3ds"><span class="brand-plate">neo3ds</span></a>
  <nav class="bar-nav" aria-label="{sections}">
    <a href="{compat}">{nav0}</a>
    <a href="{convert}">{nav1}</a>
  </nav>
  <div class="bar-end">
    <div class="lang" role="group" aria-label="{lang_label}">
      <a href="{ko_href}"{ko_current}>KO</a>
      <a href="{en_href}"{en_current}>EN</a>
    </div>
    <a class="btn btn-primary" href="{convert}">{convert_label}</a>
  </div>
</header>
<main id="main" class="compat">
  <div class="compat-wrap">
    <h1>{h1}</h1>
    <p class="lede">{lede}</p>
    <p class="tiny">{stats}</p>
    {prose}
    <table>
      <caption>{caption}</caption>
      <thead><tr>{th}</tr></thead>
      <tbody>
      {rows}
      </tbody>
    </table>
    <p class="compat-back"><a href="{compat}">{all}</a> · <a href="{convert}">{convert_label}</a></p>
    <nav class="series" aria-label="{series_label}">
        {peers}
    </nav>
  </div>
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <span class="brand-plate">neo3ds</span>
    <nav>
      <a href="{home}">{foot0}</a>
      <a href="{compat}">{foot1}</a>
      <a href="{page_up}manual.html">{foot2}</a>
      <a href="{page_up}changelog.html">{foot3}</a>
      <a href="{page_up}convert.html#feedback">{foot5}</a>
      <a href="https://github.com/zzcx88/neo3ds">{foot4}</a>
    </nav>
    <p class="tiny">{note}</p>
  </div>
</footer>
</body>
</html>
'''

if __name__ == '__main__':
    main()
