import { aggregateLocationData } from "./aggregate.js";
import { ENDPOINTS, NATIONAL_TEMPERATURE_COUNTRIES } from "./config.js";

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

const FEATURE_IMPORTANCE = Object.freeze({
  PPLC: 170,
  PPLA: 110,
  PPLA2: 35,
  PPLA3: 55,
  PPLA4: 35,
  PPL: 22,
  PPLG: 18,
  PPLL: -35,
  PPLX: -20,
  AIRP: -15
});

function candidateScore(result, parsed) {
  const label = normalize(buildLocationLabel(result));
  const name = normalize(result.name);
  const primary = normalize(parsed.primary);
  const raw = normalize(parsed.raw);
  const featureCode = String(result.feature_code || "").toUpperCase();
  const country = normalize(result.country);
  const countryCode = normalize(result.country_code);
  const countryHint = normalize(parsed.parts.at(-1));
  const population = Number(result.population);

  let score = name === primary ? 220 : name.startsWith(primary) ? 180 : name.includes(primary) ? 145 : 0;
  if (label === raw) score += 150;
  else if (raw && label.startsWith(raw)) score += 90;
  else if (raw && label.includes(raw)) score += 70;
  parsed.parts.map(normalize).forEach((part, index) => {
    if (!part) return;
    const matchesCountry = index > 0 && (part === country || part === countryCode);
    if (matchesCountry) score += 125;
    else if (label.includes(part)) score += index ? 65 : 35;
  });
  if (parsed.parts.length > 1 && countryHint && (countryHint === country || countryHint === countryCode)) score += 55;
  score += FEATURE_IMPORTANCE[featureCode] || 0;
  score += Number.isFinite(population) && population > 0
    ? Math.min(155, Math.log10(population + 1) * 22)
    : -12;
  if (Number.isFinite(result.searchRank)) score += Math.max(0, 90 - result.searchRank * 9);
  return score;
}

export function rankLocationCandidates(results, query) {
  const parsed = queryParts(query);
  return [...results].sort((left, right) => {
    const scoreDifference = candidateScore(right, parsed) - candidateScore(left, parsed);
    if (scoreDifference) return scoreDifference;
    return buildLocationLabel(left).localeCompare(buildLocationLabel(right));
  });
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
  if (url.pathname.includes("air-quality")) return "air-quality data";
  if (url.hostname === "api.open-meteo.com") return "weather forecast";
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

  await Promise.all(variants.map(async (variant, variantIndex) => {
    const url = new URL(ENDPOINTS.geocode);
    url.searchParams.set("name", variant);
    url.searchParams.set("count", String(count));
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const payload = await fetchJson(url, signal);
    for (const [resultIndex, result] of (payload.results || []).entries()) {
      const key = [result.latitude, result.longitude, normalize(result.name), normalize(result.admin1), normalize(result.country)].join("|");
      const searchRank = resultIndex + variantIndex * 2;
      const existing = candidateMap.get(key);
      if (!existing || searchRank < existing.searchRank) candidateMap.set(key, { ...result, searchRank });
    }
  }));

  return rankLocationCandidates(candidateMap.values(), parsed.raw);
}

const placeKind = (featureCode) => {
  const code = String(featureCode || "").toUpperCase();
  if (code === "PPLC") return "Capital";
  if (code.startsWith("PPLA")) return "Administrative centre";
  if (code === "AIRP") return "Airport";
  return "Place";
};

const compactPopulation = (value) => {
  const population = Number(value);
  if (!Number.isFinite(population) || population <= 0) return null;
  if (population >= 1000000) return `${(population / 1000000).toFixed(population >= 10000000 ? 0 : 1)}M people`;
  if (population >= 1000) return `${Math.round(population / 1000)}k people`;
  return `${population} people`;
};

