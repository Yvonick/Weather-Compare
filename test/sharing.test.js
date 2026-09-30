import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleShareRequest } from "../server/shares.js";
import { openLocalShareDatabase } from "../scripts/local-share-db.mjs";
import { buildShareUrl, createDefaultSettings, settingsFromUrl } from "../src/settings.js";
import { createShortShareUrl } from "../src/sharing.js";

const origin = "https://weather.example";
const comparison = { ...createDefaultSettings(new Date("2026-09-30T12:00:00Z")),
  locations: ["Fulda, Germany", "Ver-sur-Mer, France", "東京, Japan"],
  hiddenLocations: [false, true, false], highlightLocation: 2, preset: "custom",
  startDate: "2026-09-01", endDate: "2026-09-12", granularity: "3h", view: "table", tableGradient: true };
const query = new URL(buildShareUrl(comparison, origin)).search;
function createRequest(body = { query }, headers = {}) {
  return new Request(`${origin}/api/shares`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("short links persist, deduplicate, and restore all settings after reopening storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "weather-share-test-"));
  const filename = join(directory, "test.sqlite");
  let db = openLocalShareDatabase(resolve("."), filename);
  try {
    const fetcher = (url, options) => handleShareRequest(new Request(url, options), { DB: db });
    const short = await createShortShareUrl(comparison, `${origin}/?old=1`, fetcher);
    assert.match(short, /^https:\/\/weather\.example\/s\/[A-Za-z0-9_-]{12}$/);
    assert.equal(await createShortShareUrl(comparison, origin, fetcher), short);
    db.close();
    db = openLocalShareDatabase(resolve("."), filename);
    const response = await handleShareRequest(new Request(short), { DB: db });
    assert.equal(response.status, 302);
    const destination = new URL(response.headers.get("Location"), origin);
    assert.equal(destination.origin, origin);
    assert.deepEqual(settingsFromUrl(destination), comparison);
    const head = await handleShareRequest(new Request(short, { method: "HEAD" }), { DB: db });
    assert.equal(head.headers.get("Location"), response.headers.get("Location"));
    assert.equal(await head.text(), "");
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});

test("sharing rejects cross-site writes, redirects, oversized input and wrong methods", async () => {
  assert.equal((await handleShareRequest(createRequest({ query }, { Origin: "https://elsewhere.example" }), {})).status, 403);
  assert.equal((await handleShareRequest(createRequest({ query: "?url=https://elsewhere.example" }), {})).status, 400);
  assert.equal((await handleShareRequest(createRequest({ query: query + "&extra=" + "x".repeat(66000) }), {})).status, 400);
  assert.equal((await handleShareRequest(new Request(`${origin}/api/shares`), {})).status, 405);
  assert.equal((await handleShareRequest(new Request(`${origin}/s/invalid`), {})).status, 404);
  const db = openLocalShareDatabase(resolve("."), ":memory:");
  try {
    assert.equal((await handleShareRequest(new Request(`${origin}/s/abcdefghijkl`), { DB: db })).status, 404);
  } finally { db.close(); }
});

test("client reports failures instead of copying a long or external URL", async () => {
  await assert.rejects(createShortShareUrl(comparison, origin, async () => Response.json({}, { status: 503 })));
  await assert.rejects(createShortShareUrl(comparison, origin, async () => Response.json({ path: "https://elsewhere.example" })));
});
