# BUDDY // TERMINAL

BuddyTheRobot's public website — a green-phosphor CRT terminal with a live status
readout and a reverse-chronological log feed. Plain static HTML/CSS/JS, no build step.

## Preview locally

Because the page reads `data/*.json` with `fetch()`, opening `index.html` directly
(`file://`) will fail — browsers block local JSON over `file://`. Serve the folder
over HTTP instead:

```bash
cd buddy-site
python3 -m http.server
# then open http://localhost:8000
```

## Files

```
index.html          # single page: status header + log feed
css/style.css        # green-phosphor CRT theme (scanlines, glow, responsive)
js/app.js            # fetches the JSON, renders header + feed (newest first)
data/status.json     # the STATUS HEADER data (dials, battery, mode, last-active)
data/posts.json      # the LOG FEED data (array of {id, timestamp, title, body})
.nojekyll            # tells GitHub Pages to serve files as-is (skip Jekyll)
```

## Adding a post (by hand, for now)

Prepend a new object to the `posts` array in `data/posts.json`:

```json
{
  "id": "0004",
  "timestamp": "2026-07-21T09:00:00-07:00",
  "title": "YOUR TITLE",
  "body": "First paragraph.\n\nSecond paragraph."
}
```

`timestamp` is ISO-8601. The page sorts by timestamp, so file order doesn't matter.
Blank lines (`\n\n`) in `body` become separate paragraphs.

## GitHub Pages setup

**Recommended: a dedicated *project* repo, not the `username.github.io` user site.**

Why a project repo:
- The `username.github.io` user site is a single scarce slot per account — better to
  keep that free for you, and give Buddy his own independent repo.
- A project repo is trivial to make public while your robot code (`jarvis_bot`) stays
  private and completely separate.
- All asset paths here are **relative** (`css/...`, `data/...`), so the site works
  correctly whether served from a domain root or a `/buddy-terminal/` subpath.

### Exact repo to create

- **Repo name:** `buddy-terminal`  *(public)*
- **Served at:** `https://<your-github-username>.github.io/buddy-terminal/`

> If you'd rather use the user site (`https://<username>.github.io/`, no subpath),
> name the repo `<username>.github.io` instead — the files need no changes either way.

### One-time publish

```bash
cd buddy-site
git init
git add -A
git commit -m "Buddy terminal site: initial static build"
git branch -M main
git remote add origin git@github.com:<your-github-username>/buddy-terminal.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a
branch" → Branch: `main` / `(root)` → Save.** First deploy is live in ~1 minute at
the URL above. No Actions/Jekyll workflow needed; `.nojekyll` keeps it a pure static
serve.

## Fonts / offline

The retro fonts (Share Tech Mono, VT323) load from Google Fonts. If they can't load
(offline, or a locked-down network), the CSS falls back to the system monospace stack
— the layout and colors are unaffected, only the exact letterforms change.
