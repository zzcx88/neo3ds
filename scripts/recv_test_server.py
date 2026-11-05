#!/usr/bin/env python3
"""A test server for the launcher's receive screen: speaks like the converter's LanSender, or
answers wrongly on purpose.

usage: py scripts/recv_test_server.py <file> [--scenario NAME] [--name NAME] [--port N] [--slow-kbps N]

Prints the URL to give the launcher. Each request is logged with its status and the bytes sent.
"""
import argparse
import os
import socket
import urllib.parse

TOKEN = "0123456789abcdef"
SCENARIOS = ("ok", "404", "405", "short", "corrupt", "nolength", "chunked", "redirect", "twolengths", "huge", "truncheader")


def lan_address():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("192.0.2.1", 9))  # no packet is sent: this only picks the outgoing interface
        return s.getsockname()[0]


def read_request(conn):
    data = b""
    while b"\r\n\r\n" not in data and len(data) < 8192:
        chunk = conn.recv(4096)
        if not chunk:
            break
        data += chunk
    return data.decode("latin-1").split("\r\n")


def head(status, length=None, extra=""):
    text = f"HTTP/1.1 {status}\r\nContent-Type: application/octet-stream\r\n"
    if length is not None:
        text += f"Content-Length: {length}\r\n"
    return (text + extra + "Connection: close\r\n\r\n").encode("ascii")


def send_file(conn, path, limit, slow_kbps, corrupt=False):
    sent = 0
    with open(path, "rb") as f:
        while sent < limit:
            chunk = f.read(min(64 * 1024, limit - sent))
            if not chunk:
                break
            if corrupt and sent == 0:
                chunk = b"NOTAPACK" + chunk[8:]
            conn.sendall(chunk)
            sent += len(chunk)
            if slow_kbps:
                import time
                time.sleep(len(chunk) / (slow_kbps * 1024))
    return sent


def serve(conn, path, expected, scenario, slow_kbps):
    lines = read_request(conn)
    parts = lines[0].split(" ")
    if len(parts) < 2 or parts[1] != expected:
        conn.sendall(head("404 Not Found", 0))
        return "404 wrong path", 0
    method = parts[0]
    size = os.path.getsize(path)
    if scenario == "404":
        conn.sendall(head("404 Not Found", 0))
        return "404", 0
    if scenario == "405":
        conn.sendall(head("405 Method Not Allowed", 0))
        return "405", 0
    if scenario == "redirect":
        conn.sendall(head("302 Found", 0, "Location: http://192.0.2.1/x\r\n"))
        return "302", 0
    if scenario == "nolength":
        conn.sendall(head("200 OK"))
        return "200 no length", send_file(conn, path, size, slow_kbps)
    if scenario == "chunked":
        conn.sendall(head("200 OK", None, "Transfer-Encoding: chunked\r\n"))
        return "200 chunked", 0
    if scenario == "twolengths":
        conn.sendall(head("200 OK", size, f"Content-Length: {size + 1}\r\n"))
        return "200 two lengths", 0
    if scenario == "huge":
        conn.sendall(head("200 OK", 0xF0000000))
        return "200 huge", 0
    if scenario == "truncheader":
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Le")
        return "cut in the headers", 0
    conn.sendall(head("200 OK", size))
    if method != "GET":
        return f"{method} 200", 0
    if scenario == "short":
        return "200 short", send_file(conn, path, size // 2, slow_kbps)
    return "200", send_file(conn, path, size, slow_kbps, corrupt=scenario == "corrupt")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--scenario", choices=SCENARIOS, default="ok")
    ap.add_argument("--name", help="file name in the URL (default: the file's)")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--slow-kbps", type=int, default=0)
    ap.add_argument("--url-file", help="also write the URL to this file")
    args = ap.parse_args()

    address = lan_address()
    name = args.name or os.path.basename(args.file)
    expected = f"/{TOKEN}/{urllib.parse.quote(name, safe='')}"
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((address, args.port))
        listener.listen()
        url = f"http://{address}:{listener.getsockname()[1]}{expected}"
        print(url, flush=True)
        if args.url_file:
            with open(args.url_file, "w", encoding="ascii", newline="\n") as f:
                f.write(url + "\n")
        while True:
            conn, peer = listener.accept()
            with conn:
                try:
                    status, sent = serve(conn, args.file, expected, args.scenario, args.slow_kbps)
                    print(f"{peer[0]} {args.scenario}: {status}, {sent} bytes sent", flush=True)
                except OSError as e:
                    print(f"{peer[0]} {args.scenario}: dropped ({e})", flush=True)


if __name__ == "__main__":
    main()
