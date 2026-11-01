// @ts-check
const { test, expect } = require("@playwright/test");

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const baseStatus = (over = {}) => ({
  name: "BUDDY", unit: "BuddyTheRobot", bio: "test bio",
  dials: { humor: 75, sarcasm: 55, honesty: 95 },
  mode: "FOLLOW", started_at: iso(3_600_000), uptime_sec: 3500,
  heartbeat: iso(60_000), stale_after_sec: 4500, last_active: iso(60_000),
  ...over,
});

const json = (body, status = 200) => ({
  status, contentType: "application/json", body: JSON.stringify(body),
});

/* Third parties never load in tests. GoatCounter's count endpoint is stubbed
   per-test; giscus and fonts are always aborted. */
async function isolate(page, { counter } = {}) {
  await page.route(/gc\.zgo\.at|giscus\.app|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/goatcounter\.com\/counter/, (r) =>
    counter === undefined ? r.abort() : r.fulfill(json(counter)));
}

async function stubData(page, { status, posts, identity } = {}) {
  if (status !== undefined) await page.route("**/data/status.json", (r) => r.fulfill(json(status)));
  if (posts !== undefined) await page.route("**/data/posts.json", (r) => r.fulfill(json(posts)));
  if (identity !== undefined) await page.route("**/data/identity.json", (r) =>
    identity === null ? r.fulfill({ status: 404, body: "" }) : r.fulfill(json(identity)));
}

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("real data renders with no script errors", async ({ page }) => {
  const errors = trackErrors(page);
  await isolate(page);
  await page.goto("/");
  await expect(page.locator(".unit-line")).toContainText("UNIT:");
  await expect(page.locator(".log-entry").first()).toBeVisible();
  await expect(page.locator("#identity")).toBeVisible();
  await expect(page.locator("#identity img").first()).toHaveAttribute("src", /^media\//);
  expect(errors).toEqual([]);
});

test("feed is newest-first regardless of file order", async ({ page }) => {
  await isolate(page);
  await stubData(page, {
    status: baseStatus(),
    identity: null,
    posts: { posts: [
      { id: "A", timestamp: "2026-01-01T00:00:00Z", title: "OLDEST", body: "x" },
      { id: "C", timestamp: "2026-03-01T00:00:00Z", title: "NEWEST", body: "x" },
      { id: "B", timestamp: "2026-02-01T00:00:00Z", title: "MIDDLE", body: "x" },
    ] },
  });
  await page.goto("/");
  await expect(page.locator(".log-entry .title")).toHaveText(["NEWEST", "MIDDLE", "OLDEST"]);
});

test("body blank lines become paragraphs", async ({ page }) => {
  await isolate(page);
  await stubData(page, { status: baseStatus(), identity: null, posts: { posts: [
    { id: "1", timestamp: iso(0), title: "T", body: "one\n\ntwo\n\nthree" }] } });
  await page.goto("/");
  await expect(page.locator(".log-entry .body p")).toHaveCount(3);
});

test("fresh heartbeat shows ONLINE FOR with a live dot", async ({ page }) => {
  await isolate(page);
  await stubData(page, { status: baseStatus(), identity: null, posts: { posts: [] } });
  await page.goto("/");
  await expect(page.locator("#uptime-label")).toHaveText("Online For");
  await expect(page.locator("#live-dot")).toHaveClass(/\bon\b/);
  await expect(page.locator(".last-known")).toHaveCount(0);
});

test("stale heartbeat stops the clock and marks mode last-known", async ({ page }) => {
  await isolate(page);
  await stubData(page, {
    status: baseStatus({ heartbeat: iso(10 * 3_600_000), stale_after_sec: 60 }),
    identity: null, posts: { posts: [] },
  });
  await page.goto("/");
  await expect(page.locator("#uptime-label")).toHaveText("Last Seen");
  await expect(page.locator("#live-dot")).toHaveClass(/\boff\b/);
  await expect(page.locator(".mode-badge")).toHaveClass(/stale/);
  await expect(page.locator(".last-known")).toBeVisible();
});

test("missing heartbeat claims nothing", async ({ page }) => {
  await isolate(page);
  const s = baseStatus(); delete s.heartbeat;
  await stubData(page, { status: s, identity: null, posts: { posts: [] } });
  await page.goto("/");
  await expect(page.locator("#uptime-label")).toHaveText("Uptime");
  await expect(page.locator("#uptime-value")).toHaveText("------");
});

test("visit counter stays dashed when GoatCounter is unreachable", async ({ page }) => {
  await isolate(page);
  await page.goto("/");
  await expect(page.locator("#visitor-count")).toHaveText("------");
  await expect(page.locator("#visitor-count")).not.toHaveClass(/live/);
});

test("visit counter shows the real padded total", async ({ page }) => {
  await isolate(page, { counter: { count: "1,234" } });
  await page.goto("/");
  await expect(page.locator("#visitor-count")).toHaveText("001234");
  await expect(page.locator("#visitor-count")).toHaveClass(/live/);
});

test("post text is escaped, never parsed as HTML", async ({ page }) => {
  const errors = trackErrors(page);
  await isolate(page);
  await stubData(page, { status: baseStatus(), identity: null, posts: { posts: [
    { id: "1", timestamp: iso(0), title: "<img src=x onerror=window.__pwned=1>",
      body: "<script>window.__pwned=1</script>" }] } });
  await page.goto("/");
  await expect(page.locator(".log-entry .title")).toHaveText("<img src=x onerror=window.__pwned=1>");
  await expect(page.locator(".log-entry img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("media outside media/ is dropped", async ({ page }) => {
  await isolate(page);
  await stubData(page, { status: baseStatus(), identity: null, posts: { posts: [
    { id: "1", timestamp: iso(0), title: "T", body: "b", media: [
      "../secret.jpg", "https://evil.example/x.jpg", "media/../x.jpg",
      "media/sub/dir/x.jpg", "media/IMG_3063.jpeg",
    ] }] } });
  await page.goto("/");
  const srcs = await page.locator(".log-entry img").evaluateAll((a) => a.map((i) => i.getAttribute("src")));
  expect(srcs).toEqual(["media/IMG_3063.jpeg"]);
});

test("photos already in VISUAL ID are not repeated in the feed", async ({ page }) => {
  await isolate(page);
  const photo = { file: "media/IMG_3063.jpeg", web: "media/web/IMG_3063.jpeg", caption: "side" };
  await stubData(page, {
    status: baseStatus(),
    identity: { intro: "i", photos: [photo] },
    posts: { posts: [{ id: "1", timestamp: iso(0), title: "T", body: "b", media: [photo] }] },
  });
  await page.goto("/");
  await expect(page.locator("#identity img")).toHaveCount(1);
  await expect(page.locator(".log-entry img")).toHaveCount(0);
  await expect(page.locator(".photo-elsewhere")).toBeVisible();
});

test("missing identity.json hides VISUAL ID but keeps the feed", async ({ page }) => {
  await isolate(page);
  await stubData(page, { status: baseStatus(), identity: null, posts: { posts: [
    { id: "1", timestamp: iso(0), title: "STILL HERE", body: "b" }] } });
  await page.goto("/");
  await expect(page.locator(".log-entry .title")).toHaveText("STILL HERE");
  await expect(page.locator("#identity")).toBeHidden();
});

test("unreadable posts.json shows a worded error", async ({ page }) => {
  await isolate(page);
  await page.route("**/data/posts.json", (r) => r.fulfill({ status: 500, body: "" }));
  await page.goto("/");
  await expect(page.locator("#status-body .error")).toContainText("could not read");
});

test("no LiDAR scope without scan.json", async ({ page }) => {
  await isolate(page);
  await page.goto("/");
  await expect(page.locator(".log-entry").first()).toBeVisible();
  await expect(page.locator("#scope")).toBeHidden();
});

test("no horizontal page scroll", async ({ page }) => {
  await isolate(page);
  await page.goto("/");
  await expect(page.locator(".log-entry").first()).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
