"""Keeps site/llms.txt in step with the game database and the series pages (#351).

llms.txt is not generated, so nothing else notices when it goes stale: a romset count
drifts, a series page disappears, or the file stops being linked at all. This checks the
claims it makes against the same sources the site is built from.

usage: python3 scripts/check_llms_txt.py
"""
import json
import os
import re
import sys

LLMS = 'site/llms.txt'
GAMES = 'site/games.js'
SERIES_DATA = 'scripts/site_series_data.py'


def load_counts():
    with open(GAMES, encoding='utf-8') as f:
        src = f.read()
    src = re.sub(r'^//.*$', '', src, flags=re.M)
    src = src.replace('window.NEO3DS_DB = ', '').strip().rstrip(';')
    db = json.loads(src)
    rows = {g[0]: g for g in db['games']}
    counts = db['counts']
    return rows, counts


def series_counts(rows):
    sys.path.insert(0, 'scripts')
    from site_series_data import SERIES
    out = {}
    for s in SERIES:
        sub = [rows[k] for k in s['sets'] if k in rows]
        out[s['slug']] = (len(sub),
                          sum(1 for r in sub if r[6] != 2),
                          sum(1 for r in sub if r[6] == 1))
    return out


def main():
    problems = []
    if not os.path.exists(LLMS):
        print('%s is missing (#351)' % LLMS, file=sys.stderr)
        return 1
    with open(LLMS, encoding='utf-8') as f:
        text = f.read()

    rows, counts = load_counts()

    # Header claim: 242 of the 282 romsets convert, 26 played on hardware.
    m = re.search(r'(\d+) of the (\d+) romsets in its game(.|\n){0,160}?(\d+) of those have been played', text)
    if not m:
        problems.append('header no longer states the romset counts')
    else:
        if int(m.group(1)) != counts['ok'] or int(m.group(2)) != counts['total']:
            problems.append('header says %s of %s; database says %s of %s'
                            % (m.group(1), m.group(2), counts['ok'], counts['total']))
        if int(m.group(4)) != counts['verified']:
            problems.append('header says %s verified; database says %s'
                            % (m.group(4), counts['verified']))

    # Every series page is listed once, with matching per-series counts.
    want = series_counts(rows)
    for slug, (n, ok, ver) in sorted(want.items()):
        m = re.search(r'/series/%s\.html\): (\d+) romsets, (\d+) convert(?:, (\d+) verified)?'
                      % re.escape(slug), text)
        if not m:
            problems.append('%s: no line with romset counts' % slug)
            continue
        got = (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
        if got != (n, ok, ver):
            problems.append('%s: says %s, database says %s' % (slug, got, (n, ok, ver)))

    # Links must point at pages that exist.
    for href in re.findall(r'\((https://zzcx88\.github\.io/neo3ds/[^)]*)\)', text):
        rel = href.split('neo3ds/', 1)[1]
        if rel in ('', '/'):
            path = 'site/index.html'
        elif rel.endswith('/'):
            path = 'site/%sindex.html' % rel
        else:
            path = 'site/%s' % rel
        if not os.path.exists(path):
            problems.append('broken link: %s (no %s)' % (href, path))

    if problems:
        for p in problems:
            print('llms.txt: %s' % p, file=sys.stderr)
        return 1

    print('llms.txt OK: %d romsets, %d series pages' % (counts['total'], len(want)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
