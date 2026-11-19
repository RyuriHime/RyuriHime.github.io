#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Import a private wallpaper into the build-time-only asset directory.

The original file is copied to ``private-assets/`` outside the publishable
source tree. The public repository only receives the generated, optimized WebP
at build time, and that generated directory is gitignored as well.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROLES = ("hero", "hero-alt", "hero-mobile", "reading", "reading-mobile")
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def private_root() -> Path:
    root = project_root()
    for candidate in (root / "private-assets", root.parent / "private-assets", root.parent.parent / "private-assets"):
        if candidate.exists():
            return candidate.resolve()
    return (root.parent.parent / "private-assets").resolve()


def main() -> int:
    ap = argparse.ArgumentParser(description="Import a wallpaper without committing the original file.")
    ap.add_argument("image", help="path to a local png/jpg/webp image")
    ap.add_argument("--role", choices=ROLES, required=True, help="where the wallpaper is used")
    ap.add_argument("--prepare", action="store_true", help="regenerate derived WebP assets immediately")
    args = ap.parse_args()

    source = Path(args.image).expanduser().resolve()
    if not source.is_file():
        print(f"[wallpaper] file not found: {source}")
        return 2
    if source.suffix.lower() not in IMAGE_EXTS:
        print(f"[wallpaper] unsupported image type: {source.suffix}")
        return 2

    try:
        with Image.open(source) as im:
            width, height = im.size
    except Exception as exc:
        print(f"[wallpaper] cannot read image: {exc}")
        return 2

    destination_dir = private_root() / "wallpapers"
    destination_dir.mkdir(parents=True, exist_ok=True)
    extension = ".jpg" if source.suffix.lower() in {".jpg", ".jpeg"} else source.suffix.lower()
    destination = destination_dir / f"role-{args.role}{extension}"
    shutil.copy2(source, destination)
    print(f"[wallpaper] imported {args.role}: {width}x{height}")
    print(f"[wallpaper] private copy: {destination}")
    print("[wallpaper] the original stays outside the public repository")

    if args.prepare:
        script = project_root() / "tools" / "prepare_private_assets.py"
        subprocess.run([sys.executable, str(script)], cwd=project_root(), check=True)
    else:
        print("[wallpaper] run `pnpm run build` to regenerate the site")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
