/* ============================================================
   BUDDY TERMINAL — front-end renderer
   Reads two static data files and paints the screen:
     data/status.json  -> the STATUS HEADER
     data/posts.json    -> the LOG FEED (sorted newest-first here,
                           so file order never matters)
   No framework, no build step. Plain fetch + DOM.
   ============================================================ */
"use strict";

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
    </div>`;
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
})();
