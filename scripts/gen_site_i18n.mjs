// Static English pages for the site (#141): the default pages, served from the root.
//
// The Korean pages under site/ko/ are the source. This script renders site/index.html
// and site/convert.html from them by applying the EN strings that already live in
// site/app.js, so there is exactly one translation table for the whole site.
//
// usage: node scripts/gen_site_i18n.mjs [--check]
//   --check  render in memory and fail if the committed pages differ (CI drift gate)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SITE = 'https://zzcx88.github.io/neo3ds/';

// Head metadata per page. The KO side is hand-written in the HTML; this is the EN side.
const PAGES = {
  'index.html': {
    file: 'index.html',
    url: '',
    title: 'Neo Geo emulator & converter for 3DS | neo3ds',
    description: 'Turn Neo Geo (MAME) romsets into installable 3DS CIAs. Runs at 60 fps on an Old 3DS, one HOME menu icon per game. 242 of 282 romsets convert.',
    ogTitle: 'Neo Geo emulator & converter for 3DS | neo3ds',
    ogDescription: 'MAME romsets → installable 3DS CIAs. A Neo Geo emulator at 60 fps on an Old 3DS, plus a browser converter with nothing to install.',
    twitterDescription: 'MAME romsets → 3DS CIAs. 60 fps on an Old 3DS.',
    ogImageAlt: 'neo3ds — Neo Geo games on your 3DS HOME menu',
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'neo3ds',
      url: SITE,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Nintendo 3DS',
      isAccessibleForFree: true,
      inLanguage: ['ko', 'en'],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
      description: 'A Neo Geo (MAME) romset to 3DS CIA converter and emulator engine that runs on an Old 3DS.',
    },
  },
  'convert.html': {
    file: 'convert.html',
    url: 'convert.html',
    title: 'Neo Geo ROM to CIA converter — in your browser | neo3ds',
    description: 'Drop a game zip and it becomes a CIA inside your browser. Nothing is uploaded, nothing to install, no account. 242 of 282 romsets supported.',
    ogTitle: 'Neo Geo 3DS converter | neo3ds',
    ogDescription: 'Drop a zip, get a CIA. Converted in your browser — nothing leaves the tab.',
    twitterDescription: 'Drop a zip, get a CIA in your browser. Nothing uploaded.',
    ogImageAlt: 'neo3ds — convert roms to CIA in the browser',
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'neo3ds web converter',
      url: SITE + 'convert.html',
      applicationCategory: 'UtilitiesApplication',
      browserRequirements: 'A modern browser with WebAssembly',
      isAccessibleForFree: true,
      inLanguage: ['ko', 'en'],
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
      featureList: ['romset zip to CIA', 'runs entirely in the browser tab', 'batch conversion', 'custom icon and banner'],
    },
  },
};

// Root-relative asset references that must gain one `../` on a page inside site/en/.
const ASSET_PREFIXES = ['styles.css', 'app.js', 'games.js', 'convert.js', 'media/', 'fonts/'];
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const read = (p) => fs.readFileSync(p, 'utf8');

