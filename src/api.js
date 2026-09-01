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
  PPLC: 40,
  PPLA: 30,
  PPLA2: 22,
  PPLA3: 18,
  PPLA4: 12,
  PPL: 16,
  PPLG: 12,
  PPLL: -25,
  PPLX: -15,
  AIRP: -10
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

  let score = name === primary ? 400 : name.startsWith(primary) ? 260 : name.includes(primary) ? 170 : 0;
  if (label === raw) score += 60;
  else if (raw && label.startsWith(raw)) score += 40;
  else if (raw && label.includes(raw)) score += 25;
  parsed.parts.map(normalize).forEach((part, index) => {
    if (!part) return;
    const matchesCountry = index > 0 && (part === country || part === countryCode);
    if (matchesCountry) score += 125;
    else if (label.includes(part)) score += index ? 65 : 35;
  });
  if (parsed.parts.length > 1 && countryHint && (countryHint === country || countryHint === countryCode)) score += 55;
  score += FEATURE_IMPORTANCE[featureCode] || 0;
  score += Number.isFinite(population) && population > 0
    ? Math.min(240, Math.log10(population + 1) * 32)
    : -12;
  if (Number.isFinite(result.searchRank)) score += Math.max(0, 24 - result.searchRank * 2);
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

export function buildLocationSuggestion(result) {
  const contextParts = [result.admin1 || result.admin2, result.country]
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => normalize(candidate) === normalize(value)) === index);
  return {
    value: buildLocationLabel(result),
    name: result.name,
    context: contextParts.join(", "),
    meta: placeKind(result.feature_code),
    countryCode: String(result.country_code || "").toUpperCase()
  };
}

export async function suggestLocationOptions(query, signal) {
  if (String(query).trim().length < 2) return [];
  const candidates = await geocodeCandidates(query, 30, signal);
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

const sourceGridLabel = (latitude, longitude) => (
  Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${Number(latitude).toFixed(3)}, ${Number(longitude).toFixed(3)}`
    : null
);

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
  if (settings.endDate < today) {
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
    const forecastRange = {
      kind: "forecast",
      startDate: settings.startDate > today ? settings.startDate : today,
      endDate: settings.endDate,
      forecastStartDate: today
    };
    // A past-only preset includes the elapsed part of today, but never the
    // future remainder of the day. Today's values come from the forecast API
    // until the historical archive has caught up, so keep their provenance
    // explicit and clip the response to the actual current time.
    if (settings.preset !== "7d7f" && settings.endDate === today) {
      forecastRange.clipAfter = now.toISOString();
    }
    ranges.push(forecastRange);
  }
  return ranges;
}

export function clipHourlyPayloadToInstant(payload, instant) {
  const times = payload?.hourly?.time;
  const instantMs = Date.parse(instant);
  if (!Array.isArray(times) || !Number.isFinite(instantMs)) return payload;

  const utcOffsetSeconds = Number(payload.utc_offset_seconds) || 0;
  const localCutoff = new Date(instantMs + utcOffsetSeconds * 1000).toISOString().slice(0, 16);
  const keptIndexes = times.flatMap((time, index) => String(time).slice(0, 16) <= localCutoff ? [index] : []);
  const hourly = Object.fromEntries(Object.entries(payload.hourly).map(([key, values]) => [
    key,
    Array.isArray(values) && values.length === times.length
      ? keptIndexes.map((index) => values[index])
      : values
  ]));
  return { ...payload, hourly };
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
    const weather = range.clipAfter
      ? clipHourlyPayloadToInstant(weatherResult.value, range.clipAfter)
      : weatherResult.value;
    const rawAir = airResult.status === "fulfilled" ? airResult.value : { hourly: {} };
    const air = range.clipAfter ? clipHourlyPayloadToInstant(rawAir, range.clipAfter) : rawAir;
    const temperatureRange = temperatureResult.status === "fulfilled"
      ? temperatureResult.value
      : { source: null, observations: [], notices: ["National temperature observations unavailable; using Open-Meteo fallback"] };
    // Open-Meteo already reports the exact grid coordinates it used. Showing
    // those coordinates avoids two extra reverse-geocoding calls per segment.
    const weatherSource = sourceGridLabel(weather.latitude, weather.longitude);
    const airSource = airResult.status === "fulfilled"
      ? sourceGridLabel(air.latitude, air.longitude)
      : null;
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
      ? `${temperatureRange.source.name} supplied station ranges for ${stationRows.length} of ${temperatureRows.length} temperature buckets; the remainder use Open-Meteo. Recent and in-progress hours can be delayed or incomplete at the station source`
      : null;
    return {
      data,
      notices: [
        ...(airResult.status === "rejected" ? [`${range.kind} air-quality data unavailable`] : []),
        ...(range.clipAfter ? ["Today's elapsed hours use the Open-Meteo forecast feed and are labelled as forecast; future hours are excluded"] : []),
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
