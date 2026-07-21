/* ============================================================
   BUDDY TERMINAL — front-end renderer
   Reads two static data files and paints the screen:
     data/status.json  -> the STATUS HEADER
     data/posts.json    -> the LOG FEED (sorted newest-first here,
                           so file order never matters)
   No framework, no build step. Plain fetch + DOM.
   ============================================================ */
"use strict";

/* ============================================================
   VISITOR COUNTER

   Configured by the <script data-goatcounter="..."> tag in index.html — that
   attribute is the single source of truth, so the code that COUNTS and the code
   that DISPLAYS can never point at different sites. Remove the tag and the
   counter switches off completely: no tracking, no requests from here, and the
   readout stays dashed.
   ============================================================ */
/* Digits in the readout, e.g. 42 -> "000042". Bigger numbers are NOT truncated. */
const VISITOR_DIGITS = 6;
/* Shown before the real count arrives, and left in place if it never does. */
const VISITOR_PLACEHOLDER = "-".repeat(VISITOR_DIGITS);

const METER_CELLS = 20;   // width of the [██████░░░░] bars

/* ============================================================
   LIVENESS

   status.json carries three fields that together answer "is he on right now?":
     started_at       when the current session began
     uptime_sec       how long he had been up AS OF the heartbeat (robot-computed,
                      so it can't be skewed by the viewer's clock)
     heartbeat        when that snapshot was taken — the proof of life
     stale_after_sec  how old a heartbeat may get before we must stop claiming
                      he's online (the ROBOT publishes this, because only the
                      writer knows its own push cadence — hardcoding a number
                      here would eventually disagree with it)

   The uptime clock ticks in the browser rather than being published as a counter.
   That isn't an optimisation: this site is static files on a CDN, so a pushed
   counter would be minutes stale the instant it landed, and pushing one often
   enough to look live would exceed the host's build limit. Ticking locally from a
   timestamp is the only way the number is ever actually right.

   Honesty rule, same as the visitor counter: never show a number we can't stand
   behind. A missing field is a dash. A stale heartbeat stops the clock and the
   page says LAST SEEN instead of pretending he's still up.
   ============================================================ */
const STATUS_POLL_SEC = 60;      // re-read status.json so an open tab stays current
const STALE_AFTER_FALLBACK = 4500;  // used only if status.json omits stale_after_sec

let statusData = null;      // most recent status.json we successfully read
let statusTimer = null;     // 1s tick driving the uptime readout
/* The visitor count is fetched once, but the status header is re-rendered on every
   poll — so the last painted count is remembered here and restored into the fresh
   markup. Without this the counter would drop back to dashes every poll, which would
   read as "the count broke" rather than "the header refreshed". */
let visitorText = VISITOR_PLACEHOLDER;
let visitorLive = false;

/* Files on show in the VISUAL ID gallery. The feed consults this so a photograph
   pinned at the top isn't drawn a second time further down. Populated by
   renderIdentity, which therefore has to run BEFORE renderFeed. */
let identityFiles = new Set();

/* Seconds -> "3d 14h 22m" / "5h 02m" / "47m" / "18s". Compact and monospace-stable:
   the largest two units only, so the string doesn't grow without bound. */
function fmtDuration(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
}

/* Epoch ms for an ISO stamp, or NaN. */
function stampMs(input) {
  const d = new Date(input);
  return isNaN(d) ? NaN : d.getTime();
}

/* Work out what we may honestly claim about Buddy right now.

   Returns {known, online, uptimeSec, lastSeen}. `known:false` means status.json
   didn't carry the heartbeat fields at all (an older file) — in that case we assert
   nothing: no clock, no ONLINE badge, just a dash. */
