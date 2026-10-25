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

pages = ['site/index.html', 'site/convert.html', 'site/compat.html',
         'site/en/index.html', 'site/en/convert.html', 'site/en/compat.html']
for page in pages:
    p = P(); p.feed(open(page, encoding='utf-8').read())
    assert not p.errs and not p.stack, f'{page}: {p.errs} {p.stack}'
print(f'tags OK: {len(pages)} pages')
EOF

node -e "
const fs = require('node:fs');
const src = fs.readFileSync('site/app.js', 'utf8');
const en = new Function('return (' + src.match(/const EN = (\{[\s\S]*?\n\});/)[1] + ');')();

for (const page of ['site/index.html', 'site/convert.html']) {
  const html = fs.readFileSync(page, 'utf8');
  const keys = [...html.matchAll(/data-i18n=\"([^\"]+)\"/g)].map((m) => m[1]);
  for (const m of html.matchAll(/data-i18n-attr=\"([^\"]+)\"/g))
    for (const pair of m[1].split(',')) keys.push(pair.split(':')[1]);
  const missing = keys.filter((k) => !(k in en));
  if (missing.length) { console.error(page, 'missing EN:', missing); process.exit(1); }
}

for (const page of ['site/en/index.html', 'site/en/convert.html']) {
  const html = fs.readFileSync(page, 'utf8');
  if (html.includes('data-i18n')) { console.error(page, 'still has i18n bindings'); process.exit(1); }
  if (/[\uac00-\ud7a3]/.test(html)) { console.error(page, 'still has Korean text'); process.exit(1); }
}
console.log('i18n OK');
"

# Generated pages must match their sources: a stale commit fails here instead of on main.
python3 scripts/gen_site_games.py > /dev/null
node scripts/gen_site_i18n.mjs --check
python3 scripts/gen_site_seo.py --check
git diff --exit-code -- site/games.js site/compat.html site/en/compat.html site/sitemap.xml || {
  echo 'generated site files are out of date: site/games.js, site/compat.html, site/en/compat.html, site/sitemap.xml' >&2
  exit 1
}
echo "SITE GATES OK"
