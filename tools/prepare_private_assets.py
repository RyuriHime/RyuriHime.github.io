#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Prepare private, paid visual assets for the blog build.

Source files stay outside the public repository. This script only writes
derived, optimized files into source/assets/private/, which is gitignored.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
ROLES = ("hero", "hero-alt", "hero-mobile", "reading", "reading-mobile")


def _role_of(path: Path) -> str | None:
    stem = path.stem.lower()
    for role in ROLES:
        prefix = f"role-{role}"
        if stem == prefix or stem.startswith(prefix + "-") or stem.startswith(prefix + "_"):
            return role
    return None


def find_wallpapers(src: Path) -> dict[str, Path]:
    files = [p for p in src.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    named: dict[str, Path] = {}

    # Explicit role files win. This is the supported way to "upload" a new
    # wallpaper without coupling the site to a vendor-specific CMS.
    for role in ROLES:
        matches = [p for p in files if _role_of(p) == role]
        if matches:
            matches.sort(key=lambda p: p.stat().st_size, reverse=True)
            named[role] = matches[0]

    # Keep compatibility with the original membership-wallpaper filenames.
    for p in files:
        n = p.name.lower()
        if "smartphone" in n or "mobile" in n or "portrait" in n:
            named.setdefault("hero-mobile", p)
        elif "nov" in n or "_pc" in n or "desktop" in n:
            named.setdefault("hero", p)
        elif "august" in n or "aug" in n or "8月" in p.name or "8gatsu" in n:
            named.setdefault("hero-alt", p)

    landscapes = []
    portraits = []
    for p in files:
        try:
            with Image.open(p) as im:
                (landscapes if im.width >= im.height else portraits).append(p)
        except Exception:
            continue
    landscapes.sort(key=lambda p: p.stat().st_size, reverse=True)
    portraits.sort(key=lambda p: p.stat().st_size, reverse=True)
    if "hero" not in named and landscapes:
        named["hero"] = landscapes[0]
    if "hero-alt" not in named:
        named["hero-alt"] = landscapes[1] if len(landscapes) > 1 else named.get("hero")
    if "hero-mobile" not in named:
        named["hero-mobile"] = portraits[0] if portraits else named.get("hero")
    if "reading" not in named:
        named["reading"] = named.get("hero-alt") or named.get("hero")
    if "reading-mobile" not in named:
        named["reading-mobile"] = named.get("hero-mobile") or named.get("reading")
    return {k: v for k, v in named.items() if v}


def export_webp(src: Path, dst: Path, size: tuple[int, int], centering=(0.5, 0.45)) -> dict:
    with Image.open(src) as im:
        im = im.convert("RGB")
        out = ImageOps.fit(im, size, method=Image.Resampling.LANCZOS, centering=centering)
        out.save(dst, "WEBP", quality=84, method=6)
    return {"source": str(src), "output": dst.name, "width": size[0], "height": size[1], "bytes": dst.stat().st_size}


def pick_cursor(src: Path) -> Path | None:
    cands = []
    for p in src.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() in {".cur", ".ani", ".png", ".webp"} and ("cursor" in str(p).lower() or "指针" in str(p)):
            cands.append(p)
    for ext in (".cur", ".ani", ".png", ".webp"):
        for p in cands:
            if p.suffix.lower() == ext:
                return p
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=None)
    ap.add_argument("--output", default="source/assets/private")
    args = ap.parse_args()

    if args.source:
        src = Path(args.source).resolve()
    else:
        candidates = [Path("private-assets"), Path("../private-assets"), Path("../../private-assets")]
        src = next((p.resolve() for p in candidates if p.exists()), candidates[-1].resolve())
    out = Path(args.output).resolve()
    if not src.exists():
        print(f"[private-assets] source not found: {src}")
        print("[private-assets] public fallback will be used")
        return 0
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("banner-*.webp"):
        old.unlink()
    for old in out.glob("cursor.*"):
        old.unlink()
    css_file = out / "private-assets.css"
    if css_file.exists():
        css_file.unlink()

    walls = find_wallpapers(src)
    if not walls:
        print("[private-assets] no wallpapers found; public fallback will be used")
        return 0

    manifest = {"source": str(src), "wallpapers": {}, "cursor": None}
    exports = (
        ("hero", "banner-main.webp", (2400, 900), (0.5, 0.42)),
        ("hero-alt", "banner-alt.webp", (2400, 900), (0.5, 0.42)),
        ("hero-mobile", "banner-mobile.webp", (1200, 1600), (0.5, 0.34)),
        ("reading", "reading-main.webp", (2400, 1350), (0.5, 0.38)),
        ("reading-mobile", "reading-mobile.webp", (1200, 2000), (0.42, 0.32)),
    )
    for role, filename, size, centering in exports:
        if walls.get(role):
            manifest["wallpapers"][role] = export_webp(walls[role], out / filename, size, centering)

    cursor = pick_cursor(src)
    if cursor:
        dst = out / f"cursor{cursor.suffix.lower()}"
        shutil.copy2(cursor, dst)
        manifest["cursor"] = {"source": str(cursor), "output": dst.name}
        if dst.suffix.lower() == ".cur":
            try:
                with Image.open(dst) as im:
                    im.save(out / "cursor.png")
                manifest["cursor"]["preview"] = "cursor.png"
            except Exception:
                pass

    css = ["/* Generated at build time. Do not commit. */", ":root {"]
    css.append("  --vtuber-banner: url('/assets/private/banner-main.webp');")
    css.append("  --vtuber-banner-alt: url('/assets/private/banner-alt.webp');")
    css.append("  --vtuber-banner-mobile: url('/assets/private/banner-mobile.webp');")
    if "reading" in manifest["wallpapers"]:
        css.append("  --vtuber-reading: url('/assets/private/reading-main.webp');")
    if "reading-mobile" in manifest["wallpapers"]:
        css.append("  --vtuber-reading-mobile: url('/assets/private/reading-mobile.webp');")
    if manifest["cursor"]:
        ext = manifest["cursor"]["output"].rsplit(".", 1)[-1]
        css.append(f"  --vtuber-cursor: url('/assets/private/cursor.{ext}') 4 4, auto;")
        css.append(f"  --vtuber-cursor-pointer: url('/assets/private/cursor.{ext}') 4 4, pointer;")
    css.append("}")
    css_file.write_text("\n".join(css) + "\n", encoding="utf-8")
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[private-assets] prepared:")
    for key, item in manifest["wallpapers"].items():
        print(f"  {key:6s} <- {Path(item['source']).name} -> {item['output']} ({item['bytes']/1024:.0f} KiB)")
    if manifest["cursor"]:
        print(f"  cursor <- {Path(manifest['cursor']['source']).name} -> {manifest['cursor']['output']}")
    else:
        print("  cursor <- not found (add a .cur/.ani/.png under private-assets/cursor/)")
    print(f"[private-assets] css: {css_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
