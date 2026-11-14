"""Records the public side of the search/indexing baseline (#377).

Search Console and Umami need an account, so this script captures only what anyone
can re-check from outside: the four search landing URLs answer 200, what each page
declares (title, description, canonical, hreflang, JSON-LD), and what the sitemap
publishes. Run it before and after a deploy and compare the JSON.

usage:
  python3 scripts/seo_baseline.py                # print JSON to stdout
  python3 scripts/seo_baseline.py --out f.json   # also write it
  python3 scripts/seo_baseline.py --base http://127.0.0.1:8099/site   # local preview

A non-200 URL, a missing canonical, or a sitemap that does not list the four URLs
exits non-zero: the baseline must not record a broken state as normal.
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

SITE = 'https://zzcx88.github.io/neo3ds/'
# The four search landing pages the issue names: intro and converter, both locales.
LANDING = [
    ('en', 'index', ''),
    ('ko', 'index', 'ko/'),
    ('en', 'convert', 'convert.html'),
    ('ko', 'convert', 'ko/convert.html'),
]
SITEMAP = 'sitemap.xml'
USER_AGENT = 'neo3ds-seo-baseline/1 (+https://github.com/zzcx88/neo3ds)'


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read()
            return {
                'status': res.status,
                'content_type': res.headers.get('content-type', '').split(';')[0],
                'bytes': len(body),
                'elapsed_ms': int((time.monotonic() - started) * 1000),
                'body': body,
            }
    except urllib.error.HTTPError as err:
        return {'status': err.code, 'content_type': '', 'bytes': 0, 'elapsed_ms': 0, 'body': b''}
    except (urllib.error.URLError, TimeoutError) as err:
        return {'status': 0, 'error': str(err), 'content_type': '', 'bytes': 0, 'elapsed_ms': 0, 'body': b''}


def attr(tag, name):
    m = re.search(r'\b%s\s*=\s*"([^"]*)"' % re.escape(name), tag)
    return m.group(1) if m else None


def page_head(html):
    """The search-facing declarations of one page, as published."""
    title = re.search(r'<title>(.*?)</title>', html, re.S)
    desc = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', html)
    canon = re.search(r'<link\s+rel="canonical"\s+href="([^"]*)"', html)
    alternates = {}
    for tag in re.findall(r'<link\b[^>]*rel="alternate"[^>]*>', html):
        lang = attr(tag, 'hreflang')
        if lang:
            alternates[lang] = attr(tag, 'href')
    ld = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            ld.append('invalid-json')
            continue
        ld.append(data.get('@type', 'unknown') if isinstance(data, dict) else 'unknown')
    return {
        'title': title.group(1).strip() if title else None,
        'description': desc.group(1) if desc else None,
        'canonical': canon.group(1) if canon else None,
        'hreflang': dict(sorted(alternates.items())),
        'jsonld_types': ld,
        'html_lang': attr(re.search(r'<html\b[^>]*>', html).group(0), 'lang')
        if re.search(r'<html\b[^>]*>', html) else None,
    }


def sitemap_urls(body):
    text = body.decode('utf-8', 'replace')
    return re.findall(r'<loc>(.*?)</loc>', text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=SITE, help='site base URL (default: live GitHub Pages)')
    ap.add_argument('--out', help='write the JSON here as well as to stdout')
    args = ap.parse_args()
    base = args.base if args.base.endswith('/') else args.base + '/'

    problems = []
    pages = []
    for locale, kind, path in LANDING:
        url = base + path
        got = fetch(url)
        row = {'locale': locale, 'page': kind, 'url': url,
               'status': got['status'], 'content_type': got['content_type'],
               'bytes': got['bytes'], 'elapsed_ms': got['elapsed_ms']}
        if got['status'] != 200:
            problems.append('%s: HTTP %s' % (url, got['status']))
        else:
            head = page_head(got['body'].decode('utf-8', 'replace'))
            row.update(head)
            if not head['canonical']:
                problems.append('%s: no canonical' % url)
            if not head['description'] or len(head['description']) < 60:
                problems.append('%s: description missing or short' % url)
            if not head['hreflang']:
                problems.append('%s: no hreflang alternates' % url)
            if not head['jsonld_types']:
                problems.append('%s: no JSON-LD' % url)
        pages.append(row)

    sm_url = base + SITEMAP
    sm = fetch(sm_url)
    locs = sitemap_urls(sm['body']) if sm['status'] == 200 else []
    listed = {SITE + path for _, _, path in LANDING}
    missing = sorted(listed - set(locs))
    if sm['status'] != 200:
        problems.append('%s: HTTP %s' % (sm_url, sm['status']))
    if missing:
        problems.append('%s: sitemap omits %s' % (sm_url, ', '.join(missing)))

    robots = fetch(base + 'robots.txt')
    robots_text = robots['body'].decode('utf-8', 'replace') if robots['status'] == 200 else ''
    declares_sitemap = 'sitemap:' in robots_text.lower()

    payload = {
        'recorded_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'base': base,
        'note': 'Public crawl facts only. Search Console queries/clicks and Umami numbers '
                'are not visible from here; record those by hand in docs/SEO-BASELINE.md.',
        'pages': pages,
        'sitemap': {'url': sm_url, 'status': sm['status'], 'url_count': len(locs),
                    'lists_all_landing_urls': not missing},
        'robots': {'url': base + 'robots.txt', 'status': robots['status'],
                   'declares_sitemap': declares_sitemap},
        'problems': problems,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    print(text)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text + '\n')
    if problems:
        for p in problems:
            print('seo baseline: %s' % p, file=sys.stderr)
        return 1
    print('seo baseline OK: %d landing URLs, sitemap %d URLs, robots %s'
          % (len(pages), len(locs), robots['status']), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
