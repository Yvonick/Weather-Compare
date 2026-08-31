import { fetchLocationData, suggestLocationOptions } from "./api.js";
import { settleWithConcurrency } from "./async.js";
import { createChartPopout, renderDashboard } from "./charts.js";
import { CONTINUOUS_PRESET, MAX_LOCATIONS, SERIES_STYLES } from "./config.js";
import { downloadCsv } from "./export.js";
import {
  buildShareUrl,
  createDefaultSettings,
  describeWindow,
  formatDisplayDate,
  loadSettings,
  parseDisplayDate,
  saveSettings,
  syncPresetDates,
  validateSettings
} from "./settings.js";

const elements = {
  form: document.querySelector("#controls-form"),
  bootStatus: document.querySelector("#boot-status"),
  locationList: document.querySelector("#location-list"),
  locationCount: document.querySelector("#location-count"),
  add: document.querySelector("#add-location-button"),
  preset: document.querySelector("#time-window-select"),
  start: document.querySelector("#start-date-input"),
  end: document.querySelector("#end-date-input"),
  granularity: document.querySelector("#granularity-select"),
  view: document.querySelector("#view-select"),
  tableGradient: document.querySelector("#table-gradient-input"),
  tableGradientField: document.querySelector("#table-gradient-field"),
  load: document.querySelector("#load-button"),
  reset: document.querySelector("#reset-button"),
  export: document.querySelector("#export-button"),
  share: document.querySelector("#share-button"),
  errors: document.querySelector("#error-list"),
  status: document.querySelector("#status"),
  timelineGuide: document.querySelector("#timeline-guide"),
  legend: document.querySelector("#series-legend"),
  dashboard: document.querySelector("#dashboard"),
  popout: document.querySelector("#chart-popout")
};

let settings = loadSettings({ url: window.location.href, storage: window.localStorage });
settings = syncPresetDates(settings);
let loadedData = [];
let failures = [];
let loading = false;
let suggestionTimer = null;
let suggestionRequest = null;
let activeLoadRequest = null;
let locationSearch = {
  index: null,
  query: "",
  results: [],
  activeIndex: -1,
  open: false,
  loading: false,
  message: ""
};
const popout = createChartPopout(elements.popout);

const icon = (name) => {
  const paths = {
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/>',
    hidden: '<path d="m3 3 18 18M10.6 6.2c.5-.1.9-.2 1.4-.2 6.5 0 10 6 10 6a18 18 0 0 1-3 3.7M6.6 6.7C3.6 8.6 2 12 2 12s3.5 6 10 6c1.4 0 2.6-.3 3.7-.7M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    bulb: '<path d="M9 18h6M10 22h4M8.3 14.6A6 6 0 1 1 15.7 14.6C14.7 15.3 14 16.5 14 18h-4c0-1.5-.7-2.7-1.7-3.4Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};

function setStatus(message) {
  elements.status.textContent = message;
}

function renderErrors(errors) {
  elements.errors.replaceChildren(...errors.map((message) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    return paragraph;
  }));
  elements.errors.classList.toggle("is-visible", errors.length > 0);
}

function persist() {
  saveSettings(settings, window.localStorage);
}

function renderLocationControls() {
  clearSuggestionWork();
  locationSearch = { index: null, query: "", results: [], activeIndex: -1, open: false, loading: false, message: "" };
  elements.locationList.replaceChildren();
  settings.locations.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "location-row";
    const search = document.createElement("div");
    search.className = "location-search";
    search.dataset.searchIndex = index;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = "Search a city or place";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `Location ${index + 1}`);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", `location-options-${index}`);
    input.setAttribute("aria-describedby", `location-search-status-${index}`);
    input.dataset.locationIndex = index;

    const popover = document.createElement("div");
    popover.className = "location-search-popover";
    popover.hidden = true;
    popover.dataset.searchPopover = index;
    const searchStatus = document.createElement("p");
    searchStatus.id = `location-search-status-${index}`;
    searchStatus.className = "location-search-status";
    searchStatus.setAttribute("role", "status");
    searchStatus.setAttribute("aria-live", "polite");
    const options = document.createElement("div");
    options.id = `location-options-${index}`;
    options.className = "location-options";
    options.setAttribute("role", "listbox");
    options.setAttribute("aria-label", `Suggestions for location ${index + 1}`);
    popover.append(searchStatus, options);
    search.append(input, popover);

    const actions = document.createElement("div");
    actions.className = "location-actions";
    const hidden = Boolean(settings.hiddenLocations[index]);
    const highlighted = settings.highlightLocation === index;
    const controls = [
      { action: "hidden", label: `${hidden ? "Unhide" : "Hide"} location ${index + 1}`, icon: hidden ? "hidden" : "eye", selected: hidden },
      { action: "highlight", label: `${highlighted ? "Remove highlight from" : "Highlight"} location ${index + 1}`, icon: "bulb", selected: highlighted },
      { action: "remove", label: `Remove location ${index + 1}`, icon: "trash", selected: false }
    ];
    controls.forEach((control) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `icon-button ${control.selected ? "is-selected" : ""} ${control.action === "hidden" && hidden ? "is-hidden" : ""} ${control.action === "remove" ? "remove-button" : ""}`.trim();
      button.dataset.action = control.action;
      button.dataset.index = index;
      button.setAttribute("aria-label", control.label);
      button.title = control.label;
      if (control.action !== "remove") button.setAttribute("aria-pressed", String(control.selected));
      button.innerHTML = icon(control.icon);
      actions.append(button);
    });
    row.append(search, actions);
    elements.locationList.append(row);
  });
  elements.locationCount.textContent = `${settings.locations.length} / ${MAX_LOCATIONS}`;
  elements.add.disabled = loading || settings.locations.length >= MAX_LOCATIONS;
}

