import { MAX_LOCATIONS, PRESETS, STORAGE_KEY } from "./config.js";

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDate(dateString, offsetDays) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return formatDate(date);
}

export function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function createDefaultSettings(now = new Date()) {
  const endDate = formatDate(now);
  return {
    locations: ["Fulda, Germany", "Zurich, Switzerland"],
    hiddenLocations: [false, false],
    highlightLocation: null,
    preset: "7d",
    startDate: shiftDate(endDate, -6),
    endDate,
    granularity: "day",
    view: "graph"
  };
}

export function normalizeSettings(candidate = {}, now = new Date()) {
  const fallback = createDefaultSettings(now);
  const locations = Array.isArray(candidate.locations)
    ? candidate.locations.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, MAX_LOCATIONS)
    : fallback.locations;
  const normalizedLocations = locations.length ? locations : fallback.locations;
  const hiddenLocations = normalizedLocations.map((_, index) => {
    const value = Array.isArray(candidate.hiddenLocations) ? candidate.hiddenLocations[index] : false;
    return value === true || value === 1 || value === "1" || value === "true";
  });
  const rawHighlight = Number.parseInt(candidate.highlightLocation, 10);

  return {
    locations: normalizedLocations,
    hiddenLocations,
    highlightLocation: Number.isInteger(rawHighlight) && rawHighlight >= 0 && rawHighlight < normalizedLocations.length ? rawHighlight : null,
    preset: [...Object.keys(PRESETS), "custom"].includes(candidate.preset) ? candidate.preset : fallback.preset,
    startDate: isDateString(candidate.startDate) ? candidate.startDate : fallback.startDate,
    endDate: isDateString(candidate.endDate) ? candidate.endDate : fallback.endDate,
    granularity: ["day", "12h", "6h", "3h"].includes(candidate.granularity) ? candidate.granularity : fallback.granularity,
    view: ["graph", "table"].includes(candidate.view) ? candidate.view : fallback.view
  };
}

export function syncPresetDates(settings, now = new Date()) {
  if (settings.preset === "custom") return settings;
  const days = PRESETS[settings.preset] || PRESETS["7d"];
  const endDate = formatDate(now);
  return { ...settings, endDate, startDate: shiftDate(endDate, -(days - 1)) };
}

export function validateSettings(settings) {
  const errors = [];
  const locations = settings.locations.map((value) => value.trim()).filter(Boolean);
  if (!locations.length) errors.push("Add at least one location.");
  if (locations.length > MAX_LOCATIONS) errors.push(`Use at most ${MAX_LOCATIONS} locations.`);
  if (!isDateString(settings.startDate) || !isDateString(settings.endDate)) {
    errors.push("Provide a valid start and end date.");
  } else if (settings.startDate > settings.endDate) {
    errors.push("Start date must be before or equal to the end date.");
  }
  return errors;
}

export function settingsFromUrl(url, now = new Date()) {
  const params = new URL(url).searchParams;
  if (!params.toString()) return null;
  return normalizeSettings({
    locations: params.getAll("location"),
    hiddenLocations: params.getAll("hidden"),
    highlightLocation: params.get("highlight"),
    preset: params.get("preset"),
    startDate: params.get("start"),
    endDate: params.get("end"),
    granularity: params.get("granularity"),
    view: params.get("view")
  }, now);
}

export function buildShareUrl(settings, baseUrl) {
  const url = new URL(baseUrl);
  url.search = "";
  settings.locations.slice(0, MAX_LOCATIONS).forEach((location, index) => {
    const value = location.trim();
    if (!value) return;
    url.searchParams.append("location", value);
    url.searchParams.append("hidden", settings.hiddenLocations[index] ? "1" : "0");
  });
  url.searchParams.set("preset", settings.preset);
  url.searchParams.set("start", settings.startDate);
  url.searchParams.set("end", settings.endDate);
  url.searchParams.set("granularity", settings.granularity);
  url.searchParams.set("view", settings.view);
  if (Number.isInteger(settings.highlightLocation)) url.searchParams.set("highlight", String(settings.highlightLocation));
  return url.toString();
}

export function loadSettings({ url, storage, now = new Date() }) {
  const fromUrl = settingsFromUrl(url, now);
  if (fromUrl) return fromUrl;
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved ? normalizeSettings(JSON.parse(saved), now) : createDefaultSettings(now);
  } catch {
    return createDefaultSettings(now);
  }
}

export function saveSettings(settings, storage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is optional; private browsing and embedded contexts may reject it.
  }
}

export function describeWindow(settings) {
  if (PRESETS[settings.preset]) return `past ${PRESETS[settings.preset]} days`;
  return `${settings.startDate} to ${settings.endDate}`;
}
