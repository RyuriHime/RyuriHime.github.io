#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Slice prepared wallpapers into shuffled byte fragments.

Reads the optimized WebP files in `source/assets/private/` (gitignored) and
writes randomly named binary fragments plus an ordered manifest to
`source/assets/wallpaper/` (committed). The originals are never modified.

Why bytes instead of visual tiles: the browser can concatenate the fragments
back into the exact original WebP and decode it. That keeps every pixel and
every byte identical to before and costs no extra encode time. Visual tiles
would require a canvas re-encode, which either loses pixels or blocks the main
thread for hundreds of milliseconds.

This is obfuscation, not encryption. Downloading a fragment gives a useless
blob of bytes; rebuilding the picture requires the manifest order.
"""
from __future__ import annotations

import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source" / "assets" / "private"
OUT = ROOT / "source" / "assets" / "wallpaper"
CHUNKS = OUT / "chunks"

ROLES = {
    "banner": "banner-main.webp",
    "banner-alt": "banner-alt.webp",
    "banner-mobile": "banner-mobile.webp",
    "reading": "reading-main.webp",
    "reading-mobile": "reading-mobile.webp",
}

CHUNK_SIZE = 96 * 1024


def digest(data) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha1(data).hexdigest()


def split_role(role: str, path: Path) -> tuple[dict, int]:
    raw = path.read_bytes()
    seed = digest(raw)[:16]
    pieces = [raw[i:i + CHUNK_SIZE] for i in range(0, len(raw), CHUNK_SIZE)]

    entries = []
    for index, piece in enumerate(pieces):
        name = f"{role.replace('-', '')}-{digest(f'{seed}:{index}:{piece.hex()}')[:12]}.bin"
        (CHUNKS / name).write_bytes(piece)
        entries.append({"f": name, "i": index})

    # The manifest array itself is shuffled; each entry carries its byte index
    # so the browser can sort at runtime before concatenating.
    random.Random(int(seed, 16)).shuffle(entries)

    meta = {
        "size": len(raw),
        "type": "image/webp",
        "chunks": entries,
    }
    return meta, len(pieces)


def main() -> int:
    existing = {role: SRC / name for role, name in ROLES.items() if (SRC / name).is_file()}
    if not existing:
        print("[obfuscate] no prepared wallpapers; keeping existing fragments")
        return 0

    if CHUNKS.is_dir():
        shutil.rmtree(CHUNKS)
    if (OUT / "tiles").is_dir():
        shutil.rmtree(OUT / "tiles")
    CHUNKS.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    roles: dict[str, dict] = {}
    total = 0
    for role, path in existing.items():
        meta, count = split_role(role, path)
        roles[role] = meta
        total += count
        print(f"[obfuscate] {role:14s} {meta['size'] / 1024:7.1f} KiB -> {count} chunks")

    manifest = {"version": 3, "chunk": CHUNK_SIZE, "roles": roles}
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size = sum(f.stat().st_size for f in CHUNKS.glob("*.bin"))
    print(f"[obfuscate] {total} chunks, {size / 1024:.0f} KiB -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
