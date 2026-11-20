#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Local-only writing desk for the Hexo blog.

Run `pnpm run admin` and open http://127.0.0.1:4010. The server edits source
Markdown/YAML in place and can trigger a rebuild. It binds to loopback only and
is never copied into the generated public site.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser

import yaml
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "source"
POSTS = SOURCE / "_posts"
ADMIN_UI = Path(__file__).resolve().parent / "admin_ui"
VENDOR = ROOT / "node_modules"
CONFIGS = [ROOT / "_config.yml", ROOT / "_config.butterfly.yml"]
PROFILE = SOURCE / "_data" / "profile.yml"
SITE_CONFIG = ROOT / "_config.yml"
THEME_CONFIG = ROOT / "_config.butterfly.yml"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
FM_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n", re.S)

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("font/woff2", ".woff2")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find_typora() -> Path | None:
    candidates: list[str] = []
    env = os.environ.get("TYPORA_EXE")
    if env:
        candidates.append(env)
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Typora.exe",
        ) as key:
            candidates.insert(0, winreg.QueryValue(key, None))
    except OSError:
        pass
    home = Path.home()
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    program_files = Path(os.environ.get("ProgramFiles", ""))
    candidates += [
        str(home / "Desktop" / "Typora" / "Typora.exe"),
        str(local / "Programs" / "Typora" / "Typora.exe"),
        str(program_files / "Typora" / "Typora.exe"),
    ]
    for candidate in candidates:
        try:
            path = Path(candidate)
            if path.is_file():
                return path
        except OSError:
            continue
    return None


def title_of(path: Path) -> str:
    try:
        text = read_text(path)
    except OSError:
        return path.stem
    match = FM_RE.match(text)
    if match:
        for line in match.group(1).splitlines():
            if line.lower().startswith("title:"):
                return line.split(":", 1)[1].strip().strip("'\"")
    return path.stem


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def resolve_allowed(relative: str) -> Path | None:
    candidate = (ROOT / relative).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return None
    if candidate.suffix.lower() not in {".md", ".yml", ".yaml"}:
        return None
    if candidate in {p.resolve() for p in CONFIGS}:
        return candidate
    try:
        candidate.relative_to(SOURCE.resolve())
    except ValueError:
        return None
    return candidate


def list_files() -> dict:
    posts = []
    for path in POSTS.glob("*.md"):
        date = ""
        try:
            match = FM_RE.match(read_text(path))
            if match:
                for line in match.group(1).splitlines():
                    if line.lower().startswith("date:"):
                        date = line.split(":", 1)[1].strip().strip("'\"")
                        break
        except OSError:
            pass
        posts.append({
            "path": rel(path),
            "title": title_of(path),
            "date": date,
            "mtime": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
        })
    posts.sort(key=lambda item: (item["date"] or item["mtime"]), reverse=True)

    pages = []
    for path in sorted(SOURCE.glob("*/index.md")):
        if path.parent.name.startswith("_"):
            continue
        pages.append({"path": rel(path), "title": title_of(path)})

    return {
        "posts": posts,
        "pages": pages,
        "configs": [{"path": rel(path), "title": path.name} for path in CONFIGS if path.exists()],
        "profile": {"path": rel(PROFILE), "title": "关于页 · 个人资料"},
    }


PROFILE_DEFAULTS = {
    "title": "关于",
    "name": "RyuriHime",
    "tagline": "",
    "avatar": "/images/avatar.webp",
    "bio": "",
    "contacts": [],
}


def clean_contact(item, allow_menu: bool = True) -> dict | None:
    if not isinstance(item, dict):
        return None
    label = str(item.get("label", "")).strip()[:40]
    url = str(item.get("url", "")).strip()[:600]
    icon = re.sub(r"[^A-Za-z0-9 \-]", "", str(item.get("icon", ""))).strip()[:60]
    if not url:
        return None
    contact = {"label": label or "链接", "url": url, "icon": icon or "fas fa-link"}
    group = str(item.get("group", "")).strip()[:40]
    if group:
        contact["group"] = group
    if allow_menu:
        menu = [c for c in (clean_contact(x, False) for x in item.get("menu") or []) if c][:6]
        if menu:
            contact["menu"] = menu
    return contact


