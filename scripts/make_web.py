#!/usr/bin/env python3
"""Make downscaled web copies of media/ photos and wire them into the data files.

    python3 scripts/make_web.py            # create missing media/web/ copies, update JSON
    python3 scripts/make_web.py --check    # exit 1 if anything is missing/out of date

For every image referenced by data/posts.json or data/identity.json:
  * writes media/web/<name> (EXIF-rotated, longest side <= 1600px, metadata stripped
    - so no GPS or camera serial leaves the house via the on-page copy)
  * sets that entry's "web", "width", "height" (dimensions of the web copy)

The original stays the click-through target. Needs Pillow (pip install pillow).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
MAX_SIDE = 1600
QUALITY = 82
DATA_FILES = [("data/posts.json", "posts"), ("data/identity.json", None)]


def web_path(file: str) -> str:
    return "media/web/" + Path(file).name


def make_copy(src: Path, dst: Path) -> tuple[int, int]:
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.suffix.lower() in (".jpg", ".jpeg"):
            im.convert("RGB").save(dst, quality=QUALITY, optimize=True, progressive=True)
        else:
            im.save(dst, optimize=True)
        return im.size


def entries(doc, key):
    if key:
        for post in doc.get(key, []):
            yield from (post.get("media") or [])
    else:
        yield from doc.get("photos", [])


def main(check: bool) -> int:
    problems = []
    for rel, key in DATA_FILES:
        path = ROOT / rel
        if not path.exists():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for m in entries(doc, key):
            if not isinstance(m, dict) or not m.get("file"):
                continue  # bare-string entries are left alone (renderer handles them)
            src = ROOT / m["file"]
            if not src.exists():
                problems.append(f"{rel}: {m['file']} missing")
                continue
            web = m.get("web") or web_path(m["file"])
            dst = ROOT / web
            if dst.exists():
                with Image.open(dst) as im:
                    size = im.size
            elif check:
                problems.append(f"{rel}: no web copy for {m['file']}")
                continue
            else:
                size = make_copy(src, dst)
                print(f"made {web} {size[0]}x{size[1]}")
            want = {"web": web, "width": size[0], "height": size[1]}
            if any(m.get(k) != v for k, v in want.items()):
                if check:
                    problems.append(f"{rel}: {m['file']} web/width/height out of date")
                else:
                    m.update(want)
                    changed = True
        if changed:
            path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"updated {rel}")
    for p in problems:
        print("✗", p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main("--check" in sys.argv[1:]))
