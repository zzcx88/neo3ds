"""Builds converter/assets/neogeo_games.json from MAME's src/mame/snk/neogeo.cpp (BSD-3-Clause).

usage: python scripts/gen_gamedb.py path/to/neogeo.cpp converter/assets/neogeo_games.json

Each game keeps MAME's ROM loading steps per region, so the converter can rebuild the
same memory images: maincpu, fixed, audiocpu / audiocrypt, ymsnd:adpcma, ymsnd:adpcmb, sprites.
"""
import json
import re
import sys

SKIP_REGIONS = {'mainbios', 'audiobios', 'fixedbios', 'spritegen:zoomy', 'mcu', 'pld', 'hd64180'}
LOAD_FLAGS = {
    'ROM_LOAD': '',
    'ROM_LOAD16_BYTE': '16b',
    'ROM_LOAD16_WORD_SWAP': '16ws',
    'ROM_LOAD32_BYTE': '32b',
    'ROM_LOAD32_WORD_SWAP': '32ws',
}
AUDIO_SIZES = {'64K': 0x10000, '128K': 0x20000, '256K': 0x40000, '512K': 0x80000}


def num(s):
    return int(s.strip(), 0)


def split_args(s):
    """Splits a macro argument list on top-level commas (quotes and parentheses respected)."""
    out, depth, cur, quote = [], 0, '', False
    for ch in s:
        if quote:
            cur += ch
            if ch == '"':
                quote = False
            continue
        if ch == '"':
            quote = True
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif ch == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
            continue
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def crc_of(hashes):
    m = re.search(r'CRC\(\s*([0-9a-fA-F]{8})\s*\)', hashes)
    return m.group(1).lower() if m else None


def macro_calls(body):
    """Yields (macro, args) for each ROM_* / NEO_* call in a ROM_START block, comments removed."""
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'//[^\n]*', '', body)
    for m in re.finditer(r'\b((?:ROM|NEO)_[A-Z0-9_]+)\s*\(', body):
        start = m.end()
        depth, i = 1, start
        while depth:
            depth += {'(': 1, ')': -1}.get(body[i], 0)
            i += 1
        yield m.group(1), split_args(body[start:i - 1])


def parse_roms(src):
    roms = {}
    for m in re.finditer(r'ROM_START\(\s*(\w+)\s*\)(.*?)ROM_END', src, flags=re.S):
        name, body = m.group(1), m.group(2)
        regions, cur = {}, None

        def region(rname, size):
            nonlocal cur
            rname = rname.strip('"').replace('cslot1:', '')
            if rname in SKIP_REGIONS:
                cur = None
                return
            cur = regions.setdefault(rname, {'size': size, 'ops': []})

        def op(*a):
            if cur is not None:
                cur['ops'].append(list(a))

        for mac, args in macro_calls(body):
            if mac in ('ROM_REGION', 'ROM_REGION16_BE'):
                region(args[1], num(args[0]))
            elif mac in LOAD_FLAGS:
                op('load', LOAD_FLAGS[mac], args[0].strip('"'), crc_of(args[3]), num(args[1]), num(args[2]))
            elif mac == 'ROM_CONTINUE':
                op('cont', num(args[0]), num(args[1]))
            elif mac == 'ROM_RELOAD':
                op('reload', num(args[0]), num(args[1]))
            elif mac == 'ROM_IGNORE':
                op('ignore', num(args[0]))
            elif mac == 'ROM_FILL':
                op('fill', num(args[0]), num(args[1]), num(args[2]))
            elif mac == 'ROM_COPY':
                op('copy', args[0].strip('"').replace('cslot1:', ''), num(args[1]), num(args[2]), num(args[3]))
            elif mac.startswith('NEO_SFIX_'):
                region('fixed', 0x20000)
                size = 0x10000 if mac.endswith('64K') else 0x20000
                op('load', '', args[0].strip('"'), crc_of(args[1]), 0, size)
            elif mac.startswith('NEO_BIOS_AUDIO_'):
                size = AUDIO_SIZES[mac.rsplit('_', 1)[1]]
                if 'ENCRYPTED' in mac:
                    region('audiocrypt', 0x80000)
                    op('load', '', args[0].strip('"'), crc_of(args[1]), 0, size)
                else:
                    region('audiocpu', 0x10000 + size)
                    op('load', '', args[0].strip('"'), crc_of(args[1]), 0, size)
                    op('reload', 0x10000, size)
            # ROM_Y_ZOOM, ROM_SYSTEM_BIOS, ROM_DEFAULT_BIOS...: BIOS files come from neogeo.zip
        roms[name] = regions
    return roms


def parse_carts(src):
    """machine config name -> cart type it plugs in (cartslot_fixed), e.g. kof99 -> sma_kof99."""
    carts = {}
    for m in re.finditer(r'void \w+::(\w+)\(machine_config &config\)\s*\{(.*?)\n\}', src, flags=re.S):
        c = re.search(r'cartslot_fixed\(config, "(\w+)"\)', m.group(2))
        if c:
            carts[m.group(1)] = c.group(1)
    return carts


def parse_games(src):
    games = []
    for m in re.finditer(r'^GAME\((.*)\)\s*(?://.*|/\*.*)?$', src, flags=re.M):
        a = split_args(m.group(1))
        year, name, parent, machine = a[0], a[1], a[2], a[3]
        games.append({
            'name': name,
            'parent': None if parent in ('neogeo', '0') else parent,
            'year': year.strip('"'),
            'maker': a[8].strip('"'),
            'desc': a[9].strip('"'),
            'machine': machine,
        })
    return games


def main():
    src = open(sys.argv[1], encoding='utf-8').read()
    roms = parse_roms(src)
    games = parse_games(src)
    carts = parse_carts(src)
    out = []
    for g in games:
        if g['name'] not in roms:
            print('no ROM_START for', g['name'])
            continue
        g['cart'] = carts.get(g['machine'], 'rom')
        g['regions'] = roms[g['name']]
        out.append(g)
    with open(sys.argv[2], 'w', encoding='utf-8', newline='\n') as f:
        f.write('[\n' + ',\n'.join(json.dumps(g, ensure_ascii=False, separators=(',', ':')) for g in out) + '\n]\n')
    print(len(out), 'games')


main()