def read_profile() -> dict:
    data: dict = {}
    if PROFILE.exists():
        try:
            loaded = yaml.safe_load(read_text(PROFILE))
            if isinstance(loaded, dict):
                data = loaded
        except Exception:
            data = {}
    contacts = []
    for contact in (clean_contact(x) for x in data.get("contacts") or []):
        if not contact:
            continue
        menu = contact.pop("menu", [])
        contacts.append(contact)
        for child in menu:
            item = dict(child)
            item["group"] = contact["label"]
            contacts.append(item)
    return {
        "title": str(data.get("title") or PROFILE_DEFAULTS["title"]).strip(),
        "name": str(data.get("name") or PROFILE_DEFAULTS["name"]).strip(),
        "tagline": str(data.get("tagline") or "").strip(),
        "avatar": str(data.get("avatar") or PROFILE_DEFAULTS["avatar"]).strip(),
        "bio": str(data.get("bio") or "").strip("\n"),
        "contacts": contacts,
    }


def dump_profile(profile: dict) -> str:
    def q(value) -> str:
        return json.dumps(str(value or ""), ensure_ascii=False)

    lines = [
        f"title: {q(profile['title'])}",
        f"name: {q(profile['name'])}",
        f"tagline: {q(profile['tagline'])}",
        f"avatar: {q(profile['avatar'])}",
    ]
    bio = profile["bio"].strip("\n")
    if bio:
        lines.append("bio: |")
        for line in bio.splitlines():
            lines.append(f"  {line}" if line.strip() else "")
    else:
        lines.append("bio: ''")
    def contact_lines(contact: dict, indent: int) -> list[str]:
        pad = " " * indent
        lines = [
            f"{pad}- label: {q(contact['label'])}",
            f"{pad}  url: {q(contact['url'])}",
            f"{pad}  icon: {q(contact['icon'])}",
        ]
        menu = contact.get("menu") or []
        if menu:
            lines.append(f"{pad}  menu:")
            for child in menu:
                lines += contact_lines(child, indent + 4)
        return lines

    if profile["contacts"]:
        lines.append("contacts:")
        for contact in profile["contacts"]:
            lines += contact_lines(contact, 2)
    else:
        lines.append("contacts: []")
    return "\n".join(lines) + "\n"


def write_profile(payload: dict) -> dict:
    rows = [c for c in (clean_contact(x) for x in payload.get("contacts") or []) if c][:16]
    contacts: list[dict] = []
    children: list[dict] = []
    for row in rows:
        (children if row.get("group") else contacts).append(row)
    for child in children:
        group = child.pop("group", "")
        parent = next((top for top in contacts if top["label"] == group), None)
        if parent is not None:
            parent.setdefault("menu", []).append(child)
        else:
            contacts.append(child)
    profile = {
        "title": str(payload.get("title") or PROFILE_DEFAULTS["title"]).strip()[:40],
        "name": str(payload.get("name") or PROFILE_DEFAULTS["name"]).strip()[:60],
        "tagline": str(payload.get("tagline") or "").strip()[:120],
        "avatar": str(payload.get("avatar") or PROFILE_DEFAULTS["avatar"]).strip()[:300],
        "bio": str(payload.get("bio") or "")[:6000].strip("\n"),
        "contacts": contacts,
    }
    PROFILE.parent.mkdir(parents=True, exist_ok=True)
    PROFILE.write_text(dump_profile(profile), encoding="utf-8")
    return profile


def yaml_scalar(value) -> str:
    return json.dumps(str(value if value is not None else ""), ensure_ascii=False)


def _load_yaml(path: Path) -> dict:
    try:
        data = yaml.safe_load(read_text(path))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _find_key_line(lines: list[str], path: tuple[str, ...]) -> tuple[int | None, int]:
    stack: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = re.match(r"^(\s*)([A-Za-z0-9_\-]+):(?:\s*(.*))?$", line)
        if not match:
            continue
        indent = len(match.group(1))
        while stack and stack[-1][0] >= indent:
            stack.pop()
        current = [key for _, key in stack] + [match.group(2)]
        if current == list(path):
            return index, indent
        if not (match.group(3) or "").strip():
            stack.append((indent, match.group(2)))
    return None, 0


def _set_nested(text: str, path: tuple[str, ...], raw: str) -> str:
    lines = text.split("\n")
    index, indent = _find_key_line(lines, path)
    if index is None:
        return text
    lines[index] = " " * indent + f"{path[-1]}: {raw}"
    return "\n".join(lines)


def _set_top(text: str, key: str, value) -> str:
    pattern = re.compile(rf"^{re.escape(key)}:[^\n]*$", re.M)
    line = f"{key}: {yaml_scalar(value)}"
    if pattern.search(text):
        return pattern.sub(lambda match: line, text, count=1)
    return text.rstrip("\n") + "\n" + line + "\n"


