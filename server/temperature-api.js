import { UK_STATIONS } from "./uk-stations.js";

const MAX_RANGE_DAYS = 31;
const MAX_STATION_DISTANCE_KM = 75;
const UK_BUCKET = "https://met-office-land-observations-data.s3.eu-west-2.amazonaws.com/";
const cache = new Map();

const PROVIDER_INFO = Object.freeze({
  GB: { id: "met-office", name: "Met Office", cadenceMinutes: 1, rangeMethod: "1-minute observations", docsUrl: "https://registry.opendata.aws/met-office-uk-land-observations/" },
  DK: { id: "dmi", name: "DMI", cadenceMinutes: 10, rangeMethod: "hourly extrema / 10-minute observations", docsUrl: "https://opendatadocs.dmi.govcloud.dk/en/" },
  NO: { id: "frost", name: "MET Norway Frost", cadenceMinutes: 60, rangeMethod: "official hourly extrema", docsUrl: "https://frost.met.no/" },
  DE: { id: "dwd", name: "DWD Climate Data Center", cadenceMinutes: 10, rangeMethod: "official 10-minute extrema", docsUrl: "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/" },
  FR: { id: "meteo-france", name: "Météo-France", cadenceMinutes: 60, rangeMethod: "official hourly extrema", docsUrl: "https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/pages/854196251/API+Cibl+e+Clim+EN" },
  CH: { id: "meteoswiss", name: "MeteoSwiss", cadenceMinutes: 10, rangeMethod: "10-minute observations", docsUrl: "https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations" },
  NL: { id: "knmi", name: "KNMI", cadenceMinutes: 10, rangeMethod: "10-minute observations", docsUrl: "https://developer.dataplatform.knmi.nl/edr-api" },
  AT: { id: "geosphere", name: "GeoSphere Austria", cadenceMinutes: 10, rangeMethod: "official 10-minute extrema", docsUrl: "https://data.hub.geosphere.at/showcase/api-grundlagen-/" },
  FI: { id: "fmi", name: "Finnish Meteorological Institute", cadenceMinutes: 10, rangeMethod: "10-minute observations", docsUrl: "https://en.ilmatieteenlaitos.fi/open-data-manual-wfs-examples-and-guidelines" }
});

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff"
  }
});

const finite = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > -900 ? number : null;
};

const radians = (degrees) => degrees * Math.PI / 180;
const distanceKm = (left, right) => {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

function nearestStation(stations, point) {
  const station = stations
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .map((item) => ({ ...item, distanceKm: distanceKm(item, point) }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0];
  return station && station.distanceKm <= MAX_STATION_DISTANCE_KM ? station : null;
}

function nearestStations(stations, point, limit = 12) {
  return stations
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .map((item) => ({ ...item, distanceKm: distanceKm(item, point) }))
    .filter((item) => item.distanceKm <= MAX_STATION_DISTANCE_KM)
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, limit);
}

function providerSource(countryCode, station, overrides = {}) {
  return {
    ...PROVIDER_INFO[countryCode],
    stationName: station?.name || null,
    stationDistanceKm: Number.isFinite(station?.distanceKm) ? Math.round(station.distanceKm * 10) / 10 : null,
    ...overrides
  };
}

const cached = async (key, loader, milliseconds = 3600000) => {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const value = await loader();
  cache.set(key, { value, expires: Date.now() + milliseconds });
  return value;
};

async function checkedFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const target = new URL(url);
    const detail = await response.clone().text().catch(() => "");
    const suffix = detail.trim() ? `: ${detail.trim().slice(0, 180)}` : "";
    throw new Error(`${target.hostname}${target.pathname} returned ${response.status}${suffix}`);
  }
  return response;
}

const asJson = async (url, options) => checkedFetch(url, options).then((response) => response.json());
const asText = async (url, options) => checkedFetch(url, options).then((response) => response.text());

