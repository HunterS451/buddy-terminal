#!/usr/bin/env node
// Static-site sanity checks. No dependencies. Run: node scripts/check.mjs
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (msg) => errors.push(msg);
const MEDIA_OK = /^media\/(?:web\/)?[A-Za-z0-9._-]+\.(jpe?g|png|gif|webp)$/i;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

function readJSON(rel, required = true) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) { if (required) fail(`${rel}: missing`); return null; }
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { fail(`${rel}: invalid JSON (${e.message})`); return null; }
}

function checkMedia(where, m) {
  const entry = typeof m === "string" ? { file: m } : m || {};
  for (const key of ["file", "web"]) {
    const v = entry[key];
    if (v === undefined || v === "") { if (key === "file") fail(`${where}: missing file`); continue; }
    if (!MEDIA_OK.test(v)) { fail(`${where}: ${key} "${v}" fails MEDIA_OK pattern`); continue; }
    const p = join(ROOT, v);
    if (!existsSync(p)) fail(`${where}: ${key} "${v}" does not exist`);
    else if (statSync(p).size > MAX_MEDIA_BYTES) fail(`${where}: ${key} "${v}" exceeds 12 MB`);
  }
}

const validStamp = (s) => typeof s === "string" && !isNaN(new Date(s));

// --- posts.json
const posts = readJSON("data/posts.json");
if (posts) {
  const list = Array.isArray(posts) ? posts : posts.posts;
  if (!Array.isArray(list)) fail("data/posts.json: no posts array");
  else {
    const ids = new Set();
    list.forEach((p, i) => {
      const w = `posts[${i}]${p && p.id ? ` (#${p.id})` : ""}`;
      if (!p || typeof p !== "object") return fail(`${w}: not an object`);
      if (p.id !== undefined) {
        if (ids.has(p.id)) fail(`${w}: duplicate id`);
        ids.add(p.id);
      }
      if (!validStamp(p.timestamp)) fail(`${w}: invalid timestamp "${p.timestamp}"`);
      if (typeof p.title !== "string" || !p.title.trim()) fail(`${w}: missing title`);
      if (typeof p.body !== "string") fail(`${w}: body must be a string`);
      if (p.media !== undefined) {
        if (!Array.isArray(p.media)) fail(`${w}: media must be an array`);
        else p.media.forEach((m, j) => checkMedia(`${w}.media[${j}]`, m));
      }
    });
  }
}

// --- status.json
const status = readJSON("data/status.json");
if (status) {
  for (const k of ["heartbeat", "started_at", "last_active"])
    if (status[k] !== undefined && !validStamp(status[k])) fail(`data/status.json: invalid ${k}`);
  for (const [k, v] of Object.entries(status.dials || {}))
    if (typeof v !== "number" || v < 0 || v > 100) fail(`data/status.json: dial ${k} out of 0..100`);
}

// --- identity.json (optional)
const identity = readJSON("data/identity.json", false);
if (identity) {
  if (!Array.isArray(identity.photos)) fail("data/identity.json: photos must be an array");
  else identity.photos.forEach((m, j) => checkMedia(`identity.photos[${j}]`, m));
}

// --- scan.json (optional)
readJSON("data/scan.json", false);

// --- JS syntax
for (const f of ["js/app.js"]) {
  try { execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" }); }
  catch (e) { fail(`${f}: syntax error\n${e.stderr}`); }
}

// --- index.html local references + id uniqueness
const html = readFileSync(join(ROOT, "index.html"), "utf8");
if (!/^<!DOCTYPE html>/i.test(html.trimStart())) fail("index.html: missing doctype");
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (/^(?:[a-z]+:)?\/\//i.test(ref) || ref.startsWith("#") || /^(mailto|data):/.test(ref)) continue;
  if (!existsSync(join(ROOT, ref.split(/[?#]/)[0]))) fail(`index.html: broken reference "${ref}"`);
}
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, "");
const seen = new Set();
for (const [, id] of htmlNoComments.matchAll(/\sid="([^"]+)"/g)) {
  if (seen.has(id)) fail(`index.html: duplicate id "${id}"`);
  seen.add(id);
}
for (const tag of ["main", "section", "header", "footer"]) {
  const open = (htmlNoComments.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;
  const close = (htmlNoComments.match(new RegExp(`</${tag}>`, "g")) || []).length;
  if (open !== close) fail(`index.html: <${tag}> open/close mismatch (${open}/${close})`);
}

// --- CSS references
for (const f of ["css/style.css", "css/giscus.css"]) {
  const css = readFileSync(join(ROOT, f), "utf8");
  for (const [, ref] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
    if (!existsSync(join(ROOT, dirname(f), ref))) fail(`${f}: broken url("${ref}")`);
  }
}

// --- feed.xml must match posts.json
try {
  execFileSync("python3", [join(ROOT, "scripts/build_feed.py"), "--check"], { stdio: "pipe" });
} catch (e) {
  fail(`feed.xml: ${String(e.stderr || e.message).trim()}`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("✓ site checks passed");
