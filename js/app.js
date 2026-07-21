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

  const modeBadge =
    `<span class="mode-badge${following ? " follow" : ""}">${esc(mode)}</span>`;

  el.innerHTML = `
    <div class="unit-line">UNIT: ${esc(s.name || "BUDDY")}
      <span class="handle">// ${esc(s.unit || s.handle || "")}</span></div>
    <div class="bio">"${esc(s.bio || "")}"</div>
    <div class="readout">
      ${rows.join("\n")}
      <div class="label">Mode</div><div class="meter"></div><div class="value">${modeBadge}</div>
      <div class="label">Last Active</div><div class="meter"></div>
        <div class="value">${esc(fmtStamp(s.last_active))}</div>
      <div class="label">Visits</div><div class="meter"></div>
        <div class="value visitors" id="visitor-count"
             title="Real count from GoatCounter: visits, not page loads — one per person per 8 hours. Cookieless; no IP addresses stored. Totals are cached up to 4 hours, so a new visit takes a while to appear. Dashes mean the count is unavailable, never zero.">${VISITOR_PLACEHOLDER}</div>
    </div>`;
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
    el.textContent = digits.padStart(VISITOR_DIGITS, "0");
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
const MEDIA_OK = /^media\/[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp)$/i;

function mediaEntries(post) {
  const raw = Array.isArray(post.media) ? post.media : [];
  return raw
    .map((m) => (typeof m === "string" ? { file: m, caption: "" } : (m || {})))
    .map((m) => ({ file: String(m.file || ""), caption: String(m.caption || "") }))
    .filter((m) => MEDIA_OK.test(m.file));
}

function renderPhotos(post) {
  const shots = mediaEntries(post);
  if (!shots.length) return "";
  const figures = shots.map((m, i) => {
    const cap = m.caption || `Photograph ${i + 1}`;
    return `
      <figure class="photo">
        <a class="photo-frame" href="${esc(m.file)}" target="_blank" rel="noopener"
           aria-label="Open photograph ${i + 1} full size">
          <img src="${esc(m.file)}" alt="${esc(cap)}" loading="lazy" decoding="async">
          <span class="photo-scan" aria-hidden="true"></span>
          <span class="photo-tag" aria-hidden="true">IMG.${pad(i + 1)}</span>
        </a>
        ${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ""}
      </figure>`;
  }).join("\n");
  return `<div class="photo-strip${shots.length === 1 ? " single" : ""}">${figures}</div>`;
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
      ${renderPhotos(post)}
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
    const [status, posts] = await Promise.all([
      loadJSON("data/status.json"),
      loadJSON("data/posts.json"),
    ]);
    renderStatus(status);
    renderFeed(posts);
  } catch (err) {
    console.error(err);
    showFetchError((err && err.message) || "data files");
  }
  // Runs regardless: a visit still counts even if Buddy's data files are
  // unreachable, and the counter is independent of them.
  initVisitorCounter();
})();
