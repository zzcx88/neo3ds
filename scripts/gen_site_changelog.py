"""Builds the changelog pages from site/releases.json (#166).

usage: python3 scripts/gen_site_changelog.py

One JSON entry per release, in both languages, so a release is one edit and one
generator run. Both locale pages are generated (like compat.html); neither is a
hand-written source. site_gate.sh checks the top entry against <Version>.
"""
import html
import json
import os
import re
import sys

SITE = 'https://zzcx88.github.io/neo3ds/'
DATA = 'site/releases.json'
RELEASES = 'https://github.com/zzcx88/neo3ds/releases'
ISSUES = 'https://github.com/zzcx88/neo3ds/issues/'

META = {
    'ko': {
        'file': 'site/ko/changelog.html',
        'url': 'ko/changelog.html',
        'lang': 'ko',
        'css': '../styles.css',
        'icon': '../media/favicon.svg',
        'og': 'media/og-ko.png',
        'og_locale': 'ko_KR',
        'og_alt': 'en_US',
        'title': '패치노트 — neo3ds 릴리스 기록 | neo3ds',
        'og_title': 'neo3ds 패치노트 | neo3ds',
        'desc': 'neo3ds 1.0.0부터 1.3.1까지 릴리스 14개의 변경 사항을 최신순으로 정리했습니다. 엔진·런처·변환기의 새 기능과 수정.',
        'tw_desc': '1.0.0부터 1.3.1까지, 버전별 새 기능과 수정.',
        'h1': '패치노트',
        'latest': '최신',
        'link': 'GitHub 릴리스',
        'note': '전체 릴리스와 다운로드 파일은 <a href="%s">GitHub 릴리스</a>에 있습니다.' % RELEASES,
        'nav': ['소개', '변환기', '호환성'],
        'foot': ['게임 목록', '3DS 사용 안내', '패치노트', '문제 신고', '저장소', '릴리스', 'README', '빌드 절차', '라이선스', '개인정보'],
        'foot_note': '게임 화면과 상표의 권리는 각 권리자에게 있습니다.',
        'lang_label': '언어',
        'sections': '섹션',
    },
    'en': {
        'file': 'site/changelog.html',
        'url': 'changelog.html',
        'lang': 'en',
        'css': 'styles.css',
        'icon': 'media/favicon.svg',
        'og': 'media/og.png',
        'og_locale': 'en_US',
        'og_alt': 'ko_KR',
        'title': 'Changelog — every neo3ds release | neo3ds',
        'og_title': 'neo3ds changelog | neo3ds',
        'desc': 'Every neo3ds release from 1.0.0 to 1.3.1, newest first: engine, launcher and converter features and fixes.',
        'tw_desc': 'Every release from 1.0.0 to 1.3.1, newest first.',
        'h1': 'Changelog',
        'latest': 'Latest',
        'link': 'GitHub release',
        'note': 'All releases and download files are on <a href="%s">GitHub releases</a>.' % RELEASES,
        'nav': ['Intro', 'Converter', 'Compatibility'],
        'foot': ['Game list', '3DS manual', 'Changelog', 'Report a problem', 'Repository', 'Releases', 'README', 'Build procedure', 'Licence', 'Privacy'],
        'foot_note': 'Game footage and trademarks belong to their respective owners.',
        'lang_label': 'Language',
        'sections': 'Sections',
    },
}

FOOT_HREF = ['compat.html', 'manual.html', 'changelog.html', 'index.html#feedback',
             'https://github.com/zzcx88/neo3ds', RELEASES,
             'https://github.com/zzcx88/neo3ds/blob/main/README.md',
             'https://github.com/zzcx88/neo3ds/blob/main/docs/build.md',
             'https://github.com/zzcx88/neo3ds/blob/main/LICENSE', 'privacy.html']


def esc(s):
    return html.escape(s, quote=False)


def with_issue_links(s):
    """`#135` in a note becomes a link to the issue; everything else is escaped."""
    return re.sub(r'#(\d+)', lambda m: '<a href="%s%s">#%s</a>' % (ISSUES, m.group(1), m.group(1)), esc(s))