function localIso(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

const inLocalRange = (time, request) => time && time.slice(0, 10) >= request.startDate && time.slice(0, 10) <= request.endDate;
const utcWindow = (request) => ({
  start: new Date(Date.parse(`${request.startDate}T00:00:00Z`) - 14 * 3600000),
  end: new Date(Date.parse(`${request.endDate}T23:59:59Z`) + 14 * 3600000)
});
const isoSeconds = (value) => value.toISOString().replace(".000Z", "Z");
const HOUR_MS = 60 * 60 * 1000;
const floorHour = (value) => new Date(Math.floor(value.getTime() / HOUR_MS) * HOUR_MS);
const ceilHour = (value) => new Date(Math.ceil(value.getTime() / HOUR_MS) * HOUR_MS);

function sampledObservation(instant, value, request) {
  const avg = finite(value);
  if (avg === null) return null;
  const time = localIso(instant, request.timezone);
  return inLocalRange(time, request) ? { time, avg, min: null, max: null, sampleCount: 1, explicitRange: false } : null;
}

function rangedObservation(instant, avgValue, minValue, maxValue, request, intervalEnd = true) {
  const adjusted = intervalEnd ? new Date(new Date(instant).getTime() - 1) : instant;
  const time = localIso(adjusted, request.timezone);
  const min = finite(minValue);
  const max = finite(maxValue);
  const avg = finite(avgValue) ?? (min !== null && max !== null ? (min + max) / 2 : null);
  if (!inLocalRange(time, request) || (avg === null && min === null && max === null)) return null;
  return { time, avg, min, max, sampleCount: 1, explicitRange: min !== null && max !== null };
}

function parseDelimited(text, delimiter = ";") {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(delimiter).map((value) => value.trim());
  return lines.slice(1).map((line) => Object.fromEntries(line.split(delimiter).map((value, index) => [headers[index], value.trim()])));
}

function column(row, candidates) {
  const entries = Object.entries(row);
  const normalized = candidates.map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return entries.find(([key]) => normalized.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")))?.[1];
}

function basicAuth(username) {
  const value = `${username}:`;
  if (typeof btoa === "function") return `Basic ${btoa(value)}`;
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

async function ukPrefixes() {
  return cached("uk-prefixes", async () => {
    const xml = await asText(`${UK_BUCKET}?list-type=2&delimiter=/`);
    const byHour = new Map();
    for (const match of xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)) {
      const prefix = match[1].replaceAll("&amp;", "&");
      const parsed = prefix.match(/^(\d{12})_(\d{10})00_(\d{10})59\/$/);
      if (!parsed) continue;
      const current = byHour.get(parsed[2]);
      if (!current || parsed[1] > current.slice(0, 12)) byHour.set(parsed[2], prefix);
    }
    return byHour;
  }, 300000);
}

const ukStationSlug = (station) => station.filename.replace(/_[a-f0-9-]{36}\.csv$/i, "");

async function ukKeys(prefix) {
  return cached(`uk-keys:${prefix}`, async () => {
    const xml = await asText(`${UK_BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix)}`);
    const keys = new Map();
    for (const match of xml.matchAll(/<Key>([^<]+\.csv)<\/Key>/g)) {
      const key = match[1].replaceAll("&amp;", "&");
      const filename = key.slice(prefix.length);
      keys.set(filename.replace(/_[a-f0-9-]{36}\.csv$/i, ""), key);
    }
    return keys;
  }, 3600000);
}

async function provideUk(request) {
  const prefixes = await ukPrefixes();
  const { start, end } = utcWindow(request);
  const startKey = start.toISOString().slice(0, 10).replaceAll("-", "");
  const endKey = end.toISOString().slice(0, 10).replaceAll("-", "");
  const relevant = [...prefixes.entries()].filter(([hour]) => hour.slice(0, 8) >= startKey && hour.slice(0, 8) <= endKey);
  const representativePrefix = relevant[Math.floor(relevant.length / 2)]?.[1];
  const representativeKeys = representativePrefix ? await ukKeys(representativePrefix) : new Map();
  let station = null;
  for (const candidate of nearestStations(UK_STATIONS, request)) {
    const key = representativeKeys.get(ukStationSlug(candidate));
    if (!key) continue;
    try {
      const rows = parseDelimited(await asText(`${UK_BUCKET}${key}`), "|");
      const hasGoodTemperature = rows.some((row) => {
        const qc = row.air_temperature_near_surface_1_minute_mean_qc || "";
        return finite(row.air_temperature_near_surface_1_minute_mean) !== null && (!qc || qc.includes("good"));
      });
      if (hasGoodTemperature) { station = candidate; break; }
    } catch { /* Try the next-nearest station. */ }
  }
  if (!station) return {
    observations: [],
    notice: relevant.length
      ? "No reporting Met Office station was found within 75 km for this period"
      : "Met Office one-minute data is only available in its rolling 7-day public feed"
  };
  const texts = [];
  for (let index = 0; index < relevant.length; index += 12) {
    const batch = await Promise.all(relevant.slice(index, index + 12).map(async ([, prefix]) => {
      try {
        const key = (await ukKeys(prefix)).get(ukStationSlug(station));
        return key ? await asText(`${UK_BUCKET}${key}`) : "";
      } catch { return ""; }
    }));
    texts.push(...batch);
  }
  const observations = [];
  for (const text of texts) {
    if (!text) continue;
    const rows = parseDelimited(text, "|");
    for (const row of rows) {
      const qc = row.air_temperature_near_surface_1_minute_mean_qc || "";
      if (qc && !qc.includes("good")) continue;
      const observation = sampledObservation(row.timestep, row.air_temperature_near_surface_1_minute_mean, request);
      if (observation) observations.push(observation);
    }
  }
  return {
    source: providerSource("GB", station),
    observations,
    notice: observations.length ? null : "Met Office one-minute data is only available in its rolling 7-day public feed"
  };
}

async function dmiStations() {
  return cached("dmi-stations", async () => {
    const payload = await asJson("https://opendataapi.dmi.dk/v2/metObs/collections/station/items?status=Active&limit=10000");
    const latest = new Map();
    for (const feature of payload.features || []) {
      const properties = feature.properties || {};
      if (properties.country !== "DNK" || !feature.geometry?.coordinates) continue;
      const item = {
        id: properties.stationId,
        name: properties.name || properties.stationId,
        longitude: Number(feature.geometry.coordinates[0]),
        latitude: Number(feature.geometry.coordinates[1]),
        parameters: properties.parameterId || [],
        validFrom: properties.validFrom || ""
      };
      if (!latest.has(item.id) || item.validFrom > latest.get(item.id).validFrom) latest.set(item.id, item);
    }
    return [...latest.values()];
  });
}

async function dmiValues(stationId, parameterId, request) {
  const { start, end } = utcWindow(request);
  const url = new URL("https://opendataapi.dmi.dk/v2/metObs/collections/observation/items");
  url.searchParams.set("stationId", stationId);
  url.searchParams.set("parameterId", parameterId);
  url.searchParams.set("datetime", `${start.toISOString()}/${end.toISOString()}`);
  url.searchParams.set("limit", "10000");
  const payload = await asJson(url);
  return (payload.features || []).map((feature) => ({
    time: feature.properties?.observed,
    value: feature.properties?.value
  }));
}

async function provideDmi(request) {
  const requiredParameter = request.granularity === "30m" ? "temp_dry" : "temp_min_past1h";
  const station = nearestStation((await dmiStations()).filter((item) => item.parameters.includes(requiredParameter)), request);
  if (!station) return { observations: [], notice: "No DMI station was found within 75 km" };
  if (request.granularity === "30m") {
    const observations = (await dmiValues(station.id, "temp_dry", request))
      .map((item) => sampledObservation(item.time, item.value, request)).filter(Boolean);
    return { source: providerSource("DK", station, { rangeMethod: "10-minute observations" }), observations };
  }
  const [means, minima, maxima] = await Promise.all([
    dmiValues(station.id, "temp_mean_past1h", request),
    dmiValues(station.id, "temp_min_past1h", request),
    dmiValues(station.id, "temp_max_past1h", request)
  ]);
  const merged = new Map();
  for (const [kind, items] of [["avg", means], ["min", minima], ["max", maxima]]) {
    for (const item of items) merged.set(item.time, { ...(merged.get(item.time) || {}), time: item.time, [kind]: item.value });
  }
  return {
    source: providerSource("DK", station, { cadenceMinutes: 60, rangeMethod: "official hourly extrema" }),
    observations: [...merged.values()].map((item) => rangedObservation(item.time, item.avg, item.min, item.max, request)).filter(Boolean)
  };
}

async function provideFrost(request, env) {
  if (!env.FROST_CLIENT_ID) return { observations: [], notice: "MET Norway Frost needs a FROST_CLIENT_ID; using Open-Meteo fallback" };
  const headers = { Authorization: basicAuth(env.FROST_CLIENT_ID) };
  const sourceUrl = new URL("https://frost.met.no/sources/v0.jsonld");
  sourceUrl.searchParams.set("geometry", `nearest(POINT(${request.longitude} ${request.latitude}))`);
  sourceUrl.searchParams.set("nearestmaxcount", "1");
  sourceUrl.searchParams.set("types", "SensorSystem");
  const sourcePayload = await asJson(sourceUrl, { headers });
  const sourceItem = sourcePayload.data?.[0];
  if (!sourceItem) return { observations: [], notice: "No Frost station was found" };
  const coordinates = sourceItem.geometry?.coordinates || [];
  const station = {
    id: sourceItem.id,
    name: sourceItem.name || sourceItem.shortName || sourceItem.id,
    longitude: Number(coordinates[0]), latitude: Number(coordinates[1])
  };
  station.distanceKm = distanceKm(station, request);
  if (station.distanceKm > MAX_STATION_DISTANCE_KM) return { observations: [], notice: "No Frost station was found within 75 km" };
  const { start, end } = utcWindow(request);
  const url = new URL("https://frost.met.no/observations/v0.jsonld");
  url.searchParams.set("sources", station.id);
  url.searchParams.set("referencetime", `${start.toISOString()}/${end.toISOString()}`);
  url.searchParams.set("elements", "mean(air_temperature PT1H),min(air_temperature PT1H),max(air_temperature PT1H)");
  const payload = await asJson(url, { headers });
  const observations = (payload.data || []).map((item) => {
    const values = Object.fromEntries((item.observations || []).map((entry) => [entry.elementId.split("(")[0], entry.value]));
    return rangedObservation(item.referenceTime, values.mean, values.min, values.max, request);
  }).filter(Boolean);
  return { source: providerSource("NO", station), observations };
}

async function dwdStations() {
  return cached("dwd-stations", async () => {
    const text = await asText("https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/air_temperature/recent/zehn_min_tu_Beschreibung_Stationen.txt");
    const stations = [];
    for (const line of text.split(/\r?\n/).slice(2)) {
      const match = line.match(/^\s*(\d{5})\s+\d+\s+\d+\s+-?\d+\s+([\d.]+)\s+([\d.]+)\s+(.{1,40})/);
      if (!match) continue;
      stations.push({ id: match[1], latitude: Number(match[2]), longitude: Number(match[3]), name: match[4].trim() });
    }
    return stations;
  });
}

async function unzipFirst(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let central = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { central = view.getUint32(index + 16, true); break; }
  }
  if (central < 0 || view.getUint32(central, true) !== 0x02014b50) throw new Error("ZIP directory not found");
  const method = view.getUint16(central + 10, true);
  const compressedSize = view.getUint32(central + 20, true);
  const local = view.getUint32(central + 42, true);
  const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const compressed = bytes.slice(dataStart, dataStart + compressedSize);
  let output = compressed;
  if (method === 8) {
    output = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  } else if (method !== 0) throw new Error(`Unsupported ZIP compression method ${method}`);
  return new TextDecoder("iso-8859-1").decode(output);
}

async function provideDwd(request) {
  const station = nearestStation(await dwdStations(), request);
  if (!station) return { observations: [], notice: "No DWD station was found within 75 km" };
  const base = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes";
  const [airResponse, extremaResponse] = await Promise.all([
    checkedFetch(`${base}/air_temperature/recent/10minutenwerte_TU_${station.id}_akt.zip`),
    checkedFetch(`${base}/extreme_temperature/recent/10minutenwerte_extrema_temp_${station.id}_akt.zip`)
  ]);
  const [airText, extremaText] = await Promise.all([unzipFirst(airResponse), unzipFirst(extremaResponse)]);
  const values = new Map();
  for (const row of parseDelimited(airText)) {
    const time = row.MESS_DATUM;
    values.set(time, { ...(values.get(time) || {}), time, avg: row.TT_10 });
  }
  for (const row of parseDelimited(extremaText)) {
    const time = row.MESS_DATUM;
    values.set(time, { ...(values.get(time) || {}), time, min: row.TN_10, max: row.TX_10 });
  }
  const dwdDate = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:00Z`;
  return {
    source: providerSource("DE", station),
    observations: [...values.values()].map((item) => rangedObservation(dwdDate(item.time), item.avg, item.min, item.max, request)).filter(Boolean)
  };
}

async function franceAuth(env) {
  const applicationId = String(env.METEOFRANCE_APPLICATION_ID || "").trim();
  if (applicationId) {
    const accessToken = await cached("meteo-france-access-token", async () => {
      const credential = applicationId.replace(/^Basic\s+/i, "");
      const response = await checkedFetch("https://portail-api.meteofrance.fr/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credential}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      });
      const payload = await response.json();
      if (!payload.access_token) throw new Error("Météo-France did not return an OAuth2 access token");
      return payload.access_token;
    }, 3300000);
    return { parameter: "tokenOauth2", value: accessToken };
  }
  const apiKey = String(env.METEOFRANCE_API_KEY || "").trim().replace(/^Bearer\s+/i, "");
  return apiKey ? { parameter: "apikey", value: apiKey } : null;
}

function franceAuthenticatedUrl(value, auth) {
  const url = value instanceof URL ? value : new URL(value);
  url.searchParams.set(auth.parameter, auth.value);
  return url;
}

async function franceDepartment(request) {
  const key = `france-department-${request.latitude.toFixed(4)}-${request.longitude.toFixed(4)}`;
  return cached(key, async () => {
    const url = new URL("https://geo.api.gouv.fr/communes");
    url.searchParams.set("lat", String(request.latitude));
    url.searchParams.set("lon", String(request.longitude));
    url.searchParams.set("fields", "codeDepartement");
    url.searchParams.set("format", "json");
    const communes = await asJson(url);
    return communes[0]?.codeDepartement || null;
  });
}

async function franceStations(auth, department) {
  return cached(`france-climate-stations-${department}`, async () => {
    const url = new URL("https://public-api.meteofrance.fr/public/DPClim/v1/liste-stations/horaire");
    url.searchParams.set("id-departement", department);
    url.searchParams.set("parametre", "temperature");
    const stations = await asJson(franceAuthenticatedUrl(url, auth));
    return stations.map((row) => ({
      id: String(row.id ?? "").padStart(8, "0"),
      name: row.nom || "Météo-France station",
      latitude: finite(row.lat),
      longitude: finite(row.lon),
      startDate: String(row.dateDebut || "").slice(0, 10),
      endDate: String(row.dateFin || "").slice(0, 10),
      isOpen: row.posteOuvert !== false
    })).filter((station) => station.id);
  });
}

const franceStationCovers = (station, request) => (
  (!station.startDate || station.startDate <= request.endDate)
  && (!station.endDate || station.endDate >= request.startDate)
);

const franceSignal = () => (
  typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(10000)
    : undefined
);

function franceHourlyObservations(text, request) {
  return parseDelimited(text).map((row) => {
    const rawTime = column(row, ["AAAAMMJJHH", "AAAAMMJJHHMN", "date", "validite", "timestamp"]);
    const compact = String(rawTime || "").replace(/\.0$/, "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?$/);
    const time = compact
      ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5] || "00"}:${compact[6] || "00"}Z`
      : rawTime;
    const toCelsius = (value) => {
      const temperature = finite(value);
      return temperature !== null && temperature > 150 ? temperature - 273.15 : temperature;
    };
    return rangedObservation(
      time,
      toCelsius(column(row, ["t", "tm", "temperature", "tair"])),
      toCelsius(column(row, ["tn", "tmin", "temperature_minimale"])),
      toCelsius(column(row, ["tx", "tmax", "temperature_maximale"])),
      request
    );
  }).filter((observation) => observation?.explicitRange);
}

