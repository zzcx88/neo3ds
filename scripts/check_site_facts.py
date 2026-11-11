"""Keeps factual tokens intact across a site copy rewrite (#347).

Copy edits are welcome; silently dropping a number, a romset name, a protection-chip
name or a URL is not. This compares the prose of the committed pages against a saved
baseline and reports every token that disappeared or appeared.

usage:
  python3 scripts/check_site_facts.py --save          # write the baseline (before a rewrite)
  python3 scripts/check_site_facts.py                 # fail if any token vanished
  python3 scripts/check_site_facts.py --allow kof98h  # approve one intended change
  python3 scripts/check_site_facts.py --list          # show the current tokens per page

Tokens compared, per page:
  - numbers that carry meaning: years, sizes, counts, fps, milliseconds, percentages
  - romset names: <name>.zip
  - uppercase acronyms of 3+ characters: protection chips, CPU cores, formats
  - absolute URLs

Table rows are dropped before scanning (compat.html is data, not prose), and the
legal/privacy pages are exempt: rewriting a disclosure is a policy change, not a
copy edit.

Baseline lives in scripts/site_facts_baseline.json. Regenerate it only after a
reviewed rewrite, in the same commit, so the diff shows what the edit intended.
"""
import argparse
import hashlib
import html as htmllib
import json
import os
import re
import sys

BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site_facts_baseline.json')

# Pages whose prose is copy-edited. Generated pages are included: they are rebuilt from
# sources, so a token that vanishes here has vanished in a template or in the data file.
PAGES = []
for _root in ('site', 'site/ko'):
    for _name in ('index.html', 'convert.html', 'download.html', 'manual.html',
                  'compat.html', 'changelog.html'):
        PAGES.append('%s/%s' % (_root, _name))
for _slug in ('metal-slug', 'king-of-fighters', 'samurai-shodown', 'fatal-fury',
              'art-of-fighting', 'last-blade', 'world-heroes', 'sengoku',
              'puzzle-bobble', 'shock-troopers', 'super-sidekicks', 'king-of-the-monsters'):
    PAGES.append('site/series/%s.html' % _slug)
    PAGES.append('site/ko/series/%s.html' % _slug)

# Rewriting a data-processing disclosure changes what the project promises, so the copy
# pass must not touch it. Excluded rather than silently unguarded.
EXEMPT = {'site/privacy.html', 'site/ko/privacy.html'}

# A token has to survive a rewrite in these forms. Ordered so a URL wins over the bare
# number inside it.
TOKEN_RE = re.compile(
    r'(?P<url>https?://[^\s<>")\]]+)'
    r'|(?P<zip>[a-z0-9][a-z0-9_]*\.zip)(?![a-z0-9_])'
    r'|(?P<acronym>[A-Z][A-Z0-9]{2,}[A-Z0-9])(?![A-Za-z0-9_])'
    r'|(?P<number>\d+(?:\.\d+)?(?:\s?(?:ms|fps|MB|KB|GB|MHz|%))?)(?![A-Za-z0-9_])'
)
# Note the lookaheads instead of \b: a Korean particle attaches straight to the token
# ("wh2j.zip을", "37.3MB입니다"), and \b treats Hangul as a word character, so the token
# would silently stop being visible to this check.

# Numbers that appear in navigation, version strings and generated counters but carry no
# claim: list positions, "1-3", section numbers. Dropped so a copy edit is not blamed for
# them. A real claim (242, 282, 26, 60, 16.7) survives because it is not in this set.
NOISE_NUMBERS = {'1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '15'}
NOISE_ACRONYMS = {'HTML', 'JSON', 'WASM'}  # build vocabulary, not a product fact


def visible_text(path):
    """The prose of a page: no scripts, no styles, no table rows, entities decoded."""
    with open(path, encoding='utf-8') as f:
        src = f.read()
    if '<main' in src:
        src = src[src.find('<main'):src.find('</main>')]
    src = re.sub(r'<script.*?</script>', ' ', src, flags=re.S)
    src = re.sub(r'<style.*?</style>', ' ', src, flags=re.S)
    src = re.sub(r'<tr.*?</tr>', ' ', src, flags=re.S)
    return htmllib.unescape(re.sub(r'<[^>]+>', ' ', src))


def tokens(text):
    out = set()
    for m in TOKEN_RE.finditer(text):
        kind, value = m.lastgroup, m.group(0)
        if kind == 'url':
            value = value.rstrip('.,;:')
        elif kind == 'number':
            if value in NOISE_NUMBERS:
                continue
        elif kind == 'acronym':
            if value in NOISE_ACRONYMS:
                continue
        out.add('%s:%s' % (kind, value))
    return out


def scan(root='.'):
    found = {}
    for page in PAGES:
        path = os.path.join(root, page)
        if not os.path.exists(path):
            continue
        if page in EXEMPT:
            continue
        found[page] = sorted(tokens(visible_text(path)))
    return found


def fingerprint(scan_result):
    """A stable digest, so the gate notices an unreviewed baseline refresh."""
    blob = json.dumps(scan_result, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return hashlib.sha256(blob).hexdigest()[:16]


def load_baseline():
    if not os.path.exists(BASELINE):
        return None
    with open(BASELINE, encoding='utf-8') as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--save', action='store_true', help='write the baseline from the current tree')
    ap.add_argument('--allow', nargs='*', default=[], help='tokens that may disappear, e.g. kof98h')
    ap.add_argument('--list', action='store_true', help='print every token per page')
    ap.add_argument('--root', default='.', help='tree to scan (default: repo root)')
    args = ap.parse_args()

    current = scan(args.root)

    if args.list:
        for page, toks in current.items():
            print(page)
            for t in toks:
                print('   ', t)
        return 0

    if args.save:
        payload = {'fingerprint': fingerprint(current), 'pages': current}
        with open(BASELINE, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write('\n')
        print('baseline written: %d pages, fingerprint %s'
              % (len(current), payload['fingerprint']))
        return 0

    baseline = load_baseline()
    if baseline is None:
        print('site facts: no baseline at %s. Run --save after reviewing the copy.' % BASELINE,
              file=sys.stderr)
        return 1

    allowed = {'%s' % a for a in args.allow}
    old_pages = baseline.get('pages', {})
    problems = []

    for page, now in current.items():
        before = set(old_pages.get(page, []))
        after = set(now)
        gone = sorted(before - after)
        new = sorted(after - before)
        # --allow approves a token in either direction: replacing 804MHz with 800MHz is
        # one intended edit, so both sides are named on the command line.
        gone = [g for g in gone if g.split(':', 1)[1] not in allowed]
        new = [n for n in new if n.split(':', 1)[1] not in allowed]
        if gone:
            problems.append((page, 'dropped', gone))
        if new:
            problems.append((page, 'added', new))

    for page in old_pages:
        if page not in current:
            problems.append((page, 'page missing', []))

    if not problems:
        print('site facts OK: %d pages, fingerprint %s' % (len(current), fingerprint(current)))
        return 0

    for page, kind, items in problems:
        print('%s: %s' % (page, kind), file=sys.stderr)
        for it in items:
            print('    %s' % it, file=sys.stderr)
    print('\nIf a change is intended, re-run with --allow <token> for a single fix, or '
          'refresh the baseline in the same commit as the reviewed rewrite (--save).',
          file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