def _set_menu(text: str, items: list) -> str:
    lines = text.split("\n")
    start = None
    for index, line in enumerate(lines):
        if re.match(r"^menu:\s*$", line):
            start = index
            break
    if start is None:
        return text
    end = start + 1
    while end < len(lines) and (not lines[end].strip() or lines[end].startswith((" ", "\t"))):
        end += 1
    block = ["menu:"]
    for item in items:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "")).strip()[:40]
        href = str(item.get("path", "")).strip()[:300]
        icon = str(item.get("icon", "")).strip()[:80]
        if not label or not href:
            continue
        value = f"{href} || {icon}" if icon else href
        block.append(f"  {yaml_scalar(label)}: {yaml_scalar(value)}")
    lines[start:end] = block
    return "\n".join(lines)


def read_site() -> dict:
    cfg = _load_yaml(SITE_CONFIG)
    theme = _load_yaml(THEME_CONFIG)
    footer = theme.get("footer") or {}
    aside = theme.get("aside") or {}
    author = aside.get("card_author") or {}
    notice = aside.get("card_announcement") or {}
    error_page = theme.get("error_404") or {}
    menu = theme.get("menu") or {}
    items = []
    for label, raw in menu.items():
        parts = [part.strip() for part in str(raw).split("||")]
        items.append({
            "label": str(label),
            "path": parts[0] if parts else "",
            "icon": parts[1] if len(parts) > 1 else "",
        })
    return {
        "title": str(cfg.get("title") or ""),
        "tabTitle": str(cfg.get("tab_title") or ""),
        "subtitle": str(cfg.get("subtitle") or ""),
        "description": str(cfg.get("description") or ""),
        "keywords": str(cfg.get("keywords") or ""),
        "author": str(cfg.get("author") or ""),
        "footer": str(footer.get("custom_text") or ""),
        "aside": str(author.get("description") or ""),
        "notice": str(notice.get("content") or ""),
        "noticeOn": bool(notice.get("enable")),
        "notFound": str(error_page.get("subtitle") or ""),
        "menu": items,
    }


def write_site(payload: dict) -> dict:
    limits = {"title": 80, "tab_title": 100, "subtitle": 120, "description": 200, "keywords": 200, "author": 60}
    site_text = read_text(SITE_CONFIG)
    for key, limit in limits.items():
        field = "tabTitle" if key == "tab_title" else key
        site_text = _set_top(site_text, key, str(payload.get(field, "")).strip()[:limit])
    SITE_CONFIG.write_text(site_text, encoding="utf-8")

    theme_text = read_text(THEME_CONFIG)
    theme_text = _set_nested(theme_text, ("footer", "custom_text"), yaml_scalar(str(payload.get("footer", "")).strip()[:200]))
    theme_text = _set_nested(theme_text, ("aside", "card_author", "description"), yaml_scalar(str(payload.get("aside", "")).strip()[:200]))
    theme_text = _set_nested(theme_text, ("aside", "card_announcement", "content"), yaml_scalar(str(payload.get("notice", "")).strip()[:600]))
    theme_text = _set_nested(theme_text, ("aside", "card_announcement", "enable"), "true" if payload.get("noticeOn") else "false")
    theme_text = _set_nested(theme_text, ("error_404", "subtitle"), yaml_scalar(str(payload.get("notFound", "")).strip()[:120]))
    menu_items = payload.get("menu")
    if isinstance(menu_items, list):
        theme_text = _set_menu(theme_text, menu_items)
    THEME_CONFIG.write_text(theme_text, encoding="utf-8")
    return read_site()


def assets_source() -> Path:
    candidates = [ROOT / "private-assets", ROOT.parent / "private-assets", ROOT.parent.parent / "private-assets"]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return candidates[1]


def wallpaper_info() -> dict:
    source = assets_source()
    output = SOURCE / "assets" / "private" / "banner-main.webp"
    stamp = int(output.stat().st_mtime) if output.is_file() else 0
    return {
        "source": str(source),
        "exists": output.is_file(),
        "url": f"/assets/private/banner-main.webp?v={stamp}" if output.is_file() else "",
        "mtime": stamp,
    }