async function franceHourlyArchive(station, request, auth, startTime, endTime) {
  const orderId = await cached(`france-hourly-order-${station.id}-${startTime}-${endTime}`, async () => {
    const url = new URL("https://public-api.meteofrance.fr/public/DPClim/v1/commande-station/horaire");
    url.searchParams.set("id-station", station.id);
    url.searchParams.set("date-deb-periode", startTime);
    url.searchParams.set("date-fin-periode", endTime);
    const order = await checkedFetch(franceAuthenticatedUrl(url, auth), { signal: franceSignal() });
    const orderPayload = await order.json();
    const id = orderPayload.elaboreProduitAvecDemandeResponse?.return ?? orderPayload.return ?? orderPayload.id;
    if (!id) throw new Error("Météo-France did not return an order id");
    return id;
  }, 300000);
  let lastStatus = null;
  let lastDetail = "";
  let missingResponses = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const fileUrl = new URL("https://public-api.meteofrance.fr/public/DPClim/v1/commande/fichier");
    fileUrl.searchParams.set("id-cmde", orderId);
    const response = await fetch(franceAuthenticatedUrl(fileUrl, auth), { signal: franceSignal() });
    lastStatus = response.status;
    if (response.ok && response.status !== 204) {
      const text = await response.text();
      if (text.trim()) return { observations: franceHourlyObservations(text, request), status: response.status };
    } else if (!response.ok) {
      lastDetail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
    }
    if (response.status === 404 || response.status === 410) {
      missingResponses += 1;
      if (missingResponses >= 3) break;
    } else if (!response.ok && response.status !== 429) {
      break;
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { observations: [], status: lastStatus, detail: lastDetail };
}

async function provideFrance(request, env) {
  const auth = await franceAuth(env);
  if (!auth) return { observations: [], notice: "Météo-France needs a METEOFRANCE_APPLICATION_ID or METEOFRANCE_API_KEY; using Open-Meteo fallback" };
  if (request.granularity === "30m") return { observations: [], notice: "Météo-France historical temperature extrema are hourly; using Open-Meteo fallback for 30-minute buckets" };
  const department = await franceDepartment(request);
  if (!department) return { observations: [], notice: "No French administrative department was found for this location" };
  const stations = (await franceStations(auth, department)).filter((station) => franceStationCovers(station, request));
  const candidates = nearestStations(stations, request, 4).sort((left, right) => Number(right.isOpen) - Number(left.isOpen) || left.distanceKm - right.distanceKm);
  if (!candidates.length) return { observations: [], notice: "No Météo-France hourly temperature station covering this period was found within 75 km" };
  const { start, end } = utcWindow(request);
  const startTime = isoSeconds(floorHour(start));
  const endTime = isoSeconds(ceilHour(end));
  let lastIssue = "no hourly extrema were returned";
  for (const station of candidates) {
    try {
      const result = await franceHourlyArchive(station, request, auth, startTime, endTime);
      if (result.observations.length) {
        return { source: providerSource("FR", station), observations: result.observations };
      }
      lastIssue = `${station.name} returned ${result.status ?? "no response"}${result.detail ? `: ${result.detail}` : ""}`;
    } catch (error) {
      lastIssue = `${station.name}: ${error.message}`;
    }
  }
  return { observations: [], notice: `Météo-France had no usable hourly archive at nearby stations (${lastIssue}); using Open-Meteo fallback` };
}

async function swissStations() {
  return cached("swiss-stations", async () => {
    const payload = await asJson("https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn/items?limit=1000");
    return (payload.features || []).map((feature) => ({
      id: feature.id,
      name: feature.properties?.title || feature.id.toUpperCase(),
      longitude: Number(feature.geometry?.coordinates?.[0]), latitude: Number(feature.geometry?.coordinates?.[1]),
      assets: feature.assets || {}
    }));
  });
}

async function provideSwiss(request) {
  const station = nearestStation(await swissStations(), request);
  if (!station) return { observations: [], notice: "No MeteoSwiss station was found within 75 km" };
  const year = request.startDate.slice(0, 4);
  const currentYear = String(new Date().getUTCFullYear());
  const assets = Object.values(station.assets).filter((asset) => {
    const href = asset.href || "";
    return href.includes(`ogd-smn_${station.id}_t_`) && year === currentYear && href.includes("_recent.csv");
  });
  if (!assets.length) return { observations: [], notice: "MeteoSwiss sub-hourly station ranges are enabled for the current-year recent feed; using Open-Meteo for older dates" };
  const texts = await Promise.all(assets.map((asset) => asText(asset.href)));
  const seen = new Set();
  const observations = [];
  for (const text of texts) {
    for (const row of parseDelimited(text)) {
      const match = row.reference_timestamp?.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/);
      if (!match) continue;
      const instant = `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00Z`;
      if (seen.has(instant)) continue;
      seen.add(instant);
      const observation = sampledObservation(instant, row.tre200s0, request);
      if (observation) observations.push(observation);
    }
  }
  return { source: providerSource("CH", station), observations };
}