function renderControls() {
  elements.preset.value = settings.preset;
  elements.start.value = formatDisplayDate(settings.startDate);
  elements.end.value = formatDisplayDate(settings.endDate);
  elements.granularity.value = settings.granularity;
  elements.view.value = settings.view;
  elements.tableGradient.checked = settings.tableGradient;
  elements.tableGradient.disabled = settings.view !== "table";
  elements.tableGradientField.classList.toggle("is-disabled", settings.view !== "table");
  elements.load.disabled = loading;
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  elements.timelineGuide.hidden = !(settings.preset === CONTINUOUS_PRESET || settings.endDate > todayString || loadedData.some((location) => location.hasForecast));
  renderLocationControls();
  persist();
}

function visibleSeries() {
  return loadedData.filter((location) => !settings.hiddenLocations[location.styleIndex]);
}

function renderLegend(series) {
  elements.legend.replaceChildren();
  if (!series.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = loadedData.length ? "Unhide at least one location to show the legend." : "Load at least one location to show the legend.";
    elements.legend.append(empty);
    return;
  }
  series.forEach((location) => {
    const style = SERIES_STYLES[location.styleIndex];
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = `legend-swatch is-${style.marker}`;
    swatch.style.color = style.color;
    swatch.style.borderTopColor = style.color;
    const content = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = location.label;
    const query = document.createElement("small");
    query.textContent = `Query: ${location.query} · ${Number(location.latitude).toFixed(3)}, ${Number(location.longitude).toFixed(3)} · ${location.timezone}`;
    const sources = document.createElement("small");
    sources.textContent = `Weather: Open-Meteo (${location.weatherSource || "source grid"}) · Air: Open-Meteo (${location.airSource || "source grid"})`;
    const temperature = document.createElement("small");
    const temperatureSource = location.temperatureSource;
    temperature.textContent = temperatureSource
      ? `Temperature ranges: ${temperatureSource.name} · ${temperatureSource.stationName || "station"}${Number.isFinite(temperatureSource.stationDistanceKm) ? ` (${temperatureSource.stationDistanceKm.toFixed(1)} km)` : ""} · ${temperatureSource.rangeMethod}`
      : "Temperature ranges: Open-Meteo hourly grid fallback (a single hourly sample has no within-hour range)";
    content.append(name, query, temperature, sources);
    if (location.dataNotices?.length) {
      const notice = document.createElement("small");
      notice.className = "data-notice";
      notice.textContent = location.dataNotices.join(" · ");
      content.append(notice);
    }
    item.append(swatch, content);
    elements.legend.append(item);
  });
}

