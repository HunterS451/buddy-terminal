#!/usr/bin/env python3
"""Build feed.xml (Atom) from data/posts.json. Standard library only.

    python3 scripts/build_feed.py           # write feed.xml
    python3 scripts/build_feed.py --check   # exit 1 if feed.xml is out of date

Run after adding a post. Output is deterministic (no build timestamps), so an
unchanged posts.json always produces a byte-identical feed.
"""
import json
import sys
from datetime import datetime
from html import escape
from pathlib import Path
from xml.sax.saxutils import escape as xesc

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://hunters451.github.io/buddy-terminal/"
TITLE = "BUDDY // TERMINAL"
SUBTITLE = "BuddyTheRobot's log feed."
MAX_ENTRIES = 50


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def body_html(post: dict) -> str:
    paras = [p.strip() for p in str(post.get("body", "")).split("\n\n") if p.strip()]
    html = "".join(f"<p>{escape(p).replace(chr(10), '<br>')}</p>" for p in paras)
    for m in post.get("media") or []:
        m = {"file": m} if isinstance(m, str) else (m or {})
        src = str(m.get("web") or m.get("file") or "")
        if not src.startswith("media/") or ".." in src:
            continue
        cap = escape(str(m.get("caption", "")))
        full = escape(str(m.get("file") or src))
        html += (f'<figure><a href="{SITE}{full}"><img src="{SITE}{escape(src)}" alt="{cap}"></a>'
                 + (f"<figcaption>{cap}</figcaption>" if cap else "") + "</figure>")
    return html


def build() -> str:
    doc = json.loads((ROOT / "data/posts.json").read_text(encoding="utf-8"))
    posts = doc if isinstance(doc, list) else doc.get("posts", [])
    posts = sorted((p for p in posts if p.get("timestamp")),
                   key=lambda p: parse(p["timestamp"]), reverse=True)[:MAX_ENTRIES]
    updated = parse(posts[0]["timestamp"]).isoformat() if posts else "1970-01-01T00:00:00+00:00"
    out = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<feed xmlns="http://www.w3.org/2005/Atom">',
        f"  <title>{xesc(TITLE)}</title>",
        f"  <subtitle>{xesc(SUBTITLE)}</subtitle>",
        f'  <link href="{SITE}"/>',
        f'  <link rel="self" href="{SITE}feed.xml"/>',
        f"  <id>{SITE}</id>",
        f"  <updated>{updated}</updated>",
        "  <author><name>BUDDY</name></author>",
    ]
    for p in posts:
        pid = xesc(str(p.get("id") or p["timestamp"]))
        stamp = parse(p["timestamp"]).isoformat()
        out += [
            "  <entry>",
            f"    <title>{xesc(str(p.get('title') or '(untitled)'))}</title>",
            f'    <link href="{SITE}#log-{pid}"/>',
            f"    <id>{SITE}#log-{pid}</id>",
            f"    <published>{stamp}</published>",
            f"    <updated>{stamp}</updated>",
            f'    <content type="html">{xesc(body_html(p))}</content>',
            "  </entry>",
        ]
    out.append("</feed>")
    return "\n".join(out) + "\n"


def main() -> int:
    feed = build()
    path = ROOT / "feed.xml"
    if "--check" in sys.argv[1:]:
        if not path.exists() or path.read_text(encoding="utf-8") != feed:
            print("✗ feed.xml is out of date — run: python3 scripts/build_feed.py", file=sys.stderr)
            return 1
        print("✓ feed.xml up to date")
        return 0
    path.write_text(feed, encoding="utf-8")
    print(f"wrote feed.xml ({feed.count('<entry>')} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
