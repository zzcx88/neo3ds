"""Writes site/sitemap.xml and checks the SEO head of every page (#130 P1/P2/P5, flipped by #141).

usage:
  python3 scripts/gen_site_seo.py           # (re)write site/sitemap.xml
  python3 scripts/gen_site_seo.py --check   # verify sitemap + page heads, non-zero on drift

English is the default locale and lives at the root; Korean sits under /ko/.
One page table, one base URL: every canonical, hreflang and og:url in the site is
checked against it, so a page cannot silently point somewhere else.
"""
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET

SITE = 'https://zzcx88.github.io/neo3ds/'
SITEMAP = 'site/sitemap.xml'
OG_SIZE = (1200, 630)

# (file, url path, locale)
PAGES = [
    ('site/index.html', '', 'en'),
    ('site/convert.html', 'convert.html', 'en'),
    ('site/compat.html', 'compat.html', 'en'),
    ('site/privacy.html', 'privacy.html', 'en'),
    ('site/ko/index.html', 'ko/', 'ko'),
    ('site/ko/convert.html', 'ko/convert.html', 'ko'),
    ('site/ko/compat.html', 'ko/compat.html', 'ko'),
    ('site/ko/privacy.html', 'ko/privacy.html', 'ko'),
]

# Per-locale share card, and the path of each slug in each locale.
OG_IMAGE = {'en': 'site/media/og.png', 'ko': 'site/media/og-ko.png'}
SLUGS = {
    'index.html': {'en': '', 'ko': 'ko/'},
    'convert.html': {'en': 'convert.html', 'ko': 'ko/convert.html'},
    'compat.html': {'en': 'compat.html', 'ko': 'ko/compat.html'},
    'privacy.html': {'en': 'privacy.html', 'ko': 'ko/privacy.html'},
}
OG_LOCALE = {'ko': 'ko_KR', 'en': 'en_US'}


def attr(tag, name):
    m = re.search(r'\b%s\s*=\s*"([^"]*)"' % re.escape(name), tag)
    return m.group(1) if m else None


def metas(html):
    """{name or property: content} for every <meta> in the document."""
    out = {}
    for m in re.finditer(r'<meta\b[^>]*>', html):
        key = attr(m.group(0), 'name') or attr(m.group(0), 'property')
        if key:
            out[key] = attr(m.group(0), 'content')
    return out


def links(html):
    """[(rel, hreflang, href)] for every <link> in the document."""
    out = []
    for m in re.finditer(r'<link\b[^>]*>', html):
        tag = m.group(0)
        out.append((attr(tag, 'rel'), attr(tag, 'hreflang'), attr(tag, 'href')))
    return out


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise SystemExit('%s: not a PNG' % path)
    return struct.unpack('>II', head[16:24])


def sitemap_xml():
    root = ET.Element('urlset', xmlns='http://www.sitemaps.org/schemas/sitemap/0.9')
    # No lastmod/changefreq/priority: Google ignores them when unreliable, and a
    # generated date would make this file drift on every run.
    for _, path, _ in PAGES:
        ET.SubElement(root, 'url').append(ET.Element('loc'))
        root[-1][0].text = SITE + path
    ET.indent(root, space='  ')
    return ET.tostring(root, encoding='unicode') + '\n'


def other(locale):
    return 'en' if locale == 'ko' else 'ko'


def check_page(f, path, locale):
    html = open(f, encoding='utf-8').read()
    errs = []
    url = SITE + path
    slug = path.split('/')[-1] or 'index.html'

    canon = [h for (rel, _, h) in links(html) if rel == 'canonical']
    if canon != [url]:
        errs.append('canonical %r != %r' % (canon, url))

    alt = {(hl, h) for (rel, hl, h) in links(html) if rel == 'alternate'}
    want = {('ko', SITE + SLUGS[slug]['ko']),
            ('en', SITE + SLUGS[slug]['en']),
            ('x-default', SITE)}
    if alt != want:
        errs.append('hreflang %r != %r' % (sorted(alt), sorted(want)))

    image = SITE + OG_IMAGE[locale].split('site/', 1)[1]
    m = metas(html)
    for key, want_value in (('og:url', url),
                            ('og:image', image),
                            ('og:locale', OG_LOCALE[locale]),
                            ('og:locale:alternate', OG_LOCALE[other(locale)]),
                            ('og:image:width', str(OG_SIZE[0])),
                            ('og:image:height', str(OG_SIZE[1])),
                            ('og:type', 'website'),
                            ('og:site_name', 'neo3ds'),
                            ('twitter:card', 'summary_large_image'),
                            ('twitter:image', image)):
        if m.get(key) != want_value:
            errs.append('%s %r != %r' % (key, m.get(key), want_value))

    desc = m.get('description') or ''
    if len(desc) < 60:
        errs.append('description too short (%d chars)' % len(desc))
    title = re.search(r'<title>(.*?)</title>', html, re.S)
    if not title or not title.group(1).strip():
        errs.append('missing <title>')
    if 'application/ld+json' not in html:
        errs.append('missing JSON-LD')
    if not re.search(r'<html lang="%s">' % locale, html):
        errs.append('html lang is not %r' % locale)
    return errs


def main():
    write = '--check' not in sys.argv
    errs = []

    if write:
        with open(SITEMAP, 'w', encoding='utf-8') as f:
            f.write(sitemap_xml())
        print('%s: %d urls' % (SITEMAP, len(PAGES)))
    else:
        want = sitemap_xml()
        got = open(SITEMAP, encoding='utf-8').read() if os.path.exists(SITEMAP) else ''
        if got != want:
            errs.append('%s differs from the page table' % SITEMAP)

    for f, path, locale in PAGES:
        if not os.path.exists(f):
            errs.append('%s: missing' % f)
            continue
        errs += ['%s: %s' % (f, e) for e in check_page(f, path, locale)]

    for locale, image in OG_IMAGE.items():
        if not os.path.exists(image):
            errs.append('%s: missing' % image)
        elif png_size(image) != OG_SIZE:
            errs.append('%s: %dx%d != %dx%d' % ((image,) + png_size(image) + OG_SIZE))

    if errs:
        print('\n'.join(errs), file=sys.stderr)
        sys.exit(1)
    print('sitemap + SEO head OK (%d pages)' % len(PAGES))


if __name__ == '__main__':
    main()
