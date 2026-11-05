#!/usr/bin/env python3
"""Writes a QR code holding a text to a PNG, for Azahar's still image camera.

usage: py scripts/recv_test_qr.py <text> <out.png> [module pixels]
       py scripts/recv_test_qr.py --blank <out.png>
Needs the qrcode package (pip install qrcode); no image library.
"""
import struct
import sys
import zlib

W, H = 640, 480


def png(path, rows):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    raw = b"".join(b"\0" + bytes(row) for row in rows)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 0, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw)))
        f.write(chunk(b"IEND", b""))


def main():
    text, path = sys.argv[1], sys.argv[2]
    rows = [[255] * W for _ in range(H)]
    if text != "--blank":
        import qrcode

        # As the converter: ECC L only for a list of addresses
        level = qrcode.constants.ERROR_CORRECT_L if "\n" in text else qrcode.constants.ERROR_CORRECT_M
        qr = qrcode.QRCode(border=0, error_correction=level)
        qr.add_data(text)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        print(f"{len(text)} bytes, {len(matrix)} modules")
        # The camera halves this picture to 320x240
        MODULE = int(sys.argv[3]) if len(sys.argv) > 3 else min(8, H // len(matrix))
        size = len(matrix) * MODULE
        x0, y0 = (W - size) // 2, (H - size) // 2
        for j, line in enumerate(matrix):
            for i, dark in enumerate(line):
                if dark:
                    for y in range(y0 + j * MODULE, y0 + (j + 1) * MODULE):
                        for x in range(x0 + i * MODULE, x0 + (i + 1) * MODULE):
                            rows[y][x] = 0
    png(path, rows)


if __name__ == "__main__":
    main()