function renderData() {
  const series = visibleSeries();
  renderLegend(series);
  const effectiveHighlight = settings.hiddenLocations[settings.highlightLocation] ? null : settings.highlightLocation;
  renderDashboard(elements.dashboard, series, { ...settings, highlightLocation: effectiveHighlight }, (metric, button) => {
    popout.open(metric, series, effectiveHighlight, button);
  });
}

function clearSuggestionWork() {
  clearTimeout(suggestionTimer);
  suggestionTimer = null;
  suggestionRequest?.abort();
  suggestionRequest = null;
}

function renderLocationSearch() {
  const index = locationSearch.index;
  if (!Number.isInteger(index)) return;
  const search = elements.locationList.querySelector(`[data-search-index="${index}"]`);
  if (!search) return;
  const input = search.querySelector("input");
  const popover = search.querySelector("[data-search-popover]");
  const status = search.querySelector(".location-search-status");
  const listbox = search.querySelector("[role='listbox']");
  input.setAttribute("aria-expanded", String(locationSearch.open));
  input.setAttribute("aria-busy", String(locationSearch.loading));
  popover.hidden = !locationSearch.open;
  status.textContent = locationSearch.message;
  listbox.replaceChildren();
  locationSearch.results.forEach((suggestion, resultIndex) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `location-options-${index}-option-${resultIndex}`;
    option.className = `location-option ${resultIndex === locationSearch.activeIndex ? "is-active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(resultIndex === locationSearch.activeIndex));
    option.dataset.suggestionIndex = resultIndex;
    option.dataset.locationIndex = index;
    option.setAttribute("aria-label", suggestion.value);
    const primary = document.createElement("strong");
    primary.textContent = suggestion.name;
    const context = document.createElement("span");
    context.textContent = suggestion.context;
    const meta = document.createElement("small");
    meta.textContent = suggestion.meta;
    option.append(primary, context, meta);
    listbox.append(option);
  });
  if (locationSearch.activeIndex >= 0) {
    input.setAttribute("aria-activedescendant", `location-options-${index}-option-${locationSearch.activeIndex}`);
    listbox.children[locationSearch.activeIndex]?.scrollIntoView?.({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function openSearchHint(index, query) {
  const trimmed = query.trim();
  locationSearch = {
    index,
    query,
    results: [],
    activeIndex: -1,
    open: true,
    loading: false,
    message: trimmed.length < 2
      ? "Type at least 2 characters to search."
      : "Edit this value to search for another place."
  };
  renderLocationSearch();
}

function closeLocationSearch() {
  clearSuggestionWork();
  if (!Number.isInteger(locationSearch.index)) return;
  locationSearch = { ...locationSearch, open: false, loading: false, activeIndex: -1 };
  renderLocationSearch();
}

function selectLocationSuggestion(index, resultIndex) {
  if (locationSearch.index !== index || !locationSearch.results[resultIndex]) return;
  const value = locationSearch.results[resultIndex].value;
  settings.locations[index] = value;
  const input = elements.locationList.querySelector(`input[data-location-index="${index}"]`);
  if (input) input.value = value;
  persist();
  closeLocationSearch();
  input?.focus();
  setStatus(`Selected ${value}. Load comparison to refresh the data.`);
}

function queueSuggestions(index, query) {
  clearSuggestionWork();
  const trimmed = query.trim();
  locationSearch = {
    index,
    query,
    results: [],
    activeIndex: -1,
    open: true,
    loading: trimmed.length >= 2,
    message: trimmed.length < 2 ? "Type at least 2 characters to search." : "Searching places…"
  };
  renderLocationSearch();
  if (trimmed.length < 2) {
    return;
  }
  suggestionTimer = setTimeout(async () => {
    suggestionRequest = new AbortController();
    try {
      const results = await suggestLocationOptions(query, suggestionRequest.signal);
      if (locationSearch.index !== index || locationSearch.query !== query) return;
      locationSearch = {
        ...locationSearch,
        results,
        activeIndex: -1,
        loading: false,
        open: true,
        message: results.length
          ? `${results.length} suggestion${results.length === 1 ? "" : "s"}. Use the arrow keys or select a result.`
          : "No matching locations found. You can still use the text you entered."
      };
      renderLocationSearch();
    } catch (error) {
      if (error.name === "AbortError") return;
      locationSearch = {
        ...locationSearch,
        results: [],
        activeIndex: -1,
        loading: false,
        open: true,
        message: "Location search is temporarily unavailable. You can still enter a place manually."
      };
      renderLocationSearch();
    }
  }, 180);
}

async function copyShareLink() {
  const errors = validateSettings(settings);
  renderErrors(errors);
  if (errors.length) {
    setStatus("Fix the input errors before creating a share link.");
    return;
  }
  const url = buildShareUrl(settings, window.location.href);
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Share link copied to clipboard.");
  } catch {
    const helper = document.createElement("textarea");
    helper.value = url;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    setStatus(copied ? "Share link copied to clipboard." : `Share link: ${url}`);
  }
}

async function loadComparison() {
  const errors = validateSettings(settings);
  renderErrors(errors);
  if (errors.length) {
    setStatus("Fix the input errors to load the comparison.");
    return;
  }

  const highlightedOriginalIndex = settings.highlightLocation;
  const entries = settings.locations
    .map((value, index) => ({ value: value.trim(), hidden: Boolean(settings.hiddenLocations[index]), originalIndex: index }))
    .filter((entry) => entry.value)
    .slice(0, MAX_LOCATIONS);
  settings.locations = entries.map((entry) => entry.value);
  settings.hiddenLocations = entries.map((entry) => entry.hidden);
  const remappedHighlight = entries.findIndex((entry) => entry.originalIndex === highlightedOriginalIndex);
  settings.highlightLocation = remappedHighlight >= 0 ? remappedHighlight : null;

  activeLoadRequest?.abort();
  const request = new AbortController();
  activeLoadRequest = request;
  const requestSettings = {
    ...settings,
    locations: [...settings.locations],
    hiddenLocations: [...settings.hiddenLocations]
  };
  loading = true;
  renderControls();
  setStatus(`Loading ${entries.length} location${entries.length === 1 ? "" : "s"} for ${describeWindow(settings)}.`);
  const results = await settleWithConcurrency(entries, (entry) => fetchLocationData(entry.value, requestSettings, request.signal), 4);
  if (activeLoadRequest !== request) return;
  activeLoadRequest = null;
  loadedData = [];
  failures = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") loadedData.push({ ...result.value, styleIndex: index });
    else failures.push(`${entries[index].value}: ${result.reason?.message || "request failed"}`);
  });
  loading = false;
  renderControls();
  renderErrors(failures);
  if (!loadedData.length) {
    setStatus("No datasets could be loaded.");
  } else if (failures.length) {
    setStatus(`Loaded ${loadedData.length} location${loadedData.length === 1 ? "" : "s"}; ${failures.length} failed.`);
  } else {
    setStatus(`Loaded ${loadedData.length} location${loadedData.length === 1 ? "" : "s"} successfully.`);
  }
  renderData();
}

elements.locationList.addEventListener("input", (event) => {
  const index = Number(event.target.dataset.locationIndex);
  if (!Number.isInteger(index)) return;
  settings.locations[index] = event.target.value;
  persist();
  queueSuggestions(index, event.target.value);
});

elements.locationList.addEventListener("focusin", (event) => {
  if (!event.target.matches("input[data-location-index]")) return;
  const index = Number(event.target.dataset.locationIndex);
  if (locationSearch.index !== index || !locationSearch.open) openSearchHint(index, event.target.value);
});

elements.locationList.addEventListener("focusout", (event) => {
  if (!event.target.matches("input[data-location-index]")) return;
  setTimeout(() => {
    if (!event.target.closest(".location-search")?.contains(document.activeElement)) closeLocationSearch();
  }, 0);
});

elements.locationList.addEventListener("keydown", (event) => {
  if (!event.target.matches("input[data-location-index]")) return;
  const index = Number(event.target.dataset.locationIndex);
  if (locationSearch.index !== index) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLocationSearch();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
  if (event.key === "Enter") {
    if (locationSearch.open && locationSearch.results.length) {
      event.preventDefault();
      selectLocationSuggestion(index, locationSearch.activeIndex >= 0 ? locationSearch.activeIndex : 0);
    }
    return;
  }
  if (!locationSearch.results.length) return;
  event.preventDefault();
  const delta = event.key === "ArrowDown" ? 1 : -1;
  const start = locationSearch.activeIndex < 0 ? (delta > 0 ? -1 : 0) : locationSearch.activeIndex;
  locationSearch = {
    ...locationSearch,
    open: true,
    activeIndex: (start + delta + locationSearch.results.length) % locationSearch.results.length
  };
  renderLocationSearch();
});

elements.locationList.addEventListener("pointerdown", (event) => {
  if (event.target.closest("[data-suggestion-index]")) event.preventDefault();
});

elements.locationList.addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-suggestion-index]");
  if (suggestion) {
    selectLocationSuggestion(Number(suggestion.dataset.locationIndex), Number(suggestion.dataset.suggestionIndex));
    return;
  }
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index)) return;
  if (button.dataset.action === "hidden") {
    settings.hiddenLocations[index] = !settings.hiddenLocations[index];
  } else if (button.dataset.action === "highlight") {
    settings.highlightLocation = settings.highlightLocation === index ? null : index;
  } else {
    settings.locations.splice(index, 1);
    settings.hiddenLocations.splice(index, 1);
    loadedData = loadedData.filter((location) => location.styleIndex !== index).map((location) => ({ ...location, styleIndex: location.styleIndex > index ? location.styleIndex - 1 : location.styleIndex }));
    if (settings.highlightLocation === index) settings.highlightLocation = null;
    else if (settings.highlightLocation > index) settings.highlightLocation -= 1;
    if (!settings.locations.length) {
      settings.locations.push("");
      settings.hiddenLocations.push(false);
    }
  }
  renderControls();
  renderData();
});

elements.add.addEventListener("click", () => {
  if (settings.locations.length >= MAX_LOCATIONS) return;
  settings.locations.push("");
  settings.hiddenLocations.push(false);
  renderControls();
  elements.locationList.querySelector(".location-row:last-child input")?.focus();
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".location-search")) closeLocationSearch();
});

elements.preset.addEventListener("change", () => {
  settings.preset = elements.preset.value;
  settings = syncPresetDates(settings);
  renderControls();
  setStatus("Time window changed. Load comparison to refresh the data.");
});
elements.start.addEventListener("change", () => {
  settings.startDate = parseDisplayDate(elements.start.value) || elements.start.value.trim();
  settings.preset = "custom";
  renderControls();
});
elements.end.addEventListener("change", () => {
  settings.endDate = parseDisplayDate(elements.end.value) || elements.end.value.trim();
  settings.preset = "custom";
  renderControls();
});
elements.granularity.addEventListener("change", () => {
  settings.granularity = elements.granularity.value;
  persist();
  setStatus("Granularity changed. Load comparison to regroup the data.");
});
elements.view.addEventListener("change", () => {
  settings.view = elements.view.value;
  renderControls();
  renderData();
});
elements.tableGradient.addEventListener("change", () => {
  settings.tableGradient = elements.tableGradient.checked;
  persist();
  renderData();
});

elements.reset.addEventListener("click", () => {
  activeLoadRequest?.abort();
  activeLoadRequest = null;
  loading = false;
  settings = createDefaultSettings();
  loadedData = [];
  failures = [];
  renderErrors([]);
  renderControls();
  renderData();
  setStatus("Defaults restored.");
});

elements.export.addEventListener("click", () => {
  const series = visibleSeries();
  if (!series.length) {
    setStatus(loadedData.length ? "Unhide at least one location before exporting." : "Load at least one dataset before exporting.");
    return;
  }
  const rowCount = downloadCsv(series);
  setStatus(`Exported ${rowCount} row${rowCount === 1 ? "" : "s"} to spreadsheet.`);
});
elements.share.addEventListener("click", copyShareLink);
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadComparison();
});

renderControls();
renderData();
elements.bootStatus.hidden = true;
window.__WEATHER_COMPARE_STARTED__ = true;
setStatus("Interface ready. Loading the saved comparison…");
requestAnimationFrame(() => requestAnimationFrame(() => loadComparison()));
