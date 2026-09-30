import { buildShareUrl, isDateString, settingsFromUrl } from "../src/settings.js";

const SHARE_TOKEN = /^[A-Za-z0-9_-]{12}$/;
const SHARE_BODY_LIMIT = 65536;

function shareDatabase(env) {
  if (!env?.DB?.prepare) throw new Error("Share database is unavailable");
  return env.DB;
}

function shareJson(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function readShareBody(request) {
  if (!request.body) throw new Error("Missing comparison settings");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > SHARE_BODY_LIMIT) {
      await reader.cancel();
      throw new Error("Comparison settings are too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function canonicalShareQuery(body) {
  if (!body || typeof body.query !== "string" || !body.query.startsWith("?") || body.query.length > 60000) {
    throw new Error("Invalid comparison settings");
  }
  // Only known comparison parameters are stored; callers cannot choose a redirect target.
  const url = new URL("https://comparison.invalid/");
  url.search = body.query;
  const params = url.searchParams;
  const allowed = new Set(["location", "hidden", "highlight", "preset", "start", "end", "granularity", "view", "gradient", "temperatureView"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || (!["location", "hidden"].includes(key) && params.getAll(key).length !== 1)) {
      throw new Error("Invalid comparison settings");
    }
  }
  const locations = params.getAll("location");
  if (!locations.length || locations.length > 20 || locations.some((value) => !value.trim() || value.length > 300)) {
    throw new Error("Use 1–20 location names, each under 300 characters");
  }
  if (!isDateString(params.get("start")) || !isDateString(params.get("end")) || params.get("start") > params.get("end")) {
    throw new Error("Invalid comparison dates");
  }
  return new URL(buildShareUrl(settingsFromUrl(url), url)).search;
}

export async function handleShareRequest(request, env) {
  const url = new URL(request.url);
  const creating = url.pathname === "/api/shares";
  if (creating && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (!creating && !["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  let query;
  let token;
  if (creating) {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
      return shareJson({ error: "Create share links from Weather Compare." }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return shareJson({ error: "Expected comparison settings as JSON." }, 415);
    }
    try { query = canonicalShareQuery(await readShareBody(request)); }
    catch { return shareJson({ error: "The comparison settings are invalid or too large." }, 400); }
  } else {
    token = url.pathname.slice(3);
    if (!SHARE_TOKEN.test(token)) return missingShare(request);
  }
  try {
    const db = shareDatabase(env);
    if (creating) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(query));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const bytes = crypto.getRandomValues(new Uint8Array(9));
      token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
      await db.prepare("INSERT INTO shared_comparisons (token, settings_hash, query, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(settings_hash) DO NOTHING")
        .bind(token, hash, query, Date.now()).run();
      const saved = await db.prepare("SELECT token FROM shared_comparisons WHERE settings_hash = ?").bind(hash).first();
      if (!saved) throw new Error("Share was not saved");
      return shareJson({ path: `/s/${saved.token}` }, 201);
    }
    const saved = await db.prepare("SELECT query FROM shared_comparisons WHERE token = ?").bind(token).first();
    if (!saved) return missingShare(request);
    return new Response(null, { status: 302, headers: { Location: `/${saved.query}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    console.error("Short-link storage failed", error);
    return shareJson({ error: "Short links are temporarily unavailable. Please try again." }, 503);
  }
}

function missingShare(request) {
  return new Response(request.method === "HEAD" ? null : '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link not found · Weather Compare</title><body style="font:1rem Segoe UI,sans-serif;max-width:40rem;margin:10vh auto;padding:1.5rem"><h1>This comparison link was not found</h1><p>Check that you copied the complete link.</p><a href="/">Open Weather Compare</a></body></html>', {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
