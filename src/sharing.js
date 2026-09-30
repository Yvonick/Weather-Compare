import { buildShareUrl } from "./settings.js";

export async function createShortShareUrl(settings, baseUrl, fetcher = fetch) {
  const comparisonUrl = new URL(buildShareUrl(settings, baseUrl));
  const response = await fetcher(new URL("/api/shares", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: comparisonUrl.search }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Short-link creation failed");
  const result = await response.json();
  if (!/^\/s\/[A-Za-z0-9_-]{12}$/.test(result.path)) throw new Error("Invalid short link");
  return new URL(result.path, baseUrl).href;
}