function liveness(s, nowMs = Date.now()) {
  const hb = stampMs(s && s.heartbeat);
  if (isNaN(hb)) return { known: false, online: false, uptimeSec: NaN, lastSeen: null };

  // Age of the heartbeat. Clamped at 0: a viewer clock running behind the robot's
  // would otherwise read as a negative age, and we'd rather under-claim staleness
  // than invent a future timestamp.
  const ageSec = Math.max(0, (nowMs - hb) / 1000);
  const staleAfter = Number(s.stale_after_sec) > 0
    ? Number(s.stale_after_sec) : STALE_AFTER_FALLBACK;
  const online = ageSec <= staleAfter;

  // Base the clock on the robot's own uptime_sec and add the file's age, so viewer
  // clock skew shifts the reading by the skew instead of compounding into it.
  const base = Number(s.uptime_sec);
  const uptimeSec = isNaN(base) ? NaN : base + ageSec;
  return { known: true, online, uptimeSec, lastSeen: hb };
}

/* Build a phosphor bar for a 0..100 value: filled cells + empty cells. */
function meterBar(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * METER_CELLS);
  const empty = METER_CELLS - filled;
  return `[<span class="on">${"█".repeat(filled)}</span>` +
         `<span class="empty">${"░".repeat(empty)}</span>]`;
}

/* Two-digit zero pad. */
const pad = (n) => String(n).padStart(2, "0");

/* ISO / epoch -> "YYYY-MM-DD HH:MM:SS" in the viewer's local time.
   Terminal logs read best as a fixed, sortable stamp. */
