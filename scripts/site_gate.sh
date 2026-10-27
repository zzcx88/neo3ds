#!/usr/bin/env bash
# Site gates for site/ (#130): syntax, tag balance, translation coverage, generated-file drift.
# Runs in CI (Pages build + pull requests) and locally from the repo root: bash scripts/site_gate.sh
set -euo pipefail

cd "$(dirname -- "${BASH_SOURCE[0]}")/.."

for f in site/app.js site/convert.js site/vendor/conv/*.js site/vendor/conv/*.mjs \
         site/vendor/*.mjs site/vendor/bench/* scripts/gen_site_i18n.mjs; do
  node --check "$f"
done
echo "syntax OK"

python3 - << 'EOF'
import html.parser

class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.stack = []; self.errs = []
        self.void = {'meta', 'link', 'input', 'br', 'img', 'hr'}
    def handle_starttag(self, tag, attrs):
        if tag not in self.void: self.stack.append((tag, self.getpos()))
    def handle_endtag(self, tag):
        if tag in self.void: return
        if self.stack and self.stack[-1][0] == tag: self.stack.pop()
        else: self.errs.append(f'{tag}@{self.getpos()}')

pages = ['site/index.html', 'site/convert.html', 'site/compat.html', 'site/privacy.html', 'site/manual.html',
         'site/ko/index.html', 'site/ko/convert.html', 'site/ko/compat.html', 'site/ko/privacy.html',
         'site/ko/manual.html']
for page in pages:
    p = P(); p.feed(open(page, encoding='utf-8').read())
    assert not p.errs and not p.stack, f'{page}: {p.errs} {p.stack}'
print(f'tags OK: {len(pages)} pages')
EOF

node -e "
const fs = require('node:fs');
const src = fs.readFileSync('site/app.js', 'utf8');
const en = new Function('return (' + src.match(/const EN = (\{[\s\S]*?\n\});/)[1] + ');')();

for (const page of ['site/ko/index.html', 'site/ko/convert.html', 'site/ko/privacy.html', 'site/ko/manual.html']) {
  const html = fs.readFileSync(page, 'utf8');
  const keys = [...html.matchAll(/data-i18n=\"([^\"]+)\"/g)].map((m) => m[1]);
  for (const m of html.matchAll(/data-i18n-attr=\"([^\"]+)\"/g))
    for (const pair of m[1].split(',')) keys.push(pair.split(':')[1]);
  const missing = keys.filter((k) => !(k in en));
  if (missing.length) { console.error(page, 'missing EN:', missing); process.exit(1); }
}

for (const page of ['site/index.html', 'site/convert.html', 'site/compat.html', 'site/privacy.html', 'site/manual.html']) {
  const html = fs.readFileSync(page, 'utf8');
  if (html.includes('data-i18n')) { console.error(page, 'still has i18n bindings'); process.exit(1); }
  if (/[\uac00-\ud7a3]/.test(html)) { console.error(page, 'still has Korean text'); process.exit(1); }
}
const UMAMI_ID = 'data-website-id=\"cf5cd373-6021-4643-a392-c3823e8f3cdd\"';
const UMAMI_DOMAINS = 'data-domains=\"zzcx88.github.io\"';
for (const page of ['site/index.html', 'site/convert.html', 'site/compat.html',
  'site/ko/index.html', 'site/ko/convert.html', 'site/ko/compat.html',
  'site/manual.html', 'site/ko/manual.html']) {
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes(UMAMI_ID) || !html.includes(UMAMI_DOMAINS)) {
    console.error(page, 'missing Umami tracker (#125)');
    process.exit(1);
  }
}
console.log('i18n + analytics OK');
"

# Generated pages must match their sources: a stale commit fails here instead of on main.
python3 scripts/gen_site_games.py > /dev/null
node scripts/gen_site_i18n.mjs --check
python3 scripts/gen_site_seo.py --check
git diff --exit-code -- site/games.js site/compat.html site/ko/compat.html site/sitemap.xml site/privacy.html site/manual.html || {
  echo 'generated site files are out of date: site/games.js, site/compat.html, site/ko/compat.html, site/sitemap.xml, site/privacy.html, site/manual.html' >&2
  exit 1
}
# The control table is duplicated in README and manual.html; keep them saying the same thing (#162).
python3 - << 'EOF'
import html, re, sys

def norm(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return re.sub(r'\s*([/+])\s*', r'\1', s)

def readme_rows(path, heading):
    text = open(path, encoding='utf-8').read()
    out = []
    for line in text[text.index(heading):].splitlines()[1:]:
        if line.startswith('#'):
            break
        m = re.match(r'^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$', line)
        if not m or m.group(1) == '3DS' or set(m.group(1)) <= set('- '):
            continue
        out.append([norm(m.group(1)), norm(m.group(2))])
    return out

def page_rows(path):
    text = open(path, encoding='utf-8').read()
    out = []
    for row in re.findall(r'<tr class="map-row">(.*?)</tr>', text, re.S):
        cells = []
        for cls in ('map-keys', 'map-ng'):
            m = re.search(r'<td class="%s"[^>]*>(.*?)</td>' % cls, row, re.S)
            cells.append(norm(m.group(1)))
        out.append(cells)
    return out

failed = False
for page, readme, heading in (('site/ko/manual.html', 'README.ko.md', '### 조작'),
                              ('site/manual.html', 'README.md', '### Controls')):
    want, got = readme_rows(readme, heading), page_rows(page)
    if got != want:
        failed = True
        print('%s: control table differs from %s' % (page, readme), file=sys.stderr)
        for a, b in zip(want, got):
            if a != b:
                print('  README %r != page %r' % (a, b), file=sys.stderr)
if failed:
    sys.exit(1)
print('README control tables match manual.html')
EOF

echo "SITE GATES OK"
