import { aggregateLocationData } from "./aggregate.js";
import { ENDPOINTS } from "./config.js";

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

function queryParts(query) {
  const parts = String(query).split(",").map((part) => part.trim()).filter(Boolean);
  return { raw: String(query).trim(), primary: parts[0] || String(query).trim(), parts };
}

export function buildLocationLabel(result) {
  const parts = [result.name];
  if (result.admin2 && normalize(result.admin2) !== normalize(result.name)) parts.push(result.admin2);
  if (result.admin1 && normalize(result.admin1) !== normalize(result.name)) parts.push(result.admin1);
  if (result.country && normalize(result.country) !== normalize(result.admin1)) parts.push(result.country);
  return parts.filter(Boolean).join(", ");
}

function candidateScore(result, parsed) {
  const label = normalize(buildLocationLabel(result));
  const name = normalize(result.name);
  const primary = normalize(parsed.primary);
  const raw = normalize(parsed.raw);
  let score = name === primary ? 120 : name.includes(primary) ? 75 : 0;
  if (label === raw) score += 240;
  else if (raw && label.includes(raw)) score += 140;
  parsed.parts.map(normalize).forEach((part, index) => {
    if (part && label.includes(part)) score += index ? 44 : 28;
  });
  if (Number.isFinite(result.population)) score += Math.min(18, Math.log10(result.population + 1) * 3);
  return score;
}

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  const onDone = () => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  };
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException("Request aborted", "AbortError"));
  };
  const timer = setTimeout(onDone, milliseconds);
  if (!signal) return;
  signal.addEventListener("abort", onAbort, { once: true });
});

function requestLabel(url) {
  if (url.hostname.includes("geocoding") || url.pathname.includes("geocoding")) return "geocoding";
  if (url.pathname.includes("air-quality")) return "air-quality archive";
  if (url.pathname.includes("archive")) return "weather archive";
  return "data request";
}

async function fetchJson(url, signal) {
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, { signal });
    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts - 1) {
      throw new Error(`${requestLabel(url)} failed with ${response.status}`);
    }
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const fallbackDelay = attempt === 0 ? 450 : 1100;
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(2500, retryAfterSeconds * 1000)
      : fallbackDelay;
    await wait(delay, signal);
  }
  throw new Error(`${requestLabel(url)} failed`);
}

async function geocodeCandidates(query, count = 12, signal) {
  const parsed = queryParts(query);
  if (!parsed.raw) return [];
  const variants = [...new Set([
    parsed.raw,
    parsed.primary,
    parsed.parts.slice(0, 2).join(", "),
    parsed.parts.length > 1 ? `${parsed.primary}, ${parsed.parts.at(-1)}` : ""
  ].filter(Boolean))];
  const candidateMap = new Map();

  await Promise.all(variants.map(async (variant) => {
    const url = new URL(ENDPOINTS.geocode);
    url.searchParams.set("name", variant);
    url.searchParams.set("count", String(count));
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const payload = await fetchJson(url, signal);
    for (const result of payload.results || []) {
      const key = [result.latitude, result.longitude, normalize(result.name), normalize(result.admin1), normalize(result.country)].join("|");
      if (!candidateMap.has(key)) candidateMap.set(key, result);
    }
  }));

  return [...candidateMap.values()].sort((left, right) => candidateScore(right, parsed) - candidateScore(left, parsed));
}

export async function suggestLocations(query, signal) {
  if (String(query).trim().length < 2) return [];
  const candidates = await geocodeCandidates(query, 8, signal);
  return [...new Set(candidates.map(buildLocationLabel))].slice(0, 6);
}

export async function geocodeLocation(query, signal) {
  const match = (await geocodeCandidates(query, 12, signal))[0];
  if (!match) throw new Error("location not found");
  return {
    query,
    label: buildLocationLabel(match),
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone || "auto"
  };
}

const radians = (degrees) => degrees * Math.PI / 180;
function distanceKm(left, right) {
  const earthRadius = 6371;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function sourceCandidateScore(candidate, point) {
  const distance = distanceKm(candidate, point);
  const feature = normalize([candidate.feature_code, candidate.feature_class].filter(Boolean).join(" "));
  const name = normalize(candidate.name);
  const stationBonus = /(airport|aerodrome|station|observatory)/.test(`${feature} ${name}`) ? 18 : 0;
  return stationBonus - Math.min(distance, 100) * 0.45 + (Number.isFinite(candidate.population) ? Math.min(4, Math.log10(candidate.population + 1)) : 0);
}

async function reverseGeocodeSource(latitude, longitude, signal) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  try {
    const url = new URL(ENDPOINTS.reverseGeocode);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("count", "24");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const results = (await fetchJson(url, signal)).results || [];
    const point = { latitude, longitude };
    const best = results
      .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .sort((left, right) => sourceCandidateScore(right, point) - sourceCandidateScore(left, point))[0];
    return best ? buildLocationLabel(best) : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  } catch {
    return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
  }
}

function weatherUrl(resolved, settings) {
  const url = new URL(ENDPOINTS.weather);
  url.searchParams.set("latitude", resolved.latitude);
  url.searchParams.set("longitude", resolved.longitude);
  url.searchParams.set("start_date", settings.startDate);
  url.searchParams.set("end_date", settings.endDate);
  url.searchParams.set("timezone", resolved.timezone);
  url.searchParams.set("hourly", [
    "temperature_2m", "precipitation", "snowfall", "sunshine_duration",
    "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"
  ].join(","));
  return url;
}

function airUrl(resolved, settings) {
  const url = new URL(ENDPOINTS.air);
  url.searchParams.set("latitude", resolved.latitude);
  url.searchParams.set("longitude", resolved.longitude);
  url.searchParams.set("start_date", settings.startDate);
  url.searchParams.set("end_date", settings.endDate);
  url.searchParams.set("timezone", resolved.timezone);
  url.searchParams.set("hourly", [
    "european_aqi", "pm2_5", "pm10", "nitrogen_dioxide", "ozone", "sulphur_dioxide", "uv_index"
  ].join(","));
  return url;
}

export async function fetchLocationData(query, settings, signal) {
  const resolved = await geocodeLocation(query, signal);
  const [weather, air] = await Promise.all([
    fetchJson(weatherUrl(resolved, settings), signal),
    fetchJson(airUrl(resolved, settings), signal)
  ]);
  const [weatherSource, airSource] = await Promise.all([
    reverseGeocodeSource(weather.latitude, weather.longitude, signal),
    reverseGeocodeSource(air.latitude, air.longitude, signal)
  ]);
  return aggregateLocationData(resolved, weather, air, settings.granularity, { weather: weatherSource, air: airSource });
}