function parseCoverage(coverage, request) {
  const times = coverage?.domain?.axes?.t?.values || [];
  const range = coverage?.ranges?.ta || coverage?.ranges?.temperature || Object.values(coverage?.ranges || {})[0];
  const values = range?.values || [];
  return times.map((time, index) => {
    const raw = finite(values[index]);
    return sampledObservation(time, raw !== null && raw > 150 ? raw - 273.15 : raw, request);
  }).filter(Boolean);
}

async function provideKnmi(request, env) {
  const apiKey = env.KNMI_API_KEY;
  if (!apiKey) return { observations: [], notice: "KNMI needs a KNMI_API_KEY; using Open-Meteo fallback" };
  const headers = { Authorization: apiKey };
  const base = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations";
  const locations = await asJson(`${base}/locations`, { headers });
  const candidates = (locations.features || []).map((feature) => ({
    id: feature.id,
    name: feature.properties?.name || feature.properties?.title || feature.id,
    longitude: Number(feature.geometry?.coordinates?.[0]), latitude: Number(feature.geometry?.coordinates?.[1])
  }));
  const station = nearestStation(candidates, request);
  if (!station) return { observations: [], notice: "No KNMI station was found within 75 km" };
  const url = new URL(`${base}/locations/${encodeURIComponent(station.id)}`);
  const { start, end } = utcWindow(request);
  url.searchParams.set("datetime", `${start.toISOString()}/${end.toISOString()}`);
  url.searchParams.set("parameter-name", "ta");
  url.searchParams.set("f", "CoverageJSON");
  const payload = await asJson(url, { headers });
  const coverages = payload.type === "CoverageCollection" ? payload.coverages || [] : [payload];
  return { source: providerSource("NL", station), observations: coverages.flatMap((coverage) => parseCoverage(coverage, request)) };
}

