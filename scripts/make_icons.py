#!/usr/bin/env python3
"""Draw simple aquarium icons. No third-party image libraries."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"
TEAL = (14, 92, 85, 255)
WATER = (226, 238, 234, 255)
PAPER = (244, 241, 234, 255)
INK = (22, 48, 44, 255)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pixel) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def fish(x: int, y: int, size: int, maskable: bool = False):
    nx = x / (size - 1)
    ny = y / (size - 1)
    if maskable and (nx < 0.12 or nx > 0.88 or ny < 0.12 or ny > 0.88):
        return TEAL
    # water disc
    dx = (nx - 0.50) / 0.34
    dy = (ny - 0.52) / 0.30
    if dx * dx + dy * dy <= 1:
        # body
        bx = (nx - 0.54) / 0.16
        by = (ny - 0.52) / 0.09
        if bx * bx + by * by <= 1:
            ex = (nx - 0.63) / 0.018
            ey = (ny - 0.49) / 0.018
            if ex * ex + ey * ey <= 1:
                return INK
            return PAPER
        # tail
        if 0.30 <= nx <= 0.40 and abs(ny - 0.52) < (0.40 - nx) * 0.7:
            return PAPER
        return WATER
    return TEAL


def main() -> None:
    write_png(ROOT / "icon-512.png", 512, lambda x, y, s: fish(x, y, s))
    write_png(ROOT / "icon-512-maskable.png", 512, lambda x, y, s: fish(x, y, s, True))
    write_png(ROOT / "icon-192.png", 192, lambda x, y, s: fish(x, y, s))
    write_png(ROOT / "apple-touch-icon.png", 180, lambda x, y, s: fish(x, y, s))
    write_png(ROOT / "favicon-32.png", 32, lambda x, y, s: fish(x, y, s))


if __name__ == "__main__":
    main()