def load():
    releases = json.load(open(DATA, encoding='utf-8'))
    seen = set()
    last = None
    for r in releases:
        version, date, items = r.get('version'), r.get('date'), r.get('items')
        if not (isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+', version)):
            sys.exit('%s: bad version %r' % (DATA, version))
        if version in seen:
            sys.exit('%s: duplicate version %s' % (DATA, version))
        seen.add(version)
        if not (isinstance(date, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date)):
            sys.exit('%s: bad date %r for %s' % (DATA, date, version))
        if last and date > last:
            sys.exit('%s: %s is newer than the entry above it' % (DATA, version))
        last = date
        if not items:
            sys.exit('%s: %s has no items' % (DATA, version))
        for it in items:
            for side in ('t', 'd'):
                pair = it.get(side) or {}
                if not (pair.get('ko') and pair.get('en')):
                    sys.exit('%s: %s item %r needs both ko and en' % (DATA, version, it))
    return releases


def entry(r, meta, latest):
    rows = '\n'.join(
        '            <li><b>%s</b>: %s</li>' % (with_issue_links(it['t'][meta['lang']]), with_issue_links(it['d'][meta['lang']]))
        for it in r['items'])
    badge = '\n          <span class="rel-latest">%s</span>' % meta['latest'] if latest else ''
    return '''      <li class="rel%s" id="v%s">
        <div class="rel-head">
          <span class="rel-v">v%s</span>%s
          <time class="rel-date" datetime="%s">%s</time>
        </div>
        <ul class="rel-items">
%s
        </ul>
        <a class="rel-link" href="%s/tag/v%s">%s</a>
      </li>''' % (' is-latest' if latest else '', r['version'].replace('.', '-'), r['version'], badge,
                   r['date'], r['date'], rows, RELEASES, r['version'], meta['link'])


def page(meta, releases):
    nav = '\n'.join('    <a href="%s">%s</a>' % (href, esc(label))
                    for href, label in zip(['index.html', 'convert.html', 'compat.html'], meta['nav']))
    foot = '\n'.join(
        '      <a href="%s"%s>%s</a>' % (href, ' aria-current="page"' if href == 'changelog.html' else '', esc(label))
        for href, label in zip(FOOT_HREF, meta['foot']))
    entries = '\n'.join(entry(r, meta, i == 0) for i, r in enumerate(releases))
    jsonld = json.dumps({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        'name': meta['og_title'],
        'url': SITE + meta['url'],
        'inLanguage': [meta['lang'], 'en' if meta['lang'] == 'ko' else 'ko'],
        'isPartOf': {'@type': 'WebSite', 'name': 'neo3ds', 'url': SITE},
    }, ensure_ascii=False, indent=2)
    ko_switch = '<a href="changelog.html" aria-current="true">KO</a>\n      <a href="../changelog.html">EN</a>' if meta['lang'] == 'ko' \
        else '<a href="ko/changelog.html">KO</a>\n      <a href="./changelog.html" aria-current="true">EN</a>'
    return '''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#16161C">
<link rel="canonical" href="{url}">
<link rel="alternate" hreflang="ko" href="{site}ko/changelog.html">
<link rel="alternate" hreflang="en" href="{site}changelog.html">
<link rel="alternate" hreflang="x-default" href="{site}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="neo3ds">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="neo3ds">
<meta property="og:locale" content="{og_locale}">
<meta property="og:locale:alternate" content="{og_alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{og_title}">
<meta name="twitter:description" content="{tw_desc}">
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
  <a class="brand" href="index.html" aria-label="neo3ds"><span class="brand-plate">neo3ds</span></a>
  <nav class="bar-nav" aria-label="{sections}">
{nav}
  </nav>
  <div class="bar-end">
    <div class="lang" role="group" aria-label="{lang_label}">
      {ko_switch}
    </div>
    <a class="btn btn-primary" href="convert.html">{cta}</a>
  </div>
</header>
<main id="main" class="changelog">
  <div class="changelog-wrap">
    <h1>{h1}</h1>
    <ol class="rel-list">
{entries}
    </ol>
    <p class="tiny end-note">{note}</p>
  </div>
</main>

<footer class="foot">
  <div class="wrap foot-grid">
    <span class="brand-plate">neo3ds</span>
    <nav>
{foot}
    </nav>
    <p class="tiny">{foot_note}</p>
  </div>
</footer>
</body>
</html>
'''.format(
        lang=meta['lang'], title=esc(meta['title']), desc=esc(meta['desc']),
        url=SITE + meta['url'], site=SITE, og_title=esc(meta['og_title']),
        og_image=SITE + meta['og'], og_locale=meta['og_locale'], og_alt=meta['og_alt'],
        tw_desc=esc(meta['tw_desc']), jsonld=jsonld, icon=meta['icon'], css=meta['css'],
        sections=meta['sections'], nav=nav, lang_label=meta['lang_label'],
        ko_switch=ko_switch, cta='변환하기' if meta['lang'] == 'ko' else 'Convert now',
        h1=esc(meta['h1']), entries=entries, note=meta['note'],
        foot=foot, foot_note=esc(meta['foot_note']))


def main():
    releases = load()
    for meta in META.values():
        out = page(meta, releases)
        os.makedirs(os.path.dirname(meta['file']), exist_ok=True)
        with open(meta['file'], 'w', encoding='utf-8') as f:
            f.write(out)
        print('%s: %d releases, %d bytes' % (meta['file'], len(releases), len(out)))


if __name__ == '__main__':
    main()