export function buildLocationSuggestion(result) {
  const contextParts = [result.admin1 || result.admin2, result.country]
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => normalize(candidate) === normalize(value)) === index);
  return {
    value: buildLocationLabel(result),
    name: result.name,
    context: contextParts.join(", "),
    meta: [placeKind(result.feature_code), compactPopulation(result.population)].filter(Boolean).join(" · "),
    countryCode: String(result.country_code || "").toUpperCase()
  };
}

export async function suggestLocationOptions(query, signal) {
  if (String(query).trim().length < 2) return [];
  const candidates = await geocodeCandidates(query, 12, signal);
  const unique = new Map();
  for (const candidate of candidates) {
    const suggestion = buildLocationSuggestion(candidate);
    if (!unique.has(suggestion.value)) unique.set(suggestion.value, suggestion);
  }
  return [...unique.values()].slice(0, 7);
}

export async function suggestLocations(query, signal) {
  return (await suggestLocationOptions(query, signal)).map((suggestion) => suggestion.value);
}

export async function geocodeLocation(query, signal) {
  const match = (await geocodeCandidates(query, 12, signal))[0];
  if (!match) throw new Error("location not found");
  return {
    query,
    label: buildLocationLabel(match),
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone || "auto",
    countryCode: String(match.country_code || "").toUpperCase()
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

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftLocalDate = (dateString, offsetDays) => {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return formatLocalDate(date);
};

export function splitTimeline(settings, now = new Date()) {
  const today = formatLocalDate(now);
  const wantsForecast = settings.preset === "7d7f" || settings.endDate > today;
  if (!wantsForecast) {
    return [{ kind: "historical", startDate: settings.startDate, endDate: settings.endDate }];
  }

  const ranges = [];
  if (settings.startDate < today) {
    ranges.push({
      kind: "historical",
      startDate: settings.startDate,
      endDate: settings.endDate < today ? settings.endDate : shiftLocalDate(today, -1)
    });
  }
  if (settings.endDate >= today) {
    ranges.push({
      kind: "forecast",
      startDate: settings.startDate > today ? settings.startDate : today,
      endDate: settings.endDate,
      forecastStartDate: today
    });
  }
  return ranges;
}

function weatherUrl(resolved, range) {
  const url = new URL(range.kind === "forecast" ? ENDPOINTS.forecast : ENDPOINTS.weather);
  url.searchParams.set("latitude", resolved.latitude);
  url.searchParams.set("longitude", resolved.longitude);
  url.searchParams.set("start_date", range.startDate);
  url.searchParams.set("end_date", range.endDate);
  url.searchParams.set("timezone", resolved.timezone);
  const variables = [
    "temperature_2m", "precipitation", "snowfall", "sunshine_duration",
    "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"
  ];
  if (range.kind === "forecast") variables.push("precipitation_probability");
  url.searchParams.set("hourly", variables.join(","));
  return url;
}

function airUrl(resolved, range) {
  const url = new URL(ENDPOINTS.air);
  url.searchParams.set("latitude", resolved.latitude);
  url.searchParams.set("longitude", resolved.longitude);
  url.searchParams.set("start_date", range.startDate);
  url.searchParams.set("end_date", range.endDate);
  url.searchParams.set("timezone", resolved.timezone);
  url.searchParams.set("hourly", [
    "european_aqi", "pm2_5", "pm10", "nitrogen_dioxide", "ozone", "sulphur_dioxide", "uv_index"
  ].join(","));
  return url;
}

function temperatureRangeUrl(resolved, range, granularity) {
  const base = globalThis.location?.origin || "http://127.0.0.1";
  const url = new URL(ENDPOINTS.temperatureRange, base);
  url.searchParams.set("latitude", resolved.latitude);
  url.searchParams.set("longitude", resolved.longitude);
  url.searchParams.set("countryCode", resolved.countryCode);
  url.searchParams.set("timezone", resolved.timezone);
  url.searchParams.set("startDate", range.startDate);
  url.searchParams.set("endDate", range.endDate);
  url.searchParams.set("granularity", granularity);
  return url;
}

export function localTemperatureApiFallbackUrls(primaryUrl, origin = globalThis.location?.origin) {
  if (!origin) return [];
  const localOrigin = new URL(origin);
  if (!/^(localhost|127\.0\.0\.1)$/.test(localOrigin.hostname)) return [];
  return [4173, 4174, 4175, 4176, 4177]
    .filter((port) => String(port) !== localOrigin.port)
    .map((port) => {
      const alternate = new URL(primaryUrl.pathname + primaryUrl.search, `${localOrigin.protocol}//${localOrigin.hostname}:${port}`);
      return alternate;
    });
}

async function fetchTemperatureRange(url, signal) {
  try {
    return await fetchJson(url, signal);
  } catch (primaryError) {
    if (primaryError?.name === "AbortError") throw primaryError;
    for (const alternateUrl of localTemperatureApiFallbackUrls(url)) {
      try {
        return await fetchJson(alternateUrl, signal);
      } catch (alternateError) {
        if (alternateError?.name === "AbortError") throw alternateError;
      }
    }
    throw primaryError;
  }
}

export async function fetchLocationData(query, settings, signal) {
  const resolved = await geocodeLocation(query, signal);
  const ranges = splitTimeline(settings);
  const segments = await Promise.all(ranges.map(async (range) => {
    const useNationalTemperature = range.kind === "historical" && NATIONAL_TEMPERATURE_COUNTRIES.includes(resolved.countryCode);
    const [weatherResult, airResult, temperatureResult] = await Promise.allSettled([
      fetchJson(weatherUrl(resolved, range), signal),
      fetchJson(airUrl(resolved, range), signal),
      useNationalTemperature
        ? fetchTemperatureRange(temperatureRangeUrl(resolved, range, settings.granularity), signal)
        : Promise.resolve({ source: null, observations: [], notices: [] })
    ]);
    if (weatherResult.status === "rejected") throw weatherResult.reason;
    const weather = weatherResult.value;
    const air = airResult.status === "fulfilled" ? airResult.value : { hourly: {} };
    const temperatureRange = temperatureResult.status === "fulfilled"
      ? temperatureResult.value
      : { source: null, observations: [], notices: ["National temperature observations unavailable; using Open-Meteo fallback"] };
    const [weatherSource, airSource] = await Promise.all([
      reverseGeocodeSource(weather.latitude, weather.longitude, signal),
      airResult.status === "fulfilled"
        ? reverseGeocodeSource(air.latitude, air.longitude, signal)
        : Promise.resolve(null)
    ]);
    const data = aggregateLocationData(
      resolved,
      weather,
      air,
      settings.granularity,
      { weather: weatherSource, air: airSource },
      range,
      temperatureRange
    );
    const temperatureRows = data.rows.filter((row) => Number.isFinite(row.temperatureAvg));
    const stationRows = temperatureRows.filter((row) => row.temperatureSourceKind === "national-station");
    const coverageNotice = temperatureRange.source && stationRows.length < temperatureRows.length
      ? `${temperatureRange.source.name} supplied station ranges for ${stationRows.length} of ${temperatureRows.length} temperature buckets; the remainder use Open-Meteo`
      : null;
    return {
      data,
      notices: [
        ...(airResult.status === "rejected" ? [`${range.kind} air-quality data unavailable`] : []),
        ...(temperatureRange.notices || []),
        ...[coverageNotice].filter(Boolean)
      ]
    };
  }));

  const rows = segments.flatMap((segment) => segment.data.rows).sort((left, right) => left.key.localeCompare(right.key));
  const primary = segments[0]?.data || resolved;
  return {
    ...primary,
    rows,
    hasForecast: rows.some((row) => row.dataKind === "forecast"),
    weatherSource: segments.map((segment) => segment.data.weatherSource).find(Boolean) || null,
    airSource: segments.map((segment) => segment.data.airSource).find(Boolean) || null,
    temperatureSource: segments.map((segment) => segment.data.temperatureSource).find(Boolean) || null,
    dataNotices: [...new Set(segments.flatMap((segment) => segment.notices))]
  };
}
