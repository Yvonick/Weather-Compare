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

const TABLE_HEAT_STOPS = [
  { position: 0, color: [255, 255, 255] },
  { position: 0.2, color: [43, 131, 186] },
  { position: 0.4, color: [254, 224, 139] },
  { position: 0.6, color: [253, 174, 97] },
  { position: 0.8, color: [215, 48, 39] },
  { position: 1, color: [118, 42, 131] }
];

export function tableHeatStyle(value, domain) {
  if (!Number.isFinite(value) || !domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.min === domain.max) return null;
  const position = Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
  const upperIndex = TABLE_HEAT_STOPS.findIndex((stop) => stop.position >= position);
  const upper = TABLE_HEAT_STOPS[Math.max(1, upperIndex)];
  const lower = TABLE_HEAT_STOPS[Math.max(0, upperIndex - 1)];
  const segmentPosition = (position - lower.position) / (upper.position - lower.position);
  const color = lower.color.map((channel, index) => Math.round(channel + (upper.color[index] - channel) * segmentPosition));
  const brightness = (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000;
  return {
    backgroundColor: `rgb(${color.join(" ")})`,
    textColor: brightness < 150 ? "#fff" : "#111"
  };
}

export function chartScale(metric, series) {
  const values = [];
  for (const location of series) {
    for (const row of location.rows) {
      if (Number.isFinite(row[metric.id])) values.push(row[metric.id]);
      if (metric.type === "range") {
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
  const rawMin = metric.type === "bar" ? 0 : metric.floorZero ? Math.max(0, low - padding) : low - padding;
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

export function groupedBarLayout(seriesCount, slotWidth, zoom = 1) {
  const count = Math.max(1, Number(seriesCount) || 1);
  const availableWidth = Math.max(1, Number(slotWidth) || 1);
  const groupWidth = Math.min(availableWidth * 0.78, 54 * zoom);
  const gap = count > 1 ? Math.min(2 * zoom, groupWidth / (count * 5)) : 0;
  const barWidth = Math.max(0.35, (groupWidth - gap * (count - 1)) / count);
  return { groupWidth, gap, barWidth, startOffset: -groupWidth / 2 };
}

function tooltipText(location, row, metric) {
  const forecastContext = row.dataKind === "forecast"
    ? `Forecast · ${row.forecastConfidence || "unknown"} confidence (lead-time guide) · `
    : "Historical · ";
  if (metric.type === "range") {
    const sourceContext = row.temperatureStationName
      ? ` · Station: ${row.temperatureStationName}${Number.isFinite(row.temperatureStationDistanceKm) ? ` (${formatNumber(row.temperatureStationDistanceKm, 1)} km)` : ""}`
      : " · Source: Open-Meteo grid (no station range)";
    if (!Number.isFinite(row[metric.minKey]) || !Number.isFinite(row[metric.maxKey])) {
      return `${location.label} · ${row.label} · ${forecastContext}Sample ${formatNumber(row[metric.id], metric.digits)} ${metric.unit} · range unavailable${sourceContext}`;
    }
    return `${location.label} · ${row.label} · ${forecastContext}Min ${formatNumber(row[metric.minKey], metric.digits)} ${metric.unit} · Avg ${formatNumber(row[metric.id], metric.digits)} ${metric.unit} · Max ${formatNumber(row[metric.maxKey], metric.digits)} ${metric.unit}${sourceContext}`;
  }
  return `${location.label} · ${row.label} · ${forecastContext}${formatNumber(row[metric.id], metric.digits)} ${metric.unit}`;
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

export function renderChartFrame(container, metric, series, highlightIndex, { zoom = 1 } = {}) {
  container.replaceChildren();
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

  const baseWidth = Math.max(680, 88 + keys.length * pointSpacingForKeys(keys));
  const width = Math.round(baseWidth * zoom);
  const height = Math.round(310 * zoom);
  const margin = { top: 20 * zoom, right: 26 * zoom, bottom: 64 * zoom, left: 62 * zoom };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const scale = chartScale(metric, series);
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
    "aria-label": `${metric.title} historical and forecast ${metric.type === "bar" ? "bar" : "line"} chart`
  });

  if (metric.type === "bar" && series.some((location) => SERIES_STYLES[location.styleIndex % SERIES_STYLES.length].marker === "diamond")) {
    const definitions = svgNode("defs");
    series.forEach((location) => {
      const style = SERIES_STYLES[location.styleIndex % SERIES_STYLES.length];
      if (style.marker !== "diamond") return;
      const pattern = svgNode("pattern", {
        id: `bar-hatch-${location.styleIndex}`,
        width: 6,
        height: 6,
        patternUnits: "userSpaceOnUse"
      });
      pattern.append(
        svgNode("rect", { width: 6, height: 6, fill: "#fff" }),
        svgNode("path", { d: "M-1 1 L1 -1 M0 6 L6 0 M5 7 L7 5", stroke: style.color, "stroke-width": 1.5, opacity: 0.75 })
      );
      definitions.append(pattern);
    });
    svg.append(definitions);
  }

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

  if (metric.type === "bar") {
    const slotWidth = keys.length > 1
      ? Math.abs(xFor(1) - xFor(0))
      : Math.min(plotWidth, pointSpacingForKeys(keys) * zoom);
    const barLayout = groupedBarLayout(series.length, slotWidth, zoom);
    const baselineY = yFor(0);
    series.forEach((location, locationIndex) => {
      const style = SERIES_STYLES[location.styleIndex % SERIES_STYLES.length];
      const isHighlighted = highlightIndex === location.styleIndex;
      const rowByKey = new Map(location.rows.map((row) => [row.key, row]));
      keys.forEach((key, index) => {
        const row = rowByKey.get(key);
        const value = row?.[metric.id];
        if (!row || !Number.isFinite(value)) return;
        const topY = yFor(Math.max(0, value));
        const isForecast = row.dataKind === "forecast";
        const patterned = style.marker === "diamond";
        const bar = svgNode("rect", {
          class: `chart-bar ${isForecast ? "is-forecast" : "is-historical"}`,
          x: xFor(index) + barLayout.startOffset + locationIndex * (barLayout.barWidth + barLayout.gap),
          y: Math.min(topY, baselineY - 1),
          width: barLayout.barWidth,
          height: Math.max(1, baselineY - topY),
          rx: Math.min(1.5 * zoom, barLayout.barWidth / 3),
          fill: patterned ? `url(#bar-hatch-${location.styleIndex})` : isForecast ? "#fff" : style.color,
          stroke: style.color,
          "stroke-width": isHighlighted ? 2.2 : 1.1,
          "stroke-dasharray": lineDashForKind(row.dataKind),
          opacity: isHighlighted ? 1 : isForecast ? 0.92 : 0.78
        });
        attachTooltip(bar, frame, tooltipText(location, row, metric));
        svg.append(bar);
      });
    });
  } else for (const location of series) {
    const style = SERIES_STYLES[location.styleIndex % SERIES_STYLES.length];
    const isHighlighted = highlightIndex === location.styleIndex;
    const lineWidth = metric.type === "range"
      ? (isHighlighted ? 4.1 : 2.6)
      : (isHighlighted ? 5.2 : 3.4);
    const opacity = metric.type === "range" ? (isHighlighted ? 0.9 : 0.7) : 1;
    const rowByKey = new Map(location.rows.map((row) => [row.key, row]));
    const buildPath = (kind) => {
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
    if (historicalPath) svg.append(svgNode("path", { d: historicalPath, fill: "none", stroke: style.color, "stroke-width": lineWidth, "stroke-dasharray": lineDashForKind("historical"), "stroke-linejoin": "round", "stroke-linecap": "round", opacity }));
    if (forecastPath) svg.append(svgNode("path", { d: forecastPath, fill: "none", stroke: style.color, "stroke-width": lineWidth, "stroke-dasharray": lineDashForKind("forecast"), "stroke-linejoin": "round", "stroke-linecap": "round", opacity: opacity * 0.82 }));

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
      attachTooltip(marker, frame, tooltipText(location, row, metric));
      svg.append(marker);
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

function renderTable(group, series, useGradient) {
  const block = create("div", "table-block");
  const wrapper = create("div", "table-scroll");
  const table = create("table");
  const caption = create("caption", null, group.tableTitle);
  const model = buildTableModel(group, series);
  if (useGradient) {
    const legend = create("div", "table-heat-legend");
    legend.setAttribute("role", "img");
    legend.setAttribute("aria-label", "Relative color scale from very low values in white through blue, yellow, orange, and red to very high values in purple");
    legend.append(
      create("span", null, "Very low"),
      create("i", "table-heat-ramp"),
      create("span", null, "Very high"),
      create("small", "table-heat-note", "Scaled within each indicator across the visible data; comparable temperature and wind rows share a scale.")
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
      cell.append(create("small", "forecast-column-badge", `Forecast · ${bucket.forecastConfidence || "unknown"} confidence`));
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
      locationCell.append(create("strong", null, station?.stationName || tableRow.location.label));
      if (station?.stationName) {
        const distance = Number.isFinite(station.stationDistanceKm) ? ` · ${formatNumber(station.stationDistanceKm, 1)} km away` : "";
        locationCell.append(create("small", "table-location-context", `${tableRow.location.label}${distance}`));
      } else if (group.id === "temperature") {
        locationCell.append(create("small", "table-location-context", `${tableRow.location.label} · Open-Meteo grid fallback`));
      }
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
      if (group.id === "temperature") {
        const sourceRow = tableRow.sourceRows[bucketIndex];
        cell.title = sourceRow?.temperatureStationName
          ? `${sourceRow.temperatureProviderName || "Station"}: ${sourceRow.temperatureStationName}`
          : "Open-Meteo grid fallback; no station range for this bucket";
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
  wrapper.append(table);
  block.append(wrapper);
  return block;
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
    article.append(renderTable(displayGroup, series, settings.tableGradient));
  } else {
    const metrics = displayGroup.metrics.filter((metric) => !metric.forecastOnly || series.some((location) => location.rows.some((row) => Number.isFinite(row[metric.id]))));
    const grid = create("div", `chart-grid ${metrics.length === 1 ? "single" : ""}`);
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

  const rerender = () => {
    if (!state) return;
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
    const scroll = body.querySelector(".chart-scroll");
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, scroll };
    body.setPointerCapture?.(event.pointerId);
  });
  body.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.scroll.scrollLeft = drag.left - (event.clientX - drag.x);
    drag.scroll.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const endDrag = () => { drag = null; };
  body.addEventListener("pointerup", endDrag);
  body.addEventListener("pointercancel", endDrag);

  return {
    open(metric, series, highlightIndex, sourceButton) {
      state = { metric, series, highlightIndex, zoom: 1 };
      trigger = sourceButton;
      title.textContent = metric.title;
      unit.textContent = `Magnified visualization · ${metric.unit}`;
      rerender();
      dialog.showModal();
      zoomIn.focus();
    }
  };
}
