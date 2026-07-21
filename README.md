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
data/posts.json      # the LOG FEED data (array of {id, timestamp, title, body, media})
media/               # real photographs attached to posts (dropped in by hand)
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

## Visitor counter

The status header shows `VISITS: 000042` — the site's real total, counted by
GoatCounter for **hunter451.goatcounter.com**.

**It is labelled "visits", not "visitors", on purpose.** GoatCounter counts a visit as
the first pageview from someone within an 8-hour window, so it is neither raw page
loads nor a headcount of distinct humans. "Visits" is the only word that is exactly
true.

It is a real count or it is nothing. There is no fallback number: if the service is
unreachable, blocked by a content blocker, or the setting is off, the readout stays
`------`. Nothing is ever estimated, cached, or carried over — dashes mean *unknown*,
never zero.

### Service used: [GoatCounter](https://www.goatcounter.com)

Open-source, privacy-focused analytics by Martin Tournoij (Ireland); servers at
Hetzner in Finland/Germany. Per [its privacy policy](https://www.goatcounter.com/help/privacy):

- **No IP addresses stored.** No full User-Agent, no tracker ID.
- **Nothing stored in the visitor's browser** — no cookies, no localStorage.
- Only aggregate per-day/per-hour counts, with no way to link rows together.
- No data shared with third parties.
- To de-duplicate repeat visits it holds `hash(siteID, User-Agent, IP)` **in memory
  for 8 hours**, mapped to a random UUID; that hash is never written to disk.

GoatCounter caches totals for **up to four hours**, so a fresh visit won't show up
immediately. That's a property of the service, not a bug here.

### How it's wired

Two halves, deliberately independent:

| | what it does | where |
|---|---|---|
| **count** | `count.js` records the pageview | the `<script data-goatcounter>` tag in `index.html` |
| **display** | reads `/counter/TOTAL.json` and paints the digits | `initVisitorCounter()` in `js/app.js` |

`js/app.js` **reads the site code off that script tag** rather than hardcoding it, so
the counting URL and the displayed URL can never drift apart. The display half only
ever performs a GET of a number — it can't record, inflate, or lose a visit.

To switch the counter off entirely, delete the `<script data-goatcounter>` tag from
`index.html`. Tracking stops, the page contacts nobody, and the readout stays dashed.

### Account setup (already done for hunter451)

1. Free account at [goatcounter.com](https://www.goatcounter.com); the dashboard
   becomes `YOURCODE.goatcounter.com`. An email address is required.
2. **Settings → "Allow adding visitor counts on your website" → on.** This defaults
   to **off**, and `/counter/TOTAL.json` returns an error until it's enabled.

> If you ever add a Content-Security-Policy, allow
> `img-src https://YOURCODE.goatcounter.com` and
> `connect-src https://YOURCODE.goatcounter.com`.

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