async function austriaStations() {
  return cached("austria-stations", async () => parseDelimited(
    await asText("https://dataset.api.hub.geosphere.at/v1/station/historical/tawes-v1-10min/metadata/stations"), ","
  ).filter((row) => row.is_active === "True").map((row) => ({
    id: row.id, name: row.name, latitude: Number(row.lat), longitude: Number(row.lon)
  })));
}

async function provideAustria(request) {
  const station = nearestStation(await austriaStations(), request);
  if (!station) return { observations: [], notice: "No GeoSphere Austria station was found within 75 km" };
  const url = new URL("https://dataset.api.hub.geosphere.at/v1/station/historical/tawes-v1-10min");
  for (const parameter of ["TLAM", "TLMIN", "TLMAX"]) url.searchParams.append("parameters", parameter);
  url.searchParams.set("station_ids", station.id);
  const { start, end } = utcWindow(request);
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  url.searchParams.set("output_format", "geojson");
  const payload = await asJson(url);
  const parameters = payload.features?.[0]?.properties?.parameters || {};
  const observations = (payload.timestamps || []).map((time, index) => rangedObservation(
    time,
    parameters.TLAM?.data?.[index], parameters.TLMIN?.data?.[index], parameters.TLMAX?.data?.[index], request
  )).filter(Boolean);
  return { source: providerSource("AT", station), observations };
}

