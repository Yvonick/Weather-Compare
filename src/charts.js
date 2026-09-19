import { collectBucketKeys } from "./aggregate.js";
import { METRIC_GROUPS, SERIES_STYLES } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const create = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgNode = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
  return node;
};

export function formatNumber(value, digits = 1) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : "n/a";
}

export function formatDirection(value) {
  if (!Number.isFinite(value)) return "n/a";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${Math.round(value)} deg ${labels[Math.round(value / 45) % 8]}`;
}

function niceStep(range, targetTicks = 5) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function lineDashForKind(dataKind) {
  return dataKind === "forecast" ? "8 5" : "";
}

const TABLE_HEAT_COLORS = ["#f8fafc", "#edf4fb", "#dceaf6", "#c5def0", "#a8cde6"];

export function tableHeatStyle(value, domain) {
  if (!Number.isFinite(value) || !domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.min === domain.max) return null;
  const position = Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
  return {
    backgroundColor: TABLE_HEAT_COLORS[Math.min(4, Math.floor(position * 5))],
    textColor: "#162b3d"
  };
}

export function chartScale(metric, series) {
  const values = [];
  for (const location of series) {
    for (const row of location.rows) {
      if (Number.isFinite(row[metric.id])) values.push(row[metric.id]);
      if (metric.type === "range" || metric.type === "envelope") {
        if (Number.isFinite(row[metric.minKey])) values.push(row[metric.minKey]);
        if (Number.isFinite(row[metric.maxKey])) values.push(row[metric.maxKey]);
      }
    }
  }
  if (!values.length) return { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low === high) {
    const spread = Math.max(Math.abs(low) * 0.1, 10 ** -(metric.digits ?? 1));
    low -= spread;
    high += spread;
  }
  const valueRange = high - low;
  const padding = valueRange * 0.06;
  const rawMin = metric.floorZero ? Math.max(0, low - padding) : low - padding;
  const rawMax = high + padding;
  const step = niceStep(rawMax - rawMin);
  const min = rawMin;
  const max = rawMax;
  const ticks = [];
  const firstTick = Math.ceil((min - step / 1000) / step) * step;
  for (let value = firstTick, guard = 0; value <= max + step / 1000 && guard < 12; value += step, guard += 1) ticks.push(Number(value.toPrecision(12)));
  const tickDigits = Math.max(0, Math.min(3, -Math.floor(Math.log10(step))));
  return { min, max, ticks, tickDigits };
}

function validRange(row, minKey, maxKey) {
  return row && Number.isFinite(row[minKey]) && Number.isFinite(row[maxKey]) && row[minKey] <= row[maxKey];
}

export function tooltipText(location, row, metric) {
  const forecastContext = row.dataKind === "forecast"
    ? `Forecast · ${row.forecastConfidence || "unknown"} confidence (lead-time guide) · `
    : "Historical · ";
  if (metric.type === "range" || metric.type === "envelope") {
    const sourceContext = row.temperatureStationName
      ? ` · Station: ${row.temperatureStationName}${Number.isFinite(row.temperatureStationDistanceKm) ? ` (${formatNumber(row.temperatureStationDistanceKm, 1)} km)` : ""}`
      : metric.type === "envelope" ? "" : " · Source: Open-Meteo grid";
    if (!validRange(row, metric.minKey, metric.maxKey)) {
      return `${location.label} · ${row.label} · ${forecastContext}Min ${formatNumber(row[metric.minKey], metric.digits)} · Avg ${formatNumber(row[metric.id], metric.digits)} · Max ${formatNumber(row[metric.maxKey], metric.digits)} ${metric.unit} · full range unavailable${sourceContext}`;
    }
    return `${location.label} · ${row.label} · ${forecastContext}Min ${formatNumber(row[metric.minKey], metric.digits)} ${metric.unit} · Avg ${formatNumber(row[metric.id], metric.digits)} ${metric.unit} · Max ${formatNumber(row[metric.maxKey], metric.digits)} ${metric.unit}${sourceContext}`;
  }
  const source = metric.id.startsWith("temperature")
    ? row.temperatureStationName ? ` · Station: ${row.temperatureStationName}` : " · Source: Open-Meteo grid"
    : "";
  return `${location.label} · ${row.label} · ${forecastContext}${metric.title}: ${formatNumber(row[metric.id], metric.digits)} ${metric.unit}${source}`;
}

export function temperatureReadoutText(location, row, metric, dateLabel = row?.label || "") {
  const title = (location.label || location.query || "Location").split(",")[0].trim();
  const temperatures = [["Min", metric.minKey], ["Avg", metric.id], ["Max", metric.maxKey]]
    .map(([label, key]) => `${label} ${Number.isFinite(row?.[key]) ? `${formatNumber(row[key], metric.digits)} ${metric.unit}` : "—"}`);
  return [title, ...temperatures, dateLabel].filter(Boolean).join(" · ");
}

function attachTooltip(target, frame, text) {
  target.setAttribute("tabindex", "0");
  target.setAttribute("aria-label", text);
  const show = (event) => {
    const tooltip = frame.querySelector(".chart-tooltip");
    tooltip.textContent = text;
    tooltip.hidden = false;
    const frameRect = frame.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const clientX = event.clientX || targetRect.left + targetRect.width / 2;
    const clientY = event.clientY || targetRect.top;
    tooltip.style.left = `${Math.max(8, Math.min(frameRect.width - 240, clientX - frameRect.left + 10))}px`;
    tooltip.style.top = `${Math.max(8, clientY - frameRect.top - 58)}px`;
  };
  const hide = () => { frame.querySelector(".chart-tooltip").hidden = true; };
  target.addEventListener("mouseenter", show);
  target.addEventListener("focus", show);
  target.addEventListener("mouseleave", hide);
  target.addEventListener("blur", hide);
}

function renderThresholdBands(svg, metric, scale, yFor, plotLeft, plotTop, plotWidth, plotHeight) {
  if (!metric.bands) return;
  for (const band of metric.bands) {
    const start = Math.max(scale.min, band.start);
    const end = Math.min(scale.max, Number.isFinite(band.end) ? band.end : scale.max);
    if (end <= start) continue;
    const top = yFor(end);
    const bottom = yFor(start);
    svg.append(svgNode("rect", { x: plotLeft, y: top, width: plotWidth, height: bottom - top, fill: band.fill }));
  }
  svg.append(svgNode("rect", { x: plotLeft, y: plotTop, width: plotWidth, height: plotHeight, fill: "none", stroke: "#d7d7d7" }));
}

function renderForecastRegion(svg, boundaryX, plotTop, plotRight, plotHeight) {
  if (!Number.isFinite(boundaryX)) return;
  svg.append(svgNode("rect", {
    x: boundaryX,
    y: plotTop,
    width: Math.max(0, plotRight - boundaryX),
    height: plotHeight,
    fill: "#e8f2ee",
    "fill-opacity": 0.72
  }));
  svg.append(svgNode("line", {
    x1: boundaryX,
    x2: boundaryX,
    y1: plotTop,
    y2: plotTop + plotHeight,
    stroke: "#226047",
    "stroke-width": 2
  }));
  const nowLabel = svgNode("text", { x: boundaryX + 8, y: plotTop + 15, class: "forecast-axis-label" });
  nowLabel.textContent = "FORECAST DATA →";
  svg.append(nowLabel);
}

function renderThresholdLegend(metric) {
  if (!metric.bands) return null;
  const legend = create("div", "threshold-legend");
  legend.setAttribute("aria-label", "Threshold legend");
  for (const band of metric.bands) {
    const item = create("span", "threshold-item");
    const swatch = create("i", "threshold-swatch");
    swatch.style.background = band.fill;
    const range = Number.isFinite(band.end) ? `${band.start}–${band.end}` : `${band.start}+`;
    item.append(swatch, document.createTextNode(`${band.label} ${range}`));
    legend.append(item);
  }
  return legend;
}

export function chartTickParts(key) {
  const [isoDate, time] = key.split("T");
  const [year, month, day] = isoDate.split("-");
  return { date: `${day}/${month}/${year}`, time: time?.slice(0, 5) || null };
}

function pointSpacingForKeys(keys) {
  if (keys.length < 2 || !keys[0].includes("T") || !keys[1].includes("T")) return 86;
  const intervalMinutes = Math.abs(Date.parse(keys[1]) - Date.parse(keys[0])) / 60000;
  if (intervalMinutes <= 60) return 30;
  if (intervalMinutes <= 180) return 54;
  if (intervalMinutes <= 360) return 64;
  return 86;
}

function tickStrideForKeys(keys) {
  if (keys.length < 2 || !keys[0].includes("T") || !keys[1].includes("T")) return 1;
  const intervalMinutes = Math.abs(Date.parse(keys[1]) - Date.parse(keys[0])) / 60000;
  return intervalMinutes <= 60 ? 3 : 1;
}

function renderYAxis(scale, yFor, margin, height) {
  const axis = svgNode("svg", {
    class: "chart-y-axis",
    viewBox: `0 0 ${margin.left + 1} ${height}`,
    width: margin.left + 1,
    height,
    "aria-hidden": "true"
  });
  axis.append(svgNode("rect", { x: 0, y: 0, width: margin.left, height, fill: "#fff" }));
  for (const tick of scale.ticks) {
    const label = svgNode("text", { x: margin.left - 10, y: yFor(tick) + 4, "text-anchor": "end", class: "axis-label" });
    label.textContent = formatNumber(tick, scale.tickDigits);
    axis.append(label);
  }
  axis.append(svgNode("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: height - margin.bottom, stroke: "#d7d7d7" }));
  return axis;
}

export function combinedTemperatureMetric(granularity = "day") {
  const bucketMinutes = { day: 1440, "12h": 720, "6h": 360, "3h": 180, "1h": 60, "30m": 30 }[granularity] || 1440;
  return { id: "temperatureAvg", title: "Average temperature and min–max range", unit: "°C", digits: 1, type: "envelope", minKey: "temperatureMin", maxKey: "temperatureMax", bucketMinutes };
}

export function temperatureBandIndices(series, selectedIndex, locked = []) {
  if (series.length <= 2) return series.map((location) => location.styleIndex);
  const visibleLocks = [...new Set(locked)].filter((id) => series.some((location) => location.styleIndex === id)).slice(0, 2);
  if (visibleLocks.length) return visibleLocks;
  return [series.some((location) => location.styleIndex === selectedIndex) ? selectedIndex : series[0].styleIndex];
}

// Inspection moves freely; only explicit clicks alter the (at most two) locks.
export function temperatureSelection(state, index, toggle = false) {
  let locked = [...state.locked];
  if (toggle) {
    if (locked.includes(index)) locked = locked.filter((id) => id !== index);
    else if (locked.length < 2) locked.push(index);
  }
  return { priority: index, locked };
}

// Break at missing buckets; bridge adjacent historical/forecast samples only.
export function chartSegments(keys, rows, valueKeys, bucketMinutes) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const segments = [];
  let segment = null;
  let previous = null;
  keys.forEach((key, index) => {
    const row = byKey.get(key);
    if (previous && bucketMinutes) {
      const timestamp = (value) => Date.parse(value.includes("T") ? `${value}Z` : `${value}T00:00:00Z`);
      if (timestamp(key) - timestamp(previous.row.key) > bucketMinutes * 60000) { segment = null; previous = null; }
    }
    const valid = row && valueKeys.every((name) => Number.isFinite(row[name]))
      && (valueKeys.length !== 2 || row[valueKeys[0]] <= row[valueKeys[1]]);
    if (!valid) { segment = null; previous = null; return; }
    const point = { index, row };
    const kind = row.dataKind === "forecast" ? "forecast" : "historical";
    if (!segment || segment.kind !== kind) {
      segment = { kind, points: previous ? [previous] : [] };
      segments.push(segment);
    }
    segment.points.push(point);
    previous = point;
  });
  return segments;
}

function renderTemperatureBand(svg, location, keys, metric, xFor, yFor, color) {
  const band = svgNode("g", { class: "temperature-band", "data-location-index": location.styleIndex, "aria-hidden": "true" });
  for (const { kind, points } of chartSegments(keys, location.rows, [metric.minKey, metric.maxKey], metric.bucketMinutes)) {
    const low = points.map(({ index, row }) => [xFor(index), yFor(row[metric.minKey])]);
    const high = points.map(({ index, row }) => [xFor(index), yFor(row[metric.maxKey])]);
    // A singleton still needs visible width; this does not imply an extra sample.
    if (points.length === 1) {
      low.push([low[0][0] + 4, low[0][1]]);
      high.push([high[0][0] + 4, high[0][1]]);
      low[0][0] -= 4;
      high[0][0] -= 4;
    }
    const line = (points) => points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ");
    band.append(svgNode("path", { d: `${line(low)} ${line([...high].reverse()).replace(/^M/, "L")} Z`, fill: color, "fill-opacity": .12, "data-kind": kind }));
    band.append(svgNode("path", { d: `${line(low)} ${line(high)}`, fill: "none", stroke: color, "stroke-opacity": .48, "stroke-width": 1.3, "stroke-dasharray": lineDashForKind(kind), "data-kind": kind }));
  }
  svg.append(band);
  return band;
}

export function renderChartFrame(container, metric, series, highlightIndex, { zoom = 1 } = {}) {
  container.replaceChildren();
  const combined = metric.type === "envelope";
  container.classList.toggle("combined-chart", combined);
  const frame = create("div", "chart-frame");
  const scroll = create("div", "chart-scroll");
  const tooltip = create("div", "chart-tooltip");
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  frame.append(scroll, tooltip);
  container.append(frame);

  const keys = collectBucketKeys(series);
  if (!keys.length) {
    scroll.append(create("p", "empty-state", "No values are available for this chart."));
    return frame;
  }
  if (!series.some((location) => location.rows.some((row) => Number.isFinite(row[metric.id]) || (combined && validRange(row, metric.minKey, metric.maxKey))))) {
    const isExtreme = ["temperatureMin", "temperatureMax"].includes(metric.id);
    scroll.append(create("p", "empty-state", isExtreme
      ? "No temperature extrema are available for these buckets. A single sample cannot establish a minimum or maximum. Try Average, a longer time bucket, or a different date range."
      : "No values are available for this indicator in the selected window."));
    return frame;
  }

  const baseWidth = Math.max(680, 88 + keys.length * pointSpacingForKeys(keys));
  const width = Math.round(baseWidth * zoom);
  const height = Math.round(310 * zoom);
  const margin = { top: 20 * zoom, right: 26 * zoom, bottom: 64 * zoom, left: 62 * zoom };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const scale = metric.sharedScale || chartScale(metric, series);
  const yFor = (value) => margin.top + (scale.max - value) / (scale.max - scale.min) * plotHeight;
  const edgeInset = Math.min(40 * zoom, plotWidth / 4);
  const xFor = (index) => margin.left + (keys.length === 1 ? plotWidth / 2 : edgeInset + index / (keys.length - 1) * (plotWidth - edgeInset * 2));
  const allRows = series.flatMap((location) => location.rows);
  const rowForKey = new Map(keys.map((key) => [key, allRows.find((row) => row.key === key)]));
  const forecastIndex = keys.findIndex((key) => rowForKey.get(key)?.dataKind === "forecast");
  const forecastBoundaryX = forecastIndex < 0
    ? null
    : forecastIndex === 0
      ? margin.left
      : (xFor(forecastIndex - 1) + xFor(forecastIndex)) / 2;
  const svg = svgNode("svg", {
    class: "chart-svg",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": `${metric.title} historical and forecast line chart${combined ? ". Bands show within-period extrema, not forecast uncertainty. Hover or tap a point for exact values." : ""}`
  });

  renderThresholdBands(svg, metric, scale, yFor, margin.left, margin.top, plotWidth, plotHeight);
  renderForecastRegion(svg, forecastBoundaryX, margin.top, width - margin.right, plotHeight);
  for (const tick of scale.ticks) {
    const y = yFor(tick);
    svg.append(svgNode("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, stroke: "#d7d7d7", "stroke-width": 1 }));
  }
  const tickStride = tickStrideForKeys(keys);
  keys.forEach((key, index) => {
    const parts = chartTickParts(key);
    const isFirstBucketOfDay = index === 0 || key.slice(0, 10) !== keys[index - 1].slice(0, 10);
    if (!isFirstBucketOfDay && index % tickStride !== 0) return;
    const label = svgNode("text", { x: xFor(index), y: height - margin.bottom + 20, "text-anchor": "middle", class: "axis-label chart-x-label" });
    const row = rowForKey.get(key);
    if (row?.dataKind === "forecast") label.classList.add("forecast-date-label");
    if (parts.time) {
      const timeLine = svgNode("tspan", { x: xFor(index), dy: 0, class: "axis-time-label" });
      timeLine.textContent = parts.time;
      label.append(timeLine);
      if (isFirstBucketOfDay) {
        const dateLine = svgNode("tspan", { x: xFor(index), dy: 15, class: "axis-date-label" });
        dateLine.textContent = parts.date;
        label.append(dateLine);
      }
    } else {
      label.textContent = parts.date;
    }
    svg.append(label);
  });

  const bandNodes = new Map();
  const lineNodes = new Map();
  let inspectPoint = () => {};
  let restoreRange = () => {};
  if (combined) {
    // Every fill sits behind every location's average line and markers.
    for (const location of series) {
      const style = SERIES_STYLES[location.styleIndex % SERIES_STYLES.length];
      bandNodes.set(location.styleIndex, renderTemperatureBand(svg, location, keys, metric, xFor, yFor, style.color));
    }
    svg.querySelectorAll(".forecast-axis-label").forEach((label) => svg.append(label));
  }
  for (const location of series) {
    const style = SERIES_STYLES[location.styleIndex % SERIES_STYLES.length];
    const seriesLayer = svgNode("g", { class: "chart-series", "data-location-index": location.styleIndex });
    svg.append(seriesLayer);
    lineNodes.set(location.styleIndex, seriesLayer);
    const isHighlighted = highlightIndex === location.styleIndex;
    const lineWidth = metric.type === "range"
      ? (isHighlighted ? 4.1 : 2.6)
      : (isHighlighted ? 5.2 : 3.4);
    const opacity = metric.type === "range" ? (isHighlighted ? 0.9 : 0.7) : 1;
    const rowByKey = new Map(location.rows.map((row) => [row.key, row]));
    const buildPath = (kind) => {
      if (combined) return chartSegments(keys, location.rows, [metric.id], metric.bucketMinutes).filter((segment) => segment.kind === kind)
        .map((segment) => segment.points.map(({ index, row }, i) => `${i ? "L" : "M"} ${xFor(index)} ${yFor(row[metric.id])}`).join(" ")).join(" ");
      let path = "";
      let drawing = false;
      keys.forEach((key, index) => {
        const row = rowByKey.get(key);
        const value = row?.[metric.id];
        const bridge = kind === "forecast" && forecastIndex > 0 && index === forecastIndex - 1;
        const included = kind === "forecast" ? row?.dataKind === "forecast" || bridge : row?.dataKind !== "forecast";
        if (!included || !Number.isFinite(value)) {
          drawing = false;
          return;
        }
        path += `${drawing ? " L" : " M"} ${xFor(index)} ${yFor(value)}`;
        drawing = true;
      });
      return path.trim();
    };
    const historicalPath = buildPath("historical");
    const forecastPath = buildPath("forecast");
    if (historicalPath) seriesLayer.append(svgNode("path", { d: historicalPath, fill: "none", stroke: style.color, "stroke-width": lineWidth, "stroke-dasharray": lineDashForKind("historical"), "stroke-linejoin": "round", "stroke-linecap": "round", opacity }));
    if (forecastPath) seriesLayer.append(svgNode("path", { d: forecastPath, fill: "none", stroke: style.color, "stroke-width": lineWidth, "stroke-dasharray": lineDashForKind("forecast"), "stroke-linejoin": "round", "stroke-linecap": "round", opacity: opacity * 0.82 }));
    if (combined) {
      seriesLayer.addEventListener("pointerenter", () => inspectPoint(location.styleIndex));
      seriesLayer.addEventListener("pointerleave", () => restoreRange());
      seriesLayer.addEventListener("click", () => inspectPoint(location.styleIndex, undefined, true));
    }

    keys.forEach((key, index) => {
      const row = rowByKey.get(key);
      const value = row?.[metric.id];
      if (!row || !Number.isFinite(value)) return;
      const x = xFor(index);
      const y = yFor(value);
      const isForecast = row.dataKind === "forecast";
      if (metric.type === "range" && Number.isFinite(row[metric.minKey]) && Number.isFinite(row[metric.maxKey])) {
        const minY = yFor(row[metric.minKey]);
        const maxY = yFor(row[metric.maxKey]);
        const rangeAttributes = { stroke: style.color, "stroke-dasharray": lineDashForKind(row.dataKind), opacity: isForecast ? opacity * 0.82 : opacity };
        svg.append(svgNode("line", { x1: x, x2: x, y1: minY, y2: maxY, "stroke-width": isHighlighted ? 3.2 : 2.3, ...rangeAttributes }));
        svg.append(svgNode("line", { x1: x - 6, x2: x + 6, y1: minY, y2: minY, "stroke-width": isHighlighted ? 3.3 : 2.4, ...rangeAttributes }));
        svg.append(svgNode("line", { x1: x - 6, x2: x + 6, y1: maxY, y2: maxY, "stroke-width": isHighlighted ? 3.3 : 2.4, ...rangeAttributes }));
      }
      const markerRadius = metric.type === "range" ? (isHighlighted ? 4.9 : 4.1) : (isHighlighted ? 5.1 : 4.2);
      const commonMarkerAttributes = {
        fill: isForecast ? "#fff" : style.color,
        stroke: isForecast ? style.color : "#fff",
        "stroke-width": isForecast ? (isHighlighted ? 3 : 2.4) : (isHighlighted ? 1.7 : 1.4),
        opacity: isForecast ? 0.9 : opacity
      };
      const marker = style.marker === "diamond"
        ? svgNode("rect", {
          x: x - markerRadius * 0.78,
          y: y - markerRadius * 0.78,
          width: markerRadius * 1.56,
          height: markerRadius * 1.56,
          transform: `rotate(45 ${x} ${y})`,
          ...commonMarkerAttributes
        })
        : svgNode("circle", { cx: x, cy: y, r: markerRadius, ...commonMarkerAttributes });
      if (combined) {
        marker.setAttribute("data-bucket-index", index);
        marker.addEventListener("pointerenter", () => inspectPoint(location.styleIndex, index));
        marker.addEventListener("click", (event) => { event.stopPropagation(); inspectPoint(location.styleIndex, index, true); });
      } else attachTooltip(marker, frame, tooltipText(location, row, metric));
      seriesLayer.append(marker);
    });
  }

  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", `Scrollable ${metric.title} chart. The value axis remains visible while scrolling horizontally.`);
  scroll.append(svg);
  const yAxis = renderYAxis(scale, yFor, margin, height);
  frame.insertBefore(yAxis, tooltip);
  scroll.addEventListener("scroll", () => {
    yAxis.style.transform = `translateY(${-scroll.scrollTop}px)`;
  }, { passive: true });
  if (combined) {
    const controls = create("div", "combined-controls");
    const hint = create("p", "combined-hint", `Line: average. Band: minimum–maximum within each time bucket, not forecast uncertainty. Dashed lines: forecast. ${series.length <= 2 ? "Both ranges are visible." : "Lock up to two locations to compare their ranges."}`);
    if (series.length === 1) hint.textContent = hint.textContent.replace("Both ranges", "The range").replace("are visible", "is visible");
    const locations = create("div", "combined-locations");
    locations.setAttribute("role", "group");
    locations.setAttribute("aria-label", "Lock up to two locations");
    const savedFocusVisible = series.some((location) => location.styleIndex === metric.rangeFocus);
    let preferred = savedFocusVisible ? metric.rangeFocus
      : series.some((location) => location.styleIndex === highlightIndex) ? highlightIndex : series[0].styleIndex;
    let focused = null;
    let selection = { priority: preferred, locked: [...new Set(metric.rangeLocks || [])].filter((id) => series.some((location) => location.styleIndex === id)).slice(0, 2) };
    let inspectedIndex = series.some((location) => location.styleIndex === metric.inspectLocation) ? metric.inspectLocation : preferred;
    let inspectedKey = keys.includes(metric.inspectKey) ? metric.inspectKey : keys[0];
    const lockStatus = create("p", "combined-lock-status");
    lockStatus.setAttribute("role", "status");
    const readout = create("p", "combined-readout");
    readout.setAttribute("role", "status");
    readout.setAttribute("aria-live", "polite");
    const inspectionMarker = svgNode("circle", { class: "inspection-marker", r: 9, fill: "none", stroke: "#111", "stroke-width": 2, "aria-hidden": "true", "pointer-events": "none" });
    svg.append(inspectionMarker);
    const buttons = new Map();
    const update = (limitReached = false) => {
      const index = selection.priority;
      const visibleBands = temperatureBandIndices(series, index, selection.locked);
      bandNodes.forEach((node, id) => { node.style.display = visibleBands.includes(id) ? "" : "none"; });
      lineNodes.forEach((node, id) => { node.style.opacity = series.length > 2 && !visibleBands.includes(id) ? ".5" : "1"; });
      buttons.forEach((button, id) => {
        const locked = selection.locked.includes(id);
        button.setAttribute("aria-pressed", String(locked));
        button.querySelector(".combined-lock-badge").hidden = !locked;
        button.setAttribute("aria-label", `${locked ? "Unlock" : "Lock"} location: ${series.find((entry) => entry.styleIndex === id).label}`);
        button.classList.toggle("is-previewed", !selection.locked.length && id === index);
      });
      const lockText = limitReached ? "Two locations are locked. Deselect one to choose another." : `${selection.locked.length} / 2 locations locked`;
      if (lockStatus.textContent !== lockText) lockStatus.textContent = lockText;
      const location = series.find((entry) => entry.styleIndex === inspectedIndex);
      const row = location.rows.find((entry) => entry.key === inspectedKey);
      readout.textContent = temperatureReadoutText(location, row, metric, row?.label || rowForKey.get(inspectedKey)?.label || inspectedKey);
      inspectionMarker.style.display = Number.isFinite(row?.[metric.id]) ? "" : "none";
      inspectionMarker.setAttribute("cx", xFor(keys.indexOf(inspectedKey)));
      if (Number.isFinite(row?.[metric.id])) inspectionMarker.setAttribute("cy", yFor(row[metric.id]));
    };
    inspectPoint = (index, bucketIndex, toggle = false) => {
      const limitReached = toggle && selection.locked.length === 2 && !selection.locked.includes(index);
      inspectedIndex = index;
      if (Number.isInteger(bucketIndex)) inspectedKey = keys[bucketIndex];
      metric.inspectKey = inspectedKey;
      metric.inspectLocation = index;
      selection = temperatureSelection(selection, index, toggle);
      if (toggle) {
        preferred = index;
        metric.rangeFocus = index;
        metric.rangeLocks = [...selection.locked];
      }
      update(limitReached);
    };
    restoreRange = () => {
      selection = temperatureSelection(selection, focused ?? preferred);
      update();
    };
    for (const location of series) {
      const button = create("button", "combined-location");
      button.type = "button";
      button.dataset.rangeLocation = location.styleIndex;
      const style = SERIES_STYLES[location.styleIndex % SERIES_STYLES.length];
      const swatch = create("i", `comparison-marker is-${style.marker}`);
      swatch.style.background = style.color;
      const badge = create("span", "combined-lock-badge", "Locked");
      badge.hidden = true;
      button.append(swatch, document.createTextNode(locationDisplayName(location, series)), badge);
      button.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") inspectPoint(location.styleIndex); });
      button.addEventListener("pointerleave", () => restoreRange());
      button.addEventListener("focus", () => { focused = location.styleIndex; inspectPoint(focused); });
      button.addEventListener("blur", () => { focused = null; restoreRange(); });
      button.addEventListener("click", () => inspectPoint(location.styleIndex, undefined, true));
      buttons.set(location.styleIndex, button);
      locations.append(button);
    }
    const keyboardHint = create("p", "combined-keyboard-hint", "← → dates · ↑ ↓ locations");
    scroll.setAttribute("aria-label", `${metric.title}. Use left and right arrow keys for dates, up and down for locations, Home or End for the first or last date.`);
    scroll.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let bucketIndex = keys.indexOf(inspectedKey);
      let locationIndex = series.findIndex((location) => location.styleIndex === inspectedIndex);
      if (event.key === 'ArrowLeft') bucketIndex--;
      if (event.key === 'ArrowRight') bucketIndex++;
      if (event.key === 'ArrowUp') locationIndex--;
      if (event.key === 'ArrowDown') locationIndex++;
      if (event.key === 'Home') bucketIndex = 0;
      if (event.key === 'End') bucketIndex = keys.length - 1;
      bucketIndex = Math.max(0, Math.min(keys.length - 1, bucketIndex));
      locationIndex = Math.max(0, Math.min(series.length - 1, locationIndex));
      inspectPoint(series[locationIndex].styleIndex, bucketIndex);
      scroll.scrollLeft = Math.max(0, xFor(bucketIndex) - scroll.clientWidth / 2);
      const value = series[locationIndex].rows.find((row) => row.key === keys[bucketIndex])?.[metric.id];
      if (Number.isFinite(value)) {
        const y = yFor(value);
        if (y < scroll.scrollTop + 16 || y > scroll.scrollTop + scroll.clientHeight - 16) {
          scroll.scrollTop = Math.max(0, y - scroll.clientHeight / 2);
        }
      }
    });
    frame.append(keyboardHint);
    controls.append(hint, locations, lockStatus);
    container.prepend(controls);
    container.append(readout);
    update();
  }
  return frame;
}

function renderChartCard(metric, series, highlightIndex, onPopout) {
  const card = create("section", "chart-card");
  const head = create("div", "chart-head");
  const titleWrap = create("div");
  titleWrap.append(create("h3", null, metric.title), create("span", "chart-unit", metric.unit));
  const button = create("button", "text-button", "Pop out");
  button.type = "button";
  button.addEventListener("click", () => onPopout(metric, button));
  head.append(titleWrap, button);
  const body = create("div");
  const legend = renderThresholdLegend(metric);
  card.append(head);
  if (legend) card.append(legend);
  card.append(body);
  renderChartFrame(body, metric, series, highlightIndex);
  return card;
}

export function buildTableModel(group, series) {
  const metrics = group.tableColumns.filter((column) => !column.forecastOnly || series.some((location) => location.rows.some((row) => Number.isFinite(row[column.key]))));
  const keys = collectBucketKeys(series);
  const rowsByLocation = series.map((location) => new Map(location.rows.map((row) => [row.key, row])));
  const heatDomains = {};
  metrics.filter((metric) => metric.formatter !== "direction").forEach((metric) => {
    const heatGroup = metric.heatGroup || metric.key;
    const values = series.flatMap((location) => location.rows.map((row) => row[metric.key])).filter(Number.isFinite);
    if (!values.length) return;
    const current = heatDomains[heatGroup];
    const metricMin = Math.min(...values);
    const metricMax = Math.max(...values);
    heatDomains[heatGroup] = {
      min: current ? Math.min(current.min, metricMin) : metricMin,
      max: current ? Math.max(current.max, metricMax) : metricMax
    };
  });
  const buckets = keys.map((key) => {
    const representative = rowsByLocation.map((map) => map.get(key)).find(Boolean);
    return {
      key,
      label: representative?.label || key,
      dataKind: representative?.dataKind || "historical",
      forecastConfidence: representative?.forecastConfidence || null
    };
  });
  const rows = series.flatMap((location, locationIndex) => metrics.map((metric, metricIndex) => ({
    location,
    locationIndex,
    metric,
    metricIndex,
    heatDomain: heatDomains[metric.heatGroup || metric.key] || null,
    values: keys.map((key) => rowsByLocation[locationIndex].get(key)?.[metric.key]),
    sourceRows: keys.map((key) => rowsByLocation[locationIndex].get(key) || null)
  })));
  return { buckets, heatDomains, metrics, rows };
}

function locationDisplayName(location, series) {
  const shortName = (location.query || location.label).split(",")[0];
  const collisions = series.filter((other) => (other.query || other.label).split(",")[0] === shortName);
  return collisions.length > 1 ? location.label : shortName;
}

export function renderTable(group, series, useGradient) {
  const block = create("div", "table-block");
  const wrapper = create("div", "table-scroll");
  const table = create("table");
  const caption = create("caption", "sr-only", group.tableTitle);
  const model = buildTableModel(group, series);
  if (useGradient) {
    const legend = create("div", "table-heat-legend");
    legend.setAttribute("role", "img");
    legend.setAttribute("aria-label", "Five soft blue shades, from lower to higher values within each indicator. Not a health or risk scale.");
    legend.append(
      create("span", null, "Lower"),
      create("i", "table-heat-ramp"),
      create("span", null, "Higher"),
      create("small", "table-heat-note", "Relative to visible values, separately for each indicator. Temperature and wind measures share their respective scales. Not a risk scale.")
    );
    block.append(legend);
  }
  const head = create("thead");
  const headingRow = create("tr");
  const locationHead = create("th", "table-location-heading", "Location");
  locationHead.scope = "col";
  const metricHead = create("th", "table-metric-heading", "Indicator");
  metricHead.scope = "col";
  headingRow.append(locationHead, metricHead);
  const firstForecastIndex = model.buckets.findIndex((bucket) => bucket.dataKind === "forecast");
  model.buckets.forEach((bucket, bucketIndex) => {
    const isForecast = bucket.dataKind === "forecast";
    const classes = ["table-date-heading"];
    if (isForecast) classes.push("forecast-table-column");
    if (bucketIndex === firstForecastIndex) classes.push("is-first-forecast-column");
    const cell = create("th", classes.join(" "), bucket.label);
    cell.scope = "col";
    if (isForecast) {
      cell.append(create("small", "forecast-column-badge", "Forecast"));
      const confidence = `${bucket.forecastConfidence || "unknown"} confidence (lead-time guide)`;
      cell.append(create("small", "forecast-confidence", `${bucket.forecastConfidence || "unknown"} confidence`));
      cell.title = confidence;
      cell.setAttribute("aria-label", `${bucket.label} · Forecast · ${confidence}`);
    }
    headingRow.append(cell);
  });
  head.append(headingRow);

  const body = create("tbody");
  model.rows.forEach((tableRow) => {
    const rowNode = create("tr");
    if (tableRow.metricIndex === 0 && tableRow.locationIndex > 0) rowNode.classList.add("is-location-start");
    if (tableRow.metricIndex === 0) {
      const station = group.id === "temperature" ? tableRow.location.temperatureSource : null;
      const locationCell = create("th", "table-location-heading");
      const shortName = locationDisplayName(tableRow.location, series);
      locationCell.append(create("strong", null, shortName));
      locationCell.title = tableRow.location.label;
      const sourceDetails = create("details", "table-source-details");
      sourceDetails.append(create("summary", null, "Details"), create("small", "table-location-context", tableRow.location.label));
      if (station?.stationName) {
        const distance = Number.isFinite(station.stationDistanceKm) ? ` · ${formatNumber(station.stationDistanceKm, 1)} km away` : "";
        sourceDetails.append(create("small", "table-location-context", `${station.stationName}${distance}`));
      } else if (group.id === "temperature") {
        sourceDetails.append(create("small", "table-location-context", "Open-Meteo grid fallback"));
      }
      locationCell.append(sourceDetails);
      locationCell.scope = "rowgroup";
      locationCell.rowSpan = model.metrics.length;
      rowNode.append(locationCell);
    }
    const metricCell = create("th", "table-metric-heading", tableRow.metric.label);
    metricCell.scope = "row";
    rowNode.append(metricCell);
    tableRow.values.forEach((value, bucketIndex) => {
      const bucket = model.buckets[bucketIndex];
      const classes = [];
      if (bucket.dataKind === "forecast") classes.push("forecast-table-column");
      if (bucketIndex === firstForecastIndex) classes.push("is-first-forecast-column");
      const cell = create("td", classes.join(" "), tableRow.metric.formatter === "direction" ? formatDirection(value) : formatNumber(value, tableRow.metric.digits));
      if (bucket.dataKind === "forecast") cell.title = `Forecast · ${bucket.forecastConfidence || "unknown"} confidence (lead-time guide)`;
      if (group.id === "temperature") {
        const sourceRow = tableRow.sourceRows[bucketIndex];
        const sourceTitle = sourceRow?.temperatureStationName
          ? `${sourceRow.temperatureProviderName || "Station"}: ${sourceRow.temperatureStationName}`
          : "Open-Meteo grid fallback; no station range for this bucket";
        cell.title = [cell.title, sourceTitle].filter(Boolean).join(" · ");
      }
      const heatStyle = useGradient ? tableHeatStyle(value, tableRow.heatDomain) : null;
      if (heatStyle) {
        cell.classList.add("table-heat-cell");
        cell.style.setProperty("--heat-color", heatStyle.backgroundColor);
        cell.style.setProperty("--heat-text", heatStyle.textColor);
      }
      rowNode.append(cell);
    });
    body.append(rowNode);
  });
  table.append(caption, head, body);
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", `${group.tableTitle}. Scroll for more dates and locations; column and row headings stay visible.`);
  wrapper.append(table);
  block.append(wrapper);
  return block;
}

export function temperatureChartMetrics(series) {
  const measures = ["min", "avg", "max"];
  const definitions = {
    min: { id: "temperatureMin", title: "Minimum temperature" },
    avg: { id: "temperatureAvg", title: "Average temperature" },
    max: { id: "temperatureMax", title: "Maximum temperature" }
  };
  // All three charts share a scale derived from the visible locations.
  const scaleSeries = [{ rows: series.flatMap((location) => location.rows.flatMap((row) => measures.map((key) => ({ value: row[definitions[key].id] })))) }];
  const sharedScale = chartScale({ id: "value", digits: 1 }, scaleSeries);
  return measures.map((key) => ({ ...definitions[key], unit: "°C", digits: 1, sharedScale }));
}

function renderGroup(group, series, settings, onPopout) {
  const displayGroup = group;
  const article = create("article", "panel metric-panel");
  const intro = create("div", "panel-intro");
  const titleWrap = create("div");
  titleWrap.append(create("p", "eyebrow", displayGroup.eyebrow), create("h2", null, displayGroup.title));
  intro.append(titleWrap, create("p", "description", displayGroup.description));
  article.append(intro);
  if (displayGroup.id === "air" && settings.view === "graph") {
    const note = create("p", "method-note");
    note.innerHTML = 'Threshold guides follow the <a href="https://airindex.eea.europa.eu/AQI/index.html" target="_blank" rel="noreferrer">EEA European AQI methodology</a>.';
    article.append(note);
  }
  if (!series.length) {
    article.append(create("p", "empty-state", "Load at least one visible location to populate this panel."));
  } else if (settings.view === "table") {
    const tableHead = create("div", "chart-head table-head");
    tableHead.append(create("h3", null, group.tableTitle));
    const expand = create("button", "text-button", "Pop out");
    expand.type = "button";
    expand.setAttribute("aria-label", `Pop out ${group.tableTitle}`);
    expand.addEventListener("click", () => onPopout({ tableGroup: group }, expand));
    tableHead.append(expand);
    article.append(tableHead);
    article.append(renderTable(displayGroup, series, settings.tableGradient));
  } else {
    const metrics = group.id === "temperature"
      ? [combinedTemperatureMetric(settings.granularity)]
      : displayGroup.metrics.filter((metric) => !metric.forecastOnly || series.some((location) => location.rows.some((row) => Number.isFinite(row[metric.id]))));
    const grid = create("div", `chart-grid ${metrics.length === 1 || group.id === "temperature" ? "single" : ""}`);
    metrics.forEach((metric) => grid.append(renderChartCard(metric, series, settings.highlightLocation, onPopout)));
    article.append(grid);
  }
  return article;
}

export function renderDashboard(container, series, settings, onPopout) {
  const sourcePanel = container.querySelector("#sources-panel");
  container.querySelectorAll(".metric-panel").forEach((panel) => panel.remove());
  METRIC_GROUPS.forEach((group) => container.insertBefore(renderGroup(group, series, settings, onPopout), sourcePanel));
}

export function createChartPopout(dialog) {
  const title = dialog.querySelector("[data-popout-title]");
  const unit = dialog.querySelector("[data-popout-unit]");
  const body = dialog.querySelector("[data-popout-body]");
  const zoomOut = dialog.querySelector("[data-zoom-out]");
  const zoomIn = dialog.querySelector("[data-zoom-in]");
  const reset = dialog.querySelector("[data-zoom-reset]");
  const close = dialog.querySelector("[data-popout-close]");
  let state = null;
  let trigger = null;
  let drag = null;
  let dragged = false;

  const rerender = () => {
    if (!state) return;
    if (state.tableGroup) {
      body.replaceChildren(renderTable(state.tableGroup, state.series, state.useGradient));
      return;
    }
    renderChartFrame(body, state.metric, state.series, state.highlightIndex, { zoom: state.zoom });
    reset.disabled = state.zoom === 1;
    zoomOut.disabled = state.zoom <= 0.7;
    zoomIn.disabled = state.zoom >= 2.5;
  };
  const setZoom = (value) => {
    state.zoom = Math.max(0.7, Math.min(2.5, Math.round(value * 10) / 10));
    rerender();
  };

  zoomOut.addEventListener("click", () => setZoom(state.zoom - 0.3));
  zoomIn.addEventListener("click", () => setZoom(state.zoom + 0.3));
  reset.addEventListener("click", () => setZoom(1));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("close", () => trigger?.focus());
  body.addEventListener("pointerdown", (event) => {
    dragged = false;
    const scroll = event.target.closest(".chart-scroll");
    if (!scroll || event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, scroll };
  });
  body.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (!dragged && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    dragged = true;
    body.setPointerCapture?.(event.pointerId);
    drag.scroll.scrollLeft = drag.left - (event.clientX - drag.x);
    drag.scroll.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const endDrag = () => { drag = null; };
  body.addEventListener("pointerup", endDrag);
  body.addEventListener("pointercancel", endDrag);
  body.addEventListener("click", (event) => {
    if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; }
  }, true);

  return {
    open(metric, series, highlightIndex, sourceButton) {
      state = { metric: { ...metric, rangeLocks: [...(metric.rangeLocks || [])] }, series, highlightIndex, zoom: 1 };
      trigger = sourceButton;
      title.textContent = metric.title;
      unit.textContent = `Magnified visualization · ${metric.unit}`;
      dialog.classList.remove("is-table-popout");
      [zoomIn, zoomOut, reset].forEach((button) => { button.hidden = false; });
      rerender();
      dialog.showModal();
      zoomIn.focus();
    },
    openTable(group, series, useGradient, sourceButton) {
      state = { tableGroup: group, series, useGradient };
      trigger = sourceButton;
      title.textContent = group.tableTitle;
      unit.textContent = "Expanded table · scroll for more dates";
      dialog.classList.add("is-table-popout");
      body.classList.remove("combined-chart");
      [zoomIn, zoomOut, reset].forEach((button) => { button.hidden = true; });
      rerender();
      dialog.showModal();
      close.focus();
    }
  };
}