/** The one translation table: site/app.js owns the EN strings, the pages consume them. */
function loadEn() {
  const src = read('site/app.js');
  const m = src.match(/const EN = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error('site/app.js: `const EN = {...};` not found');
  return new Function('return (' + m[1] + ');')();
}

function parseTag(tag) {
  // tag: `name attr="v" ...` / `name attr="v" ... /`
  const selfClosing = /\/\s*$/.test(tag);
  const body = tag.replace(/\/\s*$/, '');
  const nameMatch = body.match(/^([a-zA-Z][\w:-]*)/);
  const name = nameMatch[1].toLowerCase();
  const attrs = [];
  const re = /([^\s=/]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  re.lastIndex = nameMatch[0].length;
  while ((m = re.exec(body))) attrs.push([m[1], m[2]]);
  return { name, attrs, selfClosing };
}

const emitTag = (name, attrs, selfClosing) =>
  '<' + name + attrs.map(([k, v]) => (v === undefined ? ' ' + k : ` ${k}="${v}"`)).join('') + (selfClosing ? ' /' : '') + '>';

const attr = (attrs, key) => {
  const hit = attrs.find(([k]) => k === key);
  return hit ? hit[1] : undefined;
};
const setAttr = (attrs, key, value) => {
  const hit = attrs.find(([k]) => k === key);
  if (hit) hit[1] = value;
  else attrs.push([key, value]);
};

const LANG_BLOCK = {
  en: `<div class="lang" role="group" aria-label="Language">
      <a href="{ko}">KO</a>
      <a href="{self}" aria-current="true">EN</a>
    </div>`,
};

/** Rewrite `page` from Korean into English. */
function render(src, key, en) {
  const page = PAGES[key];
  // The EN page is the root one; its Korean sibling lives one level down in site/ko/.
  const selfHref = key === 'index.html' ? './' : './' + key;
  const koHref = 'ko/' + (key === 'index.html' ? '' : key);
  let out = '';
  let i = 0;
  let skip = null;   // { key, depth } while inside a data-i18n element
  let depth = 0;

  const push = (s) => { if (!skip) out += s; };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { push(src.slice(i)); break; }
    push(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      // Korean notes for maintainers: the English page carries none.
      i = end + 3;
      continue;
    }

    // Find the end of the tag, ignoring '>' inside quoted values.
    let j = lt + 1, quote = null;
    while (j < src.length) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    const raw = src.slice(lt + 1, j);
    i = j + 1;

    if (raw.startsWith('/')) {
      const closesSkip = skip && depth === skip.depth;
      depth--;
      if (closesSkip) {
        out += en[skip.key] ?? '';
        skip = null;
        out += src.slice(lt, i);
      } else if (!skip) {
        out += src.slice(lt, i);
      }
      continue;
    }

    if (raw.startsWith('!') || raw.startsWith('?')) { push(src.slice(lt, i)); continue; }

    const tag = parseTag(raw);
    const isVoid = VOID.has(tag.name);

    // ── head metadata ────────────────────────────────────────────────
    if (tag.name === 'title') {
      const end = src.indexOf('</title>', i);
      out += `<title>${page.title}</title>`;
      i = end + '</title>'.length;
      continue;
    }

    if (tag.name === 'meta') {
      const name = attr(tag.attrs, 'name');
      const prop = attr(tag.attrs, 'property');
      const map = {
        description: page.description,
        'og:image': SITE + 'media/og.png',
        'og:title': page.ogTitle,
        'og:description': page.ogDescription,
        'og:url': SITE + page.url,
        'og:locale': 'en_US',
        'og:locale:alternate': 'ko_KR',
        'og:image:alt': page.ogImageAlt,
      };
      const twitterMap = {
        'twitter:title': page.ogTitle,
        'twitter:description': page.twitterDescription,
        'twitter:image': SITE + 'media/og.png',
      };
      if (name in map) setAttr(tag.attrs, 'content', map[name]);
      if (prop in map) setAttr(tag.attrs, 'content', map[prop]);
      if (name in twitterMap) setAttr(tag.attrs, 'content', twitterMap[name]);
      out += emitTag(tag.name, tag.attrs, tag.selfClosing);
      continue;
    }

    if (tag.name === 'link') {
      if (attr(tag.attrs, 'rel') === 'canonical') setAttr(tag.attrs, 'href', SITE + page.url);
      const href = attr(tag.attrs, 'href');
      const bare = href && href.startsWith('../') ? href.slice(3) : href;
      if (bare && ASSET_PREFIXES.some((p) => bare.startsWith(p))) setAttr(tag.attrs, 'href', bare);
      out += emitTag(tag.name, tag.attrs, tag.selfClosing);
      continue;
    }

    // ── language switch: KO page links out, EN page is the current one ──
    if (attr(tag.attrs, 'class') === 'lang') {
      const end = src.indexOf('</div>', i);
      out += LANG_BLOCK.en.replace('{ko}', koHref).replace('{self}', './');
      i = end + '</div>'.length;
      continue;
    }

    // ── JSON-LD is rebuilt from the page table ───────────────────────
    if (tag.name === 'script' && attr(tag.attrs, 'type') === 'application/ld+json') {
      const end = src.indexOf('</script>', i);
      out += `<script type="application/ld+json">\n${JSON.stringify(page.jsonld, null, 2)}\n</script>`;
      i = end + '</script>'.length;
      continue;
    }

    // ── raw-text elements: rewrite the tag, copy the body untouched ──
    if (RAW_TEXT.has(tag.name)) {
      const src2 = attr(tag.attrs, 'src');
      const bareSrc = src2 && src2.startsWith('../') ? src2.slice(3) : src2;
      if (bareSrc && ASSET_PREFIXES.some((p) => bareSrc.startsWith(p))) setAttr(tag.attrs, 'src', bareSrc);
      out += emitTag(tag.name, tag.attrs, tag.selfClosing);
      const end = src.indexOf(`</${tag.name}>`, i);
      out += src.slice(i, end + tag.name.length + 3);
      i = end + tag.name.length + 3;
      continue;
    }

    // ── localised content ───────────────────────────────────────────
    const i18nKey = attr(tag.attrs, 'data-i18n');
    const i18nAttrs = attr(tag.attrs, 'data-i18n-attr');

    if (i18nAttrs) {
      for (const pair of i18nAttrs.split(',')) {
        const [name, k] = pair.split(':');
        if (!(k in en)) throw new Error(`${key}: data-i18n-attr ${k} has no EN string`);
        setAttr(tag.attrs, name, en[k]);
      }
    }
    const cleaned = tag.attrs.filter(([k]) => k !== 'data-i18n' && k !== 'data-i18n-attr');
    tag.attrs.length = 0;
    tag.attrs.push(...cleaned);

    const src2 = attr(tag.attrs, 'src');
    const bareSrc = src2 && src2.startsWith('../') ? src2.slice(3) : src2;
    if (bareSrc && ASSET_PREFIXES.some((p) => bareSrc.startsWith(p))) setAttr(tag.attrs, 'src', bareSrc);

    push(emitTag(tag.name, tag.attrs, tag.selfClosing));

    if (!isVoid) {
      depth++;
      if (i18nKey && !skip) {
        if (!(i18nKey in en)) throw new Error(`${key}: data-i18n ${i18nKey} has no EN string`);
        skip = { key: i18nKey, depth, tag: tag.name };
      }
    }
  }

  if (skip) throw new Error(`${key}: unclosed data-i18n element <${skip.tag}> for ${skip.key}`);
  return out.replace(/<html lang="ko">/, '<html lang="en">');
}

function main() {
  const check = process.argv.includes('--check');
  const en = loadEn();
  const drift = [];
  for (const key of Object.keys(PAGES)) {
    const page = PAGES[key];
    const src = read(path.join('site/ko', key));
    const out = render(src, key, en);
    const target = path.join('site', page.file);
    if (check) {
      const onDisk = fs.existsSync(target) ? read(target) : null;
      if (onDisk !== out) drift.push(page.file);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, out);
      console.log(`${page.file}: ${out.length} bytes`);
    }
  }
  if (drift.length) {
    console.error('EN pages out of date (run: node scripts/gen_site_i18n.mjs): ' + drift.join(', '));
    process.exit(1);
  }
  if (check) console.log('EN pages up to date');
}

main();