async function provideFinland(request) {
  const margin = 0.45;
  const { start, end } = utcWindow(request);
  const url = new URL("https://opendata.fmi.fi/wfs");
  Object.entries({
    service: "WFS", version: "2.0.0", request: "getFeature",
    storedquery_id: "fmi::observations::weather::simple",
    bbox: `${request.longitude - margin},${request.latitude - margin},${request.longitude + margin},${request.latitude + margin}`,
    starttime: start.toISOString(), endtime: end.toISOString(), parameters: "t2m", timestep: "10"
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const xml = await asText(url);
  const groups = new Map();
  for (const match of xml.matchAll(/<BsWfs:BsWfsElement[^>]*>([\s\S]*?)<\/BsWfs:BsWfsElement>/g)) {
    const block = match[1];
    const position = block.match(/<gml:pos>\s*([-\d.]+)\s+([-\d.]+)\s*<\/gml:pos>/);
    const time = block.match(/<BsWfs:Time>([^<]+)<\/BsWfs:Time>/)?.[1];
    const value = block.match(/<BsWfs:ParameterValue>([^<]+)<\/BsWfs:ParameterValue>/)?.[1];
    const name = block.match(/<BsWfs:Location>[^<]*<\/BsWfs:Location>/)?.[0]?.replace(/<[^>]+>/g, "") || "FMI station";
    if (!position || !time) continue;
    const key = `${position[1]},${position[2]}`;
    if (!groups.has(key)) groups.set(key, { name, latitude: Number(position[1]), longitude: Number(position[2]), values: [] });
    groups.get(key).values.push({ time, value });
  }
  const station = nearestStation([...groups.values()], request);
  if (!station) return { observations: [], notice: "No FMI station was found within 75 km" };
  return {
    source: providerSource("FI", station),
    observations: station.values.map((item) => sampledObservation(item.time, item.value, request)).filter(Boolean)
  };
}

const providers = Object.freeze({
  GB: provideUk, DK: provideDmi, NO: provideFrost, DE: provideDwd, FR: provideFrance,
  CH: provideSwiss, NL: provideKnmi, AT: provideAustria, FI: provideFinland
});

function parseRequest(url) {
  const countryCode = (url.searchParams.get("countryCode") || "").toUpperCase();
  const latitude = Number(url.searchParams.get("latitude"));
  const longitude = Number(url.searchParams.get("longitude"));
  const timezone = url.searchParams.get("timezone") || "UTC";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const granularity = url.searchParams.get("granularity") || "1h";
  if (!providers[countryCode]) return { error: "No national temperature provider is configured for this country" };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { error: "Invalid coordinates" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return { error: "Invalid date range" };
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) return { error: `National station ranges support 1-${MAX_RANGE_DAYS} days per request` };
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return { error: "Invalid timezone" }; }
  return { countryCode, latitude, longitude, timezone, startDate, endDate, granularity };
}

export async function handleTemperatureRequest(request, env = {}) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const parsed = parseRequest(new URL(request.url));
  if (parsed.error) return json({ source: null, observations: [], notices: [parsed.error] });
  try {
    const result = await providers[parsed.countryCode](parsed, env);
    const observations = (result.observations || []).sort((left, right) => left.time.localeCompare(right.time));
    return json({
      source: observations.length ? result.source : null,
      observations,
      notices: [result.notice].filter(Boolean)
    });
  } catch (error) {
    return json({
      source: null,
      observations: [],
      notices: [`${PROVIDER_INFO[parsed.countryCode].name} data was unavailable (${error.message}); using Open-Meteo fallback`]
    });
  }
}