def save_wallpaper(data_url: str, name: str = "") -> Path:
    match = re.match(r"^data:image/(png|jpe?g|webp);base64,(.+)$", str(data_url or ""), re.S | re.I)
    if not match:
        raise ValueError("只接受 PNG / JPEG / WebP 图片")
    try:
        raw = base64.b64decode(match.group(2), validate=False)
    except Exception as exc:
        raise ValueError(f"图片数据损坏：{exc}") from exc
    if len(raw) > 40 * 1024 * 1024:
        raise ValueError("图片太大（超过 40 MB），请先压缩")
    kind = match.group(1).lower()
    ext = ".jpg" if kind in ("jpeg", "jpg") else f".{kind}"
    source = assets_source()
    walls = source / "wallpapers"
    walls.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive = walls / "_archive" / stamp
    for old in walls.iterdir():
        if old.is_file() and old.suffix.lower() in IMAGE_EXTS:
            archive.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old), str(archive / old.name))
    target = walls / f"role-hero-{stamp}{ext}"
    target.write_bytes(raw)
    return target


def prepare_assets() -> tuple[int, str]:
    try:
        proc = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "prepare_private_assets.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
    except Exception as exc:  # pragma: no cover
        return 1, f"{type(exc).__name__}: {exc}"
    return proc.returncode, ((proc.stdout or "") + (proc.stderr or ""))[-6000:]


def obfuscate_assets() -> tuple[int, str]:
    try:
        proc = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "obfuscate_wallpaper.py")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
    except Exception as exc:  # pragma: no cover
        return 1, f"{type(exc).__name__}: {exc}"
    return proc.returncode, ((proc.stdout or "") + (proc.stderr or ""))[-6000:]


def slugify(title: str) -> str:
    value = re.sub(r'[\\/:*?"<>|\s]+', "-", title.strip().lower())
    value = re.sub(r"-+", "-", value).strip("-")
    return (value[:60] or "post").strip("-")