function fmtStamp(input) {
  const d = new Date(input);
  if (isNaN(d)) return String(input);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* Escape untrusted strings before they touch innerHTML. Post/status data is
   Buddy's own, but treating it as data (never markup) is the safe default. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* A post body is plain text; split blank lines into paragraphs. */
function bodyToParagraphs(body) {
  return String(body ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function loadJSON(path) {
  const resp = await fetch(path, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status}`);
  return resp.json();
}

/* ----------------------- STATUS HEADER ----------------------- */
function renderStatus(s) {
  const el = document.getElementById("status-body");
  const dials = s.dials || {};
  const battery = Number(s.battery_pct);
  const batAlert = !isNaN(battery) && battery <= 20;
  const mode = String(s.mode || "UNKNOWN").toUpperCase();
  const following = mode.includes("FOLLOW");
  const live = liveness(s);

  const row = (label, meterHTML, valueHTML, valueClass = "") =>
    `<div class="label">${esc(label)}</div>` +
    `<div class="meter${valueClass}">${meterHTML}</div>` +
    `<div class="value${valueClass}">${valueHTML}</div>`;

  const rows = [];
  if ("humor" in dials)   rows.push(row("Humor",   meterBar(dials.humor),   `${Math.round(dials.humor)}%`));
  if ("sarcasm" in dials) rows.push(row("Sarcasm", meterBar(dials.sarcasm), `${Math.round(dials.sarcasm)}%`));
  if ("honesty" in dials) rows.push(row("Honesty", meterBar(dials.honesty), `${Math.round(dials.honesty)}%`));
  if (!isNaN(battery))
    rows.push(row("Battery", meterBar(battery), `${Math.round(battery)}%`, batAlert ? " alert" : ""));

  // The mode is only current while the heartbeat is. Once it goes stale the badge is
  // dimmed and labelled last-known, so a FOLLOW badge can't imply he's moving now.
  const modeStale = live.known && !live.online;
  const modeBadge =
    `<span class="mode-badge${following ? " follow" : ""}${modeStale ? " stale" : ""}"` +
    `${modeStale ? ' title="Last known mode, from the most recent update. Buddy may be offline."' : ""}` +
    `>${esc(mode)}</span>${modeStale ? '<span class="last-known"> last known</span>' : ""}`;

  el.innerHTML = `
    <div class="unit-line">UNIT: ${esc(s.name || "BUDDY")}
      <span class="handle">// ${esc(s.unit || s.handle || "")}</span>
      <span class="live-dot" id="live-dot" aria-hidden="true"></span></div>
    <div class="bio">"${esc(s.bio || "")}"</div>
    <div class="readout">
      ${rows.join("\n")}
      <div class="label">Mode</div><div class="meter"></div><div class="value">${modeBadge}</div>
      <div class="label" id="uptime-label">Online For</div><div class="meter"></div>
        <div class="value uptime" id="uptime-value">${VISITOR_PLACEHOLDER}</div>
      <div class="label">Last Active</div><div class="meter"></div>
        <div class="value">${esc(fmtStamp(s.last_active))}</div>
      <div class="label">Visits</div><div class="meter"></div>
        <div class="value visitors${visitorLive ? " live" : ""}" id="visitor-count"
             title="Real count from GoatCounter: visits, not page loads — one per person per 8 hours. Cookieless; no IP addresses stored. Totals are cached up to 4 hours, so a new visit takes a while to appear. Dashes mean the count is unavailable, never zero.">${esc(visitorText)}</div>
    </div>`;
  paintUptime();
}

/* Repaint just the uptime row + live dot. Called once per second, so it touches the
   three nodes it owns and nothing else — re-rendering the whole header every tick
   would fight the visitor counter for the same DOM. */
function paintUptime() {
  const labelEl = document.getElementById("uptime-label");
  const valueEl = document.getElementById("uptime-value");
  const dotEl = document.getElementById("live-dot");
  if (!labelEl || !valueEl) return;
  const live = liveness(statusData || {});

  if (!live.known) {
    // No heartbeat in the file: we genuinely don't know. Dash, and claim nothing.
    labelEl.textContent = "Uptime";
    valueEl.textContent = VISITOR_PLACEHOLDER;
    valueEl.className = "value uptime";
    valueEl.title = "This status file predates the heartbeat, so uptime is unknown.";
    if (dotEl) dotEl.className = "live-dot unknown";
    return;
  }
  if (live.online) {
    labelEl.textContent = "Online For";
    valueEl.textContent = isNaN(live.uptimeSec)
      ? VISITOR_PLACEHOLDER : fmtDuration(live.uptimeSec);
    valueEl.className = "value uptime live";
    valueEl.title = `Session started ${fmtStamp(statusData.started_at)}. ` +
                    `Last heartbeat ${fmtStamp(statusData.heartbeat)}.`;
    if (dotEl) dotEl.className = "live-dot on";
  } else {
    // Stale: stop the clock. Showing a number that keeps climbing after he's been
    // switched off is exactly the lie this row exists to avoid.
    labelEl.textContent = "Last Seen";
    valueEl.textContent = fmtStamp(statusData.heartbeat);
    valueEl.className = "value uptime offline";
    valueEl.title = "No update recently — Buddy may be offline. " +
                    "This is when he last checked in, not a live reading.";
    if (dotEl) dotEl.className = "live-dot off";
  }
}

/* Adopt a freshly-read status document and (re)start the 1s clock. */
function applyStatus(s) {
  statusData = s;
  renderStatus(s);
  if (statusTimer === null) statusTimer = setInterval(paintUptime, 1000);
}

/* Re-read status.json on a slow poll so a tab left open follows Buddy coming and
   going. A failed poll keeps whatever we last had — never blank the header, and
   never let a network blip read as "offline"; only a stale HEARTBEAT does that. */
async function pollStatus() {
  try {
    applyStatus(await loadJSON("data/status.json"));
  } catch (err) {
    console.warn("status poll failed; keeping last known values:", err);
  }
  // The scan is published on the same cadence, so refresh it on the same beat. A
  // failed read leaves the previous scope alone; only its own timestamp going stale
  // may turn it into NO SCAN.
  try {
    renderScan(await loadJSON("data/scan.json"));
  } catch (err) {
    console.warn("scan poll failed; keeping last known scope:", err);
  }
}

/* ----------------------- VISITOR COUNTER -----------------------
   A REAL count, or nothing at all.

   Counting is done by GoatCounter's count.js (the tag in index.html). This code
   only READS the resulting total and paints it — it never counts anything and
   never writes. So a display failure can't lose a visit, and a blocked counter
   endpoint can't stop a visit being recorded.

   If anything fails — offline, blocked by a content blocker, service down, or
   the site's "allow visitor counts" setting turned off — the dashes stay put.
   We never invent, cache, estimate, or carry over a number. A counter that
   lies is worse than no counter. */

/* The counter origin, taken from the count.js tag so there is exactly one place
   the site code lives. Returns null when the tag is absent or malformed, which
   disables the readout rather than guessing a URL. */
function goatcounterOrigin() {
  const tag = document.querySelector("script[data-goatcounter]");
  if (!tag) return null;
  try {
    const url = new URL(tag.dataset.goatcounter, location.href);
    return url.protocol === "https:" ? url.origin : null;
  } catch (err) {
    console.warn("visitor counter: unusable data-goatcounter value:", err);
    return null;
  }
}

/* Paint the site-wide total. Leaves the dashes untouched on any failure. */
async function showVisitorCount(origin) {
  const el = document.getElementById("visitor-count");
  if (!el) return;
  try {
    // "TOTAL" is GoatCounter's special path for the whole-site figure.
    const resp = await fetch(`${origin}/counter/TOTAL.json`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`counter -> HTTP ${resp.status}`);
    const data = await resp.json();
    // `count` arrives as a formatted string ("1,234"); keep only the digits.
    const digits = String(data.count ?? "").replace(/[^0-9]/g, "");
    if (!digits) throw new Error(`unparseable count: ${JSON.stringify(data.count)}`);
    visitorText = digits.padStart(VISITOR_DIGITS, "0");
    visitorLive = true;         // remembered, so a header re-render keeps the number
    el.textContent = visitorText;
    el.classList.add("live");
  } catch (err) {
    // Honest failure: keep the dashes, say why in the console only.
    console.warn("visitor counter unavailable:", err);
  }
}

function initVisitorCounter() {
  const origin = goatcounterOrigin();
  if (!origin) return;        // no counting tag: no request, dashes stay
  showVisitorCount(origin);
}

/* ----------------------- ATTACHED PHOTOS -----------------------
   A post may carry real photographs (files a human dropped into media/ and
   published alongside the text — nothing here is generated). Each entry is
   either a bare filename string or {file, caption}. Anything that isn't a
   media/ image path is dropped rather than rendered, so the feed can never be
   talked into pointing somewhere else. */
/* media/x.jpg, or media/web/x.jpg for a downscaled copy. The optional segment is
   spelled out rather than allowing any subdirectory, so the pattern still can't be
   talked into ../ , an absolute path, or anywhere outside those two folders. */
const MEDIA_OK = /^media\/(?:web\/)?[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp)$/i;

/* Each entry becomes {file, web, caption}:
     file  the ORIGINAL, full-resolution image — what a click opens
     web   an optional downscaled copy used for the on-page render
   `web` is validated separately and dropped if unusable, so a bad or missing
   downscale silently falls back to showing the original rather than a broken img. */
function mediaEntries(post) {
  const raw = Array.isArray(post.media) ? post.media : [];
  return raw
    .map((m) => (typeof m === "string" ? { file: m, caption: "" } : (m || {})))
    .map((m) => ({ file: String(m.file || ""), web: String(m.web || ""),
                   caption: String(m.caption || "") }))
    .filter((m) => MEDIA_OK.test(m.file))
    .map((m) => (MEDIA_OK.test(m.web) ? m : { ...m, web: "" }));
}

/* How many columns a strip of n photos should use on a wide screen.
   The strip centres its trailing row itself, so the only job here is to avoid
   a lonely last photo sitting under a full row: 7 photos in 3 columns is
   3+3+1, which reads as a mistake; in 4 columns it is 4+3 with the 3 centred,
   which reads as a deliberate layout. CSS caps this down on narrow screens. */
function photoColumns(n) {
  if (n <= 1) return 1;
  if (n === 2 || n === 4) return 2;   // 2, and 2+2 rather than one flat row
  if (n % 3 === 0) return 3;          // 3, 6, 9 … exact rows
  if (n % 4 === 0) return 4;          // 8, 12 … exact rows
  return n > 6 ? 4 : 3;               // 5 -> 3+2, 7 -> 4+3, 10 -> 4+4+2
}

function renderPhotos(post, { skipIdentity = false } = {}) {
  const all = mediaEntries(post);
  // In the FEED, drop anything already on show in the VISUAL ID gallery so the same
  // photograph never appears twice on one page. The post's DATA is untouched — this
  // is only what gets drawn.
  const shots = (skipIdentity && identityFiles.size)
    ? all.filter((m) => !identityFiles.has(m.file))
    : all;
  if (!shots.length) {
    // Every photo on this entry is up in the gallery. Say so, rather than leaving it
    // looking as though its pictures failed to load.
    return (skipIdentity && all.length)
      ? `<div class="photo-elsewhere">Photographs shown in VISUAL ID, above.</div>`
      : "";
  }
  const figures = shots.map((m, i) => {
    const cap = m.caption || `Photograph ${i + 1}`;
    // Draw the downscaled copy when there is one; the link always opens the original.
    return `
      <figure class="photo">
        <a class="photo-frame" href="${esc(m.file)}" target="_blank" rel="noopener"
           aria-label="Open photograph ${i + 1} full size">
          <img src="${esc(m.web || m.file)}" alt="${esc(cap)}" loading="lazy" decoding="async">
          <span class="photo-scan" aria-hidden="true"></span>
          <span class="photo-tag" aria-hidden="true">IMG.${pad(i + 1)}</span>
        </a>
        ${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ""}
      </figure>`;
  }).join("\n");
  const cols = photoColumns(shots.length);
  return `<div class="photo-strip${shots.length === 1 ? " single" : ""}" data-cols="${cols}">${figures}</div>`;
}

/* ----------------------- VISUAL ID -----------------------
   A permanent gallery of the real unit, pinned between the status header and the
   log feed. It reads data/identity.json — a file the robot's publisher never
   touches — so no post, photo post, or journal entry can alter it.

   It deliberately goes through the SAME renderPhotos() as the feed: same media/
   path validation, same balanced column counts, same frames and breakpoints. A
   second copy of that layout would be one more thing to keep in sync. */
function renderIdentity(doc) {
  const section = document.getElementById("identity");
  const body = document.getElementById("identity-body");
  if (!section || !body) return;

  const photos = (doc && doc.photos) || [];
  // The validated set drives the feed's de-duplication, so it must record what was
  // actually RENDERED - not what the file asked for. A photo dropped as invalid here
  // is not "shown above", and the feed must still show it.
  const shots = mediaEntries({ media: photos });
  identityFiles = new Set(shots.map((m) => m.file));

  const strip = renderPhotos({ media: photos });
  if (!strip) {
    section.hidden = true;
    return;
  }
  const intro = String((doc && doc.intro) || "").trim();
  body.innerHTML = (intro ? `<div class="identity-intro">${esc(intro)}</div>` : "") + strip;
  section.hidden = false;
}

/* ----------------------- LIDAR SCOPE -----------------------
   ONE sweep, drawn as a radial scope. Not a map, not live, not a floor plan -
   Buddy has no SLAM and no reliable position, so a floor plan would have to be
   invented. This is the honest alternative: what the sensor measured, from
   wherever it happened to be standing, at one moment.

   Three rules hold this together, and all three are load-bearing:

   1. BLIPS ONLY. The returns are never joined into a polygon or an outline.
      Connecting two measurements would draw a wall between them that nothing
      measured - the single most tempting way for this picture to lie.
   2. ABSENT IS ABSENT. Bearings with no return simply have no dot. The robot
      omits them from the file entirely, so there is no value here to pad out to
      max range, and empty space on the scope means "not measured" - never "clear".
   3. STALE MEANS NO SCAN. Past the freshness budget the scope is not drawn at
      all. An old sweep rendered as a ring of blips would read as a live picture
      of a room that may have changed completely.

   Sweep density is NOT known ahead of time - how many of the 360 bearings a real
   sweep returns has never been measured on hardware. So nothing here assumes a
   full ring: the count is reported, and one blip renders as correctly as three
   hundred. */
const SCOPE_SIZE = 400;      // SVG viewBox, scales fluidly via CSS
const SCOPE_R = 168;         // radius in viewBox units at max_range_cm

/* Same shape as liveness(), against the scan's own stamp and budget. */
function scanFreshness(doc, nowMs = Date.now()) {
  const t = stampMs(doc && doc.taken_at);
  if (isNaN(t)) return { known: false, fresh: false, takenMs: NaN, ageSec: NaN };
  const ageSec = Math.max(0, (nowMs - t) / 1000);
  const limit = Number(doc.stale_after_sec) > 0
    ? Number(doc.stale_after_sec) : STALE_AFTER_FALLBACK;
  return { known: true, fresh: ageSec <= limit, takenMs: t, ageSec };
}

/* Bearing -> viewBox point. 0 deg is dead ahead (up) and angles increase
   CLOCKWISE, matching the robot's own convention (x = right, y = forward). */
function scopeXY(deg, r) {
  const th = (Number(deg) || 0) * Math.PI / 180;
  return [SCOPE_SIZE / 2 + r * Math.sin(th), SCOPE_SIZE / 2 - r * Math.cos(th)];
}

/* Plotted range: the furthest actual return, rounded up to a tidy step and capped at
   the sensor limit - a scope fixed at max range would draw a 2m room as a dot in the
   middle. This is a zoom, not a distortion: the rings carry their real distance in
   cm, so the scale is always legible rather than assumed. */
function scopeSpan(pts, max) {
  const far = pts.reduce((m, p) => {
    const d = Number(Array.isArray(p) ? p[1] : NaN);
    return isFinite(d) && d > 0 && d <= max ? Math.max(m, d) : m;
  }, 0);
  if (!far) return max;
  return Math.min(max, Math.max(60, Math.ceil(far / 30) * 30));
}

function scopeSVG(doc) {
  const max = Number(doc.max_range_cm) > 0 ? Number(doc.max_range_cm) : 600;
  const pts = Array.isArray(doc.points) ? doc.points : [];
  const span = scopeSpan(pts, max);
  const c = SCOPE_SIZE / 2;
  const parts = [];

  for (let i = 1; i <= 3; i++) {                    // range rings, labelled in cm
    const cm = (span / 3) * i;
    const r = SCOPE_R * (cm / span);
    parts.push(`<circle class="scope-ring" cx="${c}" cy="${c}" r="${r.toFixed(1)}"/>`);
    parts.push(`<text class="scope-ringlbl" x="${c + 5}" y="${(c - r + 12).toFixed(1)}">${Math.round(cm)}cm</text>`);
  }
  for (let a = 0; a < 360; a += 45) {               // bearing spokes
    const [x, y] = scopeXY(a, SCOPE_R);
    parts.push(`<line class="scope-spoke" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
  }
  [[0, "0"], [90, "90"], [180, "180"], [270, "270"]].forEach(([a, t]) => {
    const [x, y] = scopeXY(a, SCOPE_R + 15);
    parts.push(`<text class="scope-brg" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${t}°</text>`);
  });
  // The measurements themselves. Discrete dots, deliberately unconnected.
  pts.forEach((p) => {
    const a = Number(Array.isArray(p) ? p[0] : NaN);
    const d = Number(Array.isArray(p) ? p[1] : NaN);
    if (!isFinite(a) || !isFinite(d) || d <= 0 || d > max) return;
    const [x, y] = scopeXY(a, SCOPE_R * Math.min(1, d / span));
    parts.push(`<circle class="scope-blip" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>`);
  });
  parts.push(`<circle class="scope-origin" cx="${c}" cy="${c}" r="3.4"/>`);

  return `<svg class="scope-svg" viewBox="0 0 ${SCOPE_SIZE} ${SCOPE_SIZE}"
      role="img" aria-label="Radial plot of ${pts.length} LiDAR returns measured around Buddy">
      ${parts.join("")}
    </svg>`;
}

/* The measured text facts: one survey run, plus the lifetime aggregate. */
function scopeFacts(doc) {
  const rows = [];
  const sv = doc && doc.survey;
  if (sv) {
    const when = sv.taken_at ? fmtStamp(sv.taken_at) : "—";
    rows.push(`<div class="scope-fact"><span class="k">Survey</span>
      <span class="v">${esc(when)}</span></div>`);
    if (sv.selection) {
      rows.push(`<div class="scope-note">${esc(sv.selection)}${
        sv.runs_on_file ? `, of ${esc(String(sv.runs_on_file))} on file` : ""}</div>`);
    }
    const bits = [];
    if (sv.stations) bits.push(`${sv.stations} vantage point${sv.stations === 1 ? "" : "s"}`);
    if (Array.isArray(sv.sectors) && sv.sectors.length) bits.push(`${sv.sectors.length} bearings measured`);
    if (sv.reason) bits.push(`ended: ${sv.reason}`);
    if (bits.length) rows.push(`<div class="scope-fact"><span class="k">Run</span>
      <span class="v">${esc(bits.join(" · "))}</span></div>`);

    const exits = Array.isArray(sv.exits) ? sv.exits : [];
    rows.push(`<div class="scope-fact"><span class="k">Ways out</span><span class="v">${
      exits.length
        ? exits.map((e) => `${esc(String(Math.round(e.world_deg)))}° at ${
            esc(String(Math.round(e.clearance_cm)))}cm${
            e.description ? ` — “${esc(e.description)}”` : ""}`).join("; ")
        : "none found on that run"}</span></div>`);

    const seen = (Array.isArray(sv.sectors) ? sv.sectors : [])
      .map((s) => s.description).filter(Boolean);
    if (seen.length) {
      rows.push(`<div class="scope-fact"><span class="k">Camera saw</span><span class="v">${
        seen.map((s) => `“${esc(s)}”`).join(", ")}</span></div>`);
    }
  }
  const lt = doc && doc.lifetime;
  if (lt && (lt.distance_m != null || lt.sessions != null)) {
    rows.push(`<div class="scope-fact"><span class="k">Lifetime</span><span class="v">${
      esc(String(lt.distance_m ?? "—"))} m driven across ${
      esc(String(lt.sessions ?? "—"))} sessions</span></div>`);
  }
  return rows.join("");
}

function renderScan(doc) {
  const section = document.getElementById("scope");
  const body = document.getElementById("scope-body");
  const title = document.getElementById("scope-title");
  if (!section || !body) return;
  if (!doc) { section.hidden = true; return; }      // scan publishing is off
  section.hidden = false;

  const f = scanFreshness(doc);
  const pts = Array.isArray(doc.points) ? doc.points : [];

  if (!f.known || !f.fresh || !pts.length) {
    // No honest picture to draw. Say so in words - never an empty ring, which
    // would read as a room with nothing in it.
    if (title) title.textContent = "NO SCAN";
    body.innerHTML = `
      <div class="scope-none">
        <div class="scope-none-tag">NO SCAN</div>
        <div class="scope-none-why">${
          !f.known ? "No sweep has been published."
          : !pts.length ? "The last sweep returned no measurements."
          : `Last sweep was ${esc(fmtStamp(doc.taken_at))} — too old to show as current.`
        } This is not a reading of an empty room; it means nothing was measured.</div>
      </div>`;
    return;
  }
  if (title) title.textContent = `LAST SCAN — ${fmtStamp(doc.taken_at).slice(11)}`;
  body.innerHTML = `
    <div class="scope-wrap">${scopeSVG(doc)}</div>
    <div class="scope-meta">
      <div class="scope-fact"><span class="k">Taken</span>
        <span class="v">${esc(fmtStamp(doc.taken_at))}</span></div>
      <div class="scope-fact"><span class="k">Returns</span>
        <span class="v">${esc(String(doc.bins_returned ?? pts.length))} of ${
          esc(String(doc.bins_possible ?? 360))} bearings measured · furthest ${
          esc(String(Math.round(pts.reduce((m, p) => Math.max(m, Number(p[1]) || 0), 0))))}cm
          of ${esc(String(doc.max_range_cm ?? "—"))}cm sensor range</span></div>
      ${scopeFacts(doc)}
      ${doc.frame ? `<div class="scope-note">${esc(doc.frame)}</div>` : ""}
    </div>`;
}

/* ----------------------- LOG FEED ----------------------- */
function renderFeed(posts) {
  const el = document.getElementById("feed-body");
  const list = Array.isArray(posts) ? posts.slice() : (posts.posts || []);
  // Guarantee reverse-chronological regardless of the file's order.
  list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!list.length) {
    el.innerHTML = `<div class="loading">// no log entries yet.</div>`;
    return;
  }
  el.innerHTML = list.map((post) => `
    <article class="log-entry">
      <div class="meta">[${esc(fmtStamp(post.timestamp))}] &mdash; LOG ENTRY${
        post.id ? " #" + esc(post.id) : ""}</div>
      <h2 class="title">${esc(post.title || "(untitled)")}</h2>
      <div class="body">${bodyToParagraphs(post.body)}</div>
      ${renderPhotos(post, { skipIdentity: true })}
    </article>`).join("\n");
}

function showFetchError(where) {
  const msg = `
    <div class="error">
      // ERROR: could not read <code>${esc(where)}</code>.<br><br>
      If you opened <code>index.html</code> directly (file://), the browser blocks
      loading local JSON. Serve the folder over HTTP instead:<br><br>
      &nbsp;&nbsp;<code>python3 -m http.server</code><br><br>
      &hellip;then visit <code>http://localhost:8000</code>.
    </div>`;
  document.getElementById("status-body").innerHTML = msg;
  document.getElementById("feed-body").innerHTML = "";
}

/* ----------------------- BOOT (non-blocking) ----------------------- */
(async function init() {
  try {
    // identity.json is OPTIONAL: it resolves to null rather than rejecting, so a
    // missing gallery can never cost the reader the status header or the log feed.
    const [status, posts, identity, scan] = await Promise.all([
      loadJSON("data/status.json"),
      loadJSON("data/posts.json"),
      loadJSON("data/identity.json").catch((err) => {
        console.warn("visual ID unavailable:", err);
        return null;
      }),
      // Absent whenever scan publishing is off (its default). Null hides the
      // section entirely rather than showing an empty scope.
      loadJSON("data/scan.json").catch(() => null),
    ]);
    applyStatus(status);
    renderIdentity(identity);     // MUST precede renderFeed - it fills identityFiles
    renderFeed(posts);
    renderScan(scan);
    setInterval(pollStatus, STATUS_POLL_SEC * 1000);
  } catch (err) {
    console.error(err);
    showFetchError((err && err.message) || "data files");
  }
  // Runs regardless: a visit still counts even if Buddy's data files are
  // unreachable, and the counter is independent of them.
  initVisitorCounter();
})();
