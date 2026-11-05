#!/usr/bin/env python3
"""Damaged game files for the launcher's check (loader_check_pack), and the same check on real ones.

usage: py scripts/recv_test_pack.py <good.neo3ds> <out folder>   writes bad-<kind>.neo3ds
       py scripts/recv_test_pack.py --check <file.neo3ds> ...    good files must pass these rules
"""
import os
import struct
import sys

ENTRY = 32
HEAD = 16
INDEX_HEAD = 20  # "NEOC", version, tiles, block size, blocks


def entries(data):
    if data[:8] != b"NEO3DSPK":
        raise ValueError("no magic")
    _, count = struct.unpack_from("<II", data, 8)
    found = {}
    for i in range(count):
        at = HEAD + i * ENTRY
        name = data[at:at + 24].split(b"\0")[0].decode("ascii")
        offset, size = struct.unpack_from("<II", data, at + 24)
        found[name] = (at, offset, size)
    return found


def damage(good, out):
    data = open(good, "rb").read()
    e = entries(data)
    idx_offset = e["c.idx"][1]
    version, tiles, block, blocks = struct.unpack_from("<IIII", data, idx_offset + 4)
    offsets_at = idx_offset + INDEX_HEAD

    def write(kind, change):
        d = bytearray(data)
        change(d)
        with open(os.path.join(out, f"bad-{kind}.neo3ds"), "wb") as f:
            f.write(d)

    write("p0", lambda d: struct.pack_into("<I", d, e["p.bin"][0] + 28, 0))
    write("block1", lambda d: struct.pack_into("<I", d, idx_offset + 12, 1))
    write("midoffset", lambda d: struct.pack_into("<I", d, offsets_at + blocks // 2 * 4, 0xFFFFFF00))

    def unordered(d):
        first, second = struct.unpack_from("<II", d, offsets_at + 4)
        struct.pack_into("<I", d, offsets_at + 4, second + 1)

    write("unordered", unordered)
    write("fewblocks", lambda d: struct.pack_into("<I", d, idx_offset + 16, 1))


def check(path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        data = f.read(HEAD + 64 * ENTRY)
        e = entries(data)
        for name in ("p.bin", "s.bin", "m1.bin", "v.bin", "lo.bin", "c.idx", "c.pak"):
            if name not in e or e[name][2] == 0:
                return f"{name} missing or empty"
        if e["p.bin"][2] < 0x80:
            return "p.bin too short"
        bios = [e[n] for n in ("bios_aes.bin", "bios_mvs.bin") if n in e]
        if not bios or any(b[2] < 0x80 for b in bios):
            return "no usable BIOS"
        for name, (_, offset, length) in e.items():
            if offset + length > size:
                return f"{name} past the end"
        f.seek(e["c.idx"][1])
        index = f.read(e["c.idx"][2])
    version, tiles, block, blocks = struct.unpack_from("<IIII", index, 4)
    if index[:4] != b"NEOC" or version not in (1, 2):
        return "bad index"
    if block < 128 or block > 0x100000 or not blocks:
        return f"block size {block}, {blocks} blocks"
    if INDEX_HEAD + (blocks + 1) * 4 + (tiles >> 4) * 4 > len(index):
        return "index too short"
    per = block >> 7
    if (tiles + per - 1) // per > blocks:
        return f"{tiles} tiles in {blocks} blocks of {per}"
    offsets = struct.unpack_from(f"<{blocks + 1}I", index, INDEX_HEAD)
    previous = 0
    for o in offsets:
        if o < previous or o > e["c.pak"][2]:
            return f"offset {o} after {previous}"
        previous = o
    return None


def main():
    if sys.argv[1] == "--check":
        bad = 0
        for path in sys.argv[2:]:
            wrong = check(path)
            print(f"{os.path.basename(path)}: {wrong or 'ok'}")
            bad += bool(wrong)
        print(f"{len(sys.argv) - 2 - bad} ok, {bad} refused")
        sys.exit(1 if bad else 0)
    damage(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