def create_post(payload: dict) -> Path:
    title = str(payload.get("title", "")).strip() or "未命名文章"
    category = str(payload.get("category", "")).strip()
    tags = [tag.strip() for tag in str(payload.get("tags", "")).split(",") if tag.strip()]
    now = datetime.now()
    date = str(payload.get("date", "")).strip() or now.strftime("%Y-%m-%d %H:%M:%S")
    safe_title = title.replace("'", "''")
    safe_category = category.replace("'", "''")
    safe_tags = [tag.replace("'", "''") for tag in tags]
    stem = f"{now:%Y-%m-%d}-{slugify(title)}"
    path = POSTS / f"{stem}.md"
    index = 2
    while path.exists():
        path = POSTS / f"{stem}-{index}.md"
        index += 1
    lines = [
        "---",
        f"title: '{safe_title}'",
        f"date: '{date}'",
    ]
    if category:
        lines += ["categories:", f"- '{safe_category}'"]
    if tags:
        lines += ["tags:"] + [f"- '{tag}'" for tag in safe_tags]
    lines += [
        "mathjax: true",
        "toc: true",
        "---",
        "",
        f"# {title}",
        "",
        "在这里开始写。",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def preview_html(markdown_text: str) -> str:
    body = FM_RE.sub("", markdown_text, count=1)
    try:
        import markdown  # type: ignore

        return markdown.markdown(body, extensions=["fenced_code", "tables", "sane_lists"])
    except Exception:
        return f"<pre>{html.escape(body)}</pre>"


def build_site() -> tuple[int, str]:
    try:
        proc = subprocess.run(
            "pnpm run build",
            cwd=ROOT,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
    except Exception as exc:  # pragma: no cover - diagnostic path
        return 1, f"{type(exc).__name__}: {exc}"
    output = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, output[-6000:]


PUBLISH_BLOCKED_PREFIXES = (
    "public/",
    "node_modules/",
    "private-assets/",
    "source/assets/private/",
)


def run_git(args: list[str], timeout: int = 120) -> tuple[int, str]:
    """Run git, allowing a one-time credential prompt for ``git push``."""
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    # Publishing is user-initiated. Let Git Credential Manager reuse its stored
    # login, or show its GitHub login window once when authorization is needed.
    env["GCM_INTERACTIVE"] = "auto"
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
    except Exception as exc:
        return 1, f"{type(exc).__name__}: {exc}"
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def publish_site() -> dict:
    """Commit the current source changes and push them to GitHub."""
    code, output = run_git(["rev-parse", "--show-toplevel"])
    if code != 0:
        return {
            "ok": False,
            "published": False,
            "message": "当前目录不是 Git 仓库",
            "output": output[-4000:],
        }

    code, status = run_git(["status", "--porcelain"])
    if code != 0:
        return {
            "ok": False,
            "published": False,
            "message": "读取 Git 状态失败",
            "output": status[-4000:],
        }
    if not status.strip():
        return {
            "ok": True,
            "published": False,
            "message": "没有需要发布的改动",
            "output": "",
        }

    code, output = run_git(["add", "-A"])
    if code != 0:
        return {
            "ok": False,
            "published": False,
            "message": "暂存改动失败",
            "output": output[-6000:],
        }

    code, staged = run_git(["diff", "--cached", "--name-only"])
    if code != 0:
        return {
            "ok": False,
            "published": False,
            "message": "读取待提交文件失败",
            "output": staged[-6000:],
        }
    blocked = [
        path
        for path in staged.splitlines()
        if any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in PUBLISH_BLOCKED_PREFIXES)
    ]
    if blocked:
        run_git(["reset", "--", *blocked])
        return {
            "ok": False,
            "published": False,
            "message": "检测到不应发布的文件，已取消提交",
            "output": "\n".join(blocked),
        }

    message = "Publish from writing desk: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    code, output = run_git(["commit", "-m", message])
    if code != 0:
        return {
            "ok": False,
            "published": False,
            "message": "提交失败",
            "output": output[-6000:],
        }

    code, commit = run_git(["rev-parse", "--short", "HEAD"])
    commit_hash = commit.strip() if code == 0 else ""
    code, push_output = run_git(["push", "origin", "HEAD:main"], timeout=180)
    if code != 0:
        return {
            "ok": False,
            "published": False,
            "commit": commit_hash,
            "message": "已在本地提交，但推送到 GitHub 失败",
            "output": push_output[-6000:],
        }

    return {
        "ok": True,
        "published": True,
        "commit": commit_hash,
        "message": "已推送到 GitHub",
        "output": push_output[-4000:],
    }


INDEX_HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RyuriHime · 写作后台</title>
<style>
  :root{--ink:#332b3c;--muted:#81748d;--line:#e7e1ec;--bg:#f7f4f9;--panel:#fff;--accent:#7c5aa6;--accent2:#a071c7}
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;font:14px/1.65 "Microsoft YaHei","PingFang SC",system-ui,sans-serif;color:var(--ink);background:var(--bg);display:flex;flex-direction:column}
  header{height:58px;flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:0 18px;background:#fff;border-bottom:1px solid var(--line)}
  header b{font-size:15px;letter-spacing:.03em} header .sp{flex:1}
  button,.btn{font:inherit;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:9px;padding:7px 13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  button:hover,.btn:hover{border-color:#cdbce0;color:var(--accent)}
  .primary{background:var(--accent);border-color:var(--accent);color:#fff}.primary:hover{background:#6b4b93;color:#fff}
  main{flex:1;display:grid;grid-template-columns:310px minmax(0,1fr);min-height:0}
  aside{border-right:1px solid var(--line);background:#fbfafc;overflow:auto;padding:14px 10px 40px}
  aside h3{margin:16px 8px 6px;font-size:11px;letter-spacing:.13em;color:#a294ad;font-weight:700;text-transform:uppercase}
  .item{display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:8px;color:#544860;font-size:13px;line-height:1.4;cursor:pointer}
  .item:hover{background:#f1ebf6;color:var(--accent)} .item.on{background:#ece2f5;color:#633d8e;font-weight:600}
  .item .p{display:block;font-size:11px;color:#a294ad;font-weight:400;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  section{min-width:0;display:flex;flex-direction:column;background:var(--panel)}
  .toolbar{height:52px;flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:0 16px;border-bottom:1px solid var(--line);background:#fff}
  .toolbar .path{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .editor-wrap{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);background:#fdfcfe}
  .editor-wrap.split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  textarea{width:100%;height:100%;resize:none;border:0;outline:0;padding:22px 26px;font:14px/1.8 "Cascadia Mono","Consolas","Microsoft YaHei",monospace;color:#342d3e;background:#fdfcfe;tab-size:2}
  .preview{display:none;overflow:auto;padding:24px 30px;border-left:1px solid var(--line);background:#fff;color:#342d3e}
  .editor-wrap.split .preview{display:block}
  .preview h1,.preview h2,.preview h3{line-height:1.45} .preview img{max-width:100%} .preview pre{overflow:auto;background:#f4f0f7;padding:12px;border-radius:8px}
  .preview table{border-collapse:collapse;width:100%} .preview td,.preview th{border:1px solid var(--line);padding:6px 8px}
  .status{height:38px;flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:0 16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);background:#fff}
  .status .msg{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dot{width:7px;height:7px;border-radius:50%;background:#59b37c;display:inline-block;margin-right:5px}
  .intro{flex:1;display:flex;align-items:center;justify-content:center;padding:40px;background:linear-gradient(180deg,#fff,#faf7fd)}
  .intro div{max-width:560px;color:#6d5f79} .intro h1{font-size:22px;color:#3d314c;margin:0 0 12px}
  .intro code{background:#f1ebf6;padding:1px 5px;border-radius:4px;color:#68438d}
  dialog{border:0;border-radius:16px;padding:0;box-shadow:0 24px 80px rgba(45,35,60,.22);width:min(480px,calc(100vw - 30px))}
  dialog::backdrop{background:rgba(42,30,56,.28);backdrop-filter:blur(2px)}
  .dlg{padding:22px}.dlg h2{margin:0 0 14px;font-size:17px}.dlg label{display:block;font-size:12px;color:#81748d;margin:11px 0 4px}
  .dlg input{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 11px;font:inherit;outline:0}.dlg input:focus{border-color:#c4aee0}
  .dlg .row{display:flex;gap:9px;justify-content:flex-end;margin-top:20px}
  .toast{position:fixed;right:20px;bottom:20px;background:#332b3c;color:#fff;padding:9px 15px;border-radius:9px;font-size:13px;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none}
  .toast.on{opacity:1;transform:none}
  @media(max-width:860px){main{grid-template-columns:1fr} aside{display:none} .editor-wrap.split{grid-template-columns:1fr}.editor-wrap.split .preview{display:none}}
</style>
</head>
<body>
<header>
  <b>RyuriHime · 写作后台</b><span class="sp"></span>
  <button id="new">＋ 新建文章</button>
  <a class="btn" href="http://127.0.0.1:4000" target="_blank">打开博客 ↗</a>
  <button id="build">重新构建</button>
</header>
<main>
  <aside id="list"><h3>加载中…</h3></aside>
  <section>
    <div class="toolbar" id="toolbar" style="display:none">
      <span class="path" id="path"></span>
      <button id="previewBtn">预览</button>
      <button id="save">保存</button>
      <button class="primary" id="saveBuild">保存并构建</button>
    </div>
    <div class="editor-wrap" id="wrap">
      <div class="intro" id="intro"><div>
        <h1>从左侧选一篇内容开始编辑</h1>
        <p>这里直接改 <code>source/</code> 里的 Markdown 和站点配置。文章、关于页、OI 时间线、导航与公告都在这里改；保存后点「保存并构建」即可刷新本地预览。</p>
        <p>新建文章会生成标准 front matter，包含标题、日期、分类、标签、公式和目录开关。快捷键 <code>Ctrl + S</code> 保存。</p>
      </div></div>
      <textarea id="editor" spellcheck="false" style="display:none"></textarea>
      <div class="preview" id="preview"></div>
    </div>
    <div class="status"><span><span class="dot"></span>仅本机可访问</span><span class="msg" id="msg"></span></div>
  </section>
</main>
<dialog id="dlg"><form method="dialog" class="dlg">
  <h2>新建文章</h2>
  <label>标题</label><input id="f-title" placeholder="例如：Codeforces Round 1000 记录">
  <label>日期</label><input id="f-date" placeholder="留空则使用当前时间">
  <label>分类</label><input id="f-cat" placeholder="学习笔记 / 题解 / 比赛记录 / 游记 / 杂谈">
  <label>标签（逗号分隔）</label><input id="f-tags" value="ACM">
  <div class="row"><button value="cancel">取消</button><button class="primary" id="create" value="default">创建</button></div>
</form></dialog>
<div class="toast" id="toast"></div>
<script>
const $ = (s) => document.querySelector(s);
let current = null, dirty = false;
const editor = $('#editor'), preview = $('#preview'), wrap = $('#wrap');

function toast(text, bad=false){ const t=$('#toast'); t.textContent=text; t.style.background=bad?'#a33':'#332b3c'; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2200); }
function msg(text){ $('#msg').textContent=text; }
async function api(url, opt){ const r=await fetch(url,opt); const j=await r.json(); if(!r.ok) throw new Error(j.error||r.statusText); return j; }

async function loadList(){
  const data = await api('/api/files');
  const box = $('#list'); box.innerHTML='';
  const add=(title,items,sub)=>{ if(!items.length)return; const h=document.createElement('h3');h.textContent=title;box.appendChild(h); items.forEach((it,i)=>{const b=document.createElement('button');b.className='item';b.innerHTML=`${esc(it.title)}${sub?`<span class="p">${esc(sub(it))}</span>`:''}`;b.dataset.path=it.path;b.onclick=()=>openFile(it.path);box.appendChild(b);});};
  add('文章',data.posts,it=>it.date||it.mtime);
  add('页面',data.pages,null);
  add('站点配置',data.configs,it=>it.path);
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function openFile(path){
  if(dirty && !confirm('当前内容还没保存，确定离开？')) return;
  const data = await api('/api/file?path='+encodeURIComponent(path));
  current=data.path; editor.value=data.content; dirty=false;
  preview.innerHTML=''; wrap.classList.remove('split');
  document.querySelectorAll('.item').forEach(b=>b.classList.toggle('on',b.dataset.path===path));
  $('#path').textContent=path; $('#toolbar').style.display='flex'; $('#intro').style.display='none';
  editor.style.display='block'; editor.focus();
  msg('已打开 '+path);
}
async function save(build=false){
  if(!current) return;
  msg('保存中…');
  try{
    await api('/api/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:current,content:editor.value})});
    dirty=false; msg('已保存 '+current);
    if(build){ await doBuild(); } else { toast('已保存'); }
  }catch(e){ msg('保存失败：'+e.message); toast('保存失败',true); }
}
async function doBuild(){
  msg('构建中…'); $('#build').disabled=true;
  try{ const r=await api('/api/build',{method:'POST'}); msg(r.ok?'构建完成，刷新博客预览即可':'构建失败'); toast(r.ok?'构建完成':'构建失败',!r.ok); if(!r.ok) console.log(r.output); }
  catch(e){ msg('构建失败：'+e.message); toast('构建失败',true); }
  $('#build').disabled=false;
}
async function doPreview(){
  if(!current) return;
  const r=await api('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:editor.value})});
  preview.innerHTML=r.html; wrap.classList.toggle('split');
  if(window.MathJax){ MathJax.typesetPromise && MathJax.typesetPromise([preview]); }
}

$('#save').onclick=()=>save(false); $('#saveBuild').onclick=()=>save(true); $('#build').onclick=doBuild; $('#previewBtn').onclick=doPreview;
editor.addEventListener('input',()=>{dirty=true;msg('未保存');});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save(false);}});
$('#new').onclick=()=>{$('#dlg').showModal();setTimeout(()=>$('#f-title').focus(),50);};
$('#create').onclick=async(e)=>{e.preventDefault();const title=$('#f-title').value.trim();if(!title){toast('请填标题',true);return;}try{const r=await api('/api/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,date:$('#f-date').value,category:$('#f-cat').value,tags:$('#f-tags').value})});$('#dlg').close();$('#f-title').value='';await loadList();await openFile(r.path);toast('文章已创建');}catch(err){toast(err.message,true);}};
loadList().catch(e=>{$('#list').innerHTML='<h3>无法加载文件</h3><p>'+esc(e.message)+'</p>';});
</script>
<script>window.MathJax={tex:{inlineMath:[['$','$'],['\\(','\\)']],displayMath:[['$$','$$'],['\\[','\\]']]},svg:{fontCache:'global'}};</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "RyuriAdmin/1.0"

    def log_message(self, fmt, *args):  # quiet console
        pass

    def _json(self, payload: dict, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def _send_file(self, target: Path):
        body = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path: str) -> bool:
        routes = [
            ("/admin-assets/ui/", ADMIN_UI),
            ("/admin-assets/vditor/", VENDOR / "vditor"),
            ("/images/", SOURCE),
            ("/assets/", SOURCE),
            ("/css/", SOURCE),
            ("/js/", SOURCE),
            ("/private-assets.css", SOURCE),
        ]
        for prefix, base in routes:
            if prefix.endswith("/"):
                if not path.startswith(prefix):
                    continue
                relative = path[len(prefix):]
            else:
                if path != prefix:
                    continue
                relative = path.lstrip("/")
            if not relative or ".." in Path(relative).parts:
                continue
            target = (base / relative).resolve()
            try:
                target.relative_to(base.resolve())
            except ValueError:
                continue
            if target.is_file():
                self._send_file(target)
                return True
        if not path.startswith("/api/"):
            public = (ROOT / "public").resolve()
            target = (public / path.lstrip("/")).resolve()
            try:
                target.relative_to(public)
            except ValueError:
                return False
            if target.is_file():
                self._send_file(target)
                return True
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            index = ADMIN_UI / "index.html"
            body = index.read_bytes() if index.is_file() else INDEX_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/files":
            self._json(list_files())
            return
        if parsed.path == "/api/file":
            path = parse_qs(parsed.query).get("path", [""])[0]
            target = resolve_allowed(path)
            if not target or not target.exists():
                self._json({"error": "文件不存在"}, 404)
                return
            self._json({"path": rel(target), "content": read_text(target), "mtime": target.stat().st_mtime})
            return
        if parsed.path == "/api/mtime":
            path = parse_qs(parsed.query).get("path", [""])[0]
            target = resolve_allowed(path)
            if not target or not target.exists():
                self._json({"error": "文件不存在"}, 404)
                return
            stat = target.stat()
            self._json({"mtime": stat.st_mtime, "size": stat.st_size})
            return
        if parsed.path == "/api/profile":
            self._json({"profile": read_profile()})
            return
        if parsed.path == "/api/site":
            self._json({"site": read_site()})
            return
        if parsed.path == "/api/wallpaper":
            self._json({"wallpaper": wallpaper_info()})
            return
        if parsed.path == "/api/typora":
            exe = find_typora()
            self._json({"available": bool(exe), "path": str(exe) if exe else ""})
            return
        if self._static(parsed.path):
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self._body()
            if parsed.path == "/api/file":
                target = resolve_allowed(str(payload.get("path", "")))
                if not target:
                    self._json({"error": "不允许的路径"}, 400)
                    return
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(str(payload.get("content", "")), encoding="utf-8")
                self._json({"ok": True, "path": rel(target), "mtime": target.stat().st_mtime})
                return
            if parsed.path == "/api/profile":
                self._json({"ok": True, "profile": write_profile(payload)})
                return
            if parsed.path == "/api/site":
                self._json({"ok": True, "site": write_site(payload)})
                return
            if parsed.path == "/api/wallpaper":
                saved = save_wallpaper(str(payload.get("data", "")), str(payload.get("name", "")))
                build_code, build_output = build_site()
                self._json({
                    "ok": build_code == 0,
                    "saved": str(saved),
                    "error": "" if build_code == 0 else "壁纸已保存，但重新构建失败",
                    "output": build_output,
                    "wallpaper": wallpaper_info(),
                })
                return
            if parsed.path == "/api/new":
                path = create_post(payload)
                self._json({"ok": True, "path": rel(path)})
                return
            if parsed.path == "/api/open-typora":
                target = resolve_allowed(str(payload.get("path", "")))
                if not target or target.suffix.lower() != ".md" or not target.exists():
                    self._json({"error": "只能打开 Markdown 文章"}, 400)
                    return
                exe = find_typora()
                if not exe:
                    self._json({"error": "没有找到 Typora，可设置环境变量 TYPORA_EXE"}, 404)
                    return
                subprocess.Popen([str(exe), str(target)], cwd=str(ROOT))
                self._json({"ok": True})
                return
            if parsed.path == "/api/preview":
                self._json({"html": preview_html(str(payload.get("content", "")))})
                return
            if parsed.path == "/api/build":
                code, output = build_site()
                self._json({"ok": code == 0, "output": output})
                return
            if parsed.path == "/api/publish":
                build_code, build_output = build_site()
                if build_code != 0:
                    self._json({
                        "ok": False,
                        "stage": "build",
                        "published": False,
                        "message": "构建失败，未发布",
                        "output": build_output,
                    })
                    return
                result = publish_site()
                combined = "\n\n".join(
                    part for part in (build_output, str(result.get("output", ""))) if part
                )
                result.update({
                    "stage": "done" if result.get("ok") else "publish",
                    "build_output": build_output,
                    "output": combined[-6000:],
                })
                self._json(result)
                return
            if parsed.path == "/api/assets/prepare":
                build_code, build_output = build_site()
                self._json({
                    "ok": build_code == 0,
                    "output": build_output,
                    "wallpaper": wallpaper_info(),
                })
                return
        except Exception as exc:
            self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)
            return
        self._json({"error": "not found"}, 404)


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def serve_preview():
    if port_open(4000):
        print("[admin] preview already running at http://127.0.0.1:4000")
        return
    handler = lambda *a, **kw: __import__("http.server").server.SimpleHTTPRequestHandler(  # noqa: E731
        *a, directory=str(ROOT / "public"), **kw
    )
    httpd = ThreadingHTTPServer(("127.0.0.1", 4000), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print("[admin] preview: http://127.0.0.1:4000")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4010)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()
    POSTS.mkdir(parents=True, exist_ok=True)
    serve_preview()
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"[admin] writing desk: {url}")
    print("[admin] Ctrl+C to stop")
    if not args.no_open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[admin] stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
