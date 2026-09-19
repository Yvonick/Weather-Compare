import test from "node:test";
import assert from "node:assert/strict";

import { buildTableModel, chartScale, chartSegments, chartTickParts, combinedTemperatureMetric, lineDashForKind, tableHeatStyle, temperatureBandIndices, temperatureChartMetrics } from "../src/charts.js";

const seriesWith = (key, values) => [{
  rows: values.map((value) => ({ [key]: value }))
}];

test("non-negative metrics are framed around their observed values instead of zero", () => {
  const scale = chartScale(
    { id: "windSpeedAvg", digits: 1, floorZero: true },
    seriesWith("windSpeedAvg", [42, 44, 47])
  );

  assert.ok(scale.min > 0);
  assert.ok(scale.min < 42);
  assert.ok(scale.max > 47);
  assert.ok(!scale.ticks.includes(0));
  assert.ok(scale.max - scale.min < 7);
});

test("a constant positive series receives a tight readable domain", () => {
  const scale = chartScale(
    { id: "aqiAvg", digits: 1, floorZero: true },
    seriesWith("aqiAvg", [20, 20, 20])
  );

  assert.ok(scale.min > 0);
  assert.ok(scale.min < 20);
  assert.ok(scale.max > 20);
  assert.ok(scale.max - scale.min < 10);
});

test("zero remains available when it is part of the displayed dataset", () => {
  const scale = chartScale(
    { id: "precipitationSum", digits: 1, floorZero: true },
    seriesWith("precipitationSum", [0, 0.4, 1.2])
  );

  assert.equal(scale.min, 0);
});

test("dash encoding is reserved exclusively for forecast data", () => {
  assert.equal(lineDashForKind("historical"), "");
  assert.equal(lineDashForKind("forecast"), "8 5");
});

test("chart ticks separate compact hours from dd/mm/yyyy dates", () => {
  assert.deepEqual(chartTickParts("2026-08-06T13:00"), { date: "06/08/2026", time: "13:00" });
  assert.deepEqual(chartTickParts("2026-08-06"), { date: "06/08/2026", time: null });
});

test("table models put time buckets on columns and location indicators on rows", () => {
  const model = buildTableModel({
    tableColumns: [
      { key: "temperatureMin", label: "Tmin", digits: 1 },
      { key: "temperatureMax", label: "Tmax", digits: 1 }
    ]
  }, [{
    label: "Fulda",
    rows: [
      { key: "2026-08-09", label: "09/08/2026", dataKind: "historical", temperatureMin: 11, temperatureMax: 20 },
      { key: "2026-08-10", label: "10/08/2026", dataKind: "forecast", forecastConfidence: "higher", temperatureMin: 12, temperatureMax: 22 }
    ]
  }]);

  assert.deepEqual(model.buckets.map((bucket) => bucket.label), ["09/08/2026", "10/08/2026"]);
  assert.deepEqual(model.rows.map((row) => row.metric.label), ["Tmin", "Tmax"]);
  assert.deepEqual(model.rows[0].values, [11, 12]);
  assert.equal(model.buckets[1].dataKind, "forecast");
});

test("table heat colors use at most five quiet shades with high-contrast text", () => {
  const domain = { min: -10, max: 40 };
  assert.deepEqual(tableHeatStyle(-10, domain), { backgroundColor: "#f8fafc", textColor: "#162b3d" });
  assert.deepEqual(tableHeatStyle(40, domain), { backgroundColor: "#a8cde6", textColor: "#162b3d" });
  const shades = new Set(Array.from({ length: 51 }, (_, i) => tableHeatStyle(i - 10, domain).backgroundColor));
  assert.equal(shades.size, 5);
  const luminance = (hex) => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const color of shades) assert.ok((luminance(color) + .05) / (luminance("#162b3d") + .05) > 7);
  assert.equal(tableHeatStyle(4, { min: 4, max: 4 }), null);
  assert.equal(tableHeatStyle(null, domain), null);
  assert.equal(tableHeatStyle(NaN, domain), null);
});

test("temperature always shows all three measures on a shared scale for one or several locations", () => {
  const series = [{ rows: [{ temperatureMin: -40, temperatureAvg: 20, temperatureMax: 45 }, { temperatureMin: 0, temperatureAvg: 21, temperatureMax: 40 }] }];
  const all = temperatureChartMetrics(series);
  assert.deepEqual(all.map((metric) => metric.id), ["temperatureMin", "temperatureAvg", "temperatureMax"]);
  assert.ok(all.every((metric) => metric.sharedScale === all[0].sharedScale));
  assert.ok(all[0].sharedScale.min < -40);
  assert.ok(all[0].sharedScale.max > 45);
  assert.equal(temperatureChartMetrics([...series, ...series]).length, 3);
});

test("missing extrema keep their panels without inventing values", () => {
  const all = temperatureChartMetrics([{ rows: [{ temperatureMin: null, temperatureAvg: 20, temperatureMax: null }] }]);
  assert.equal(all.length, 3);
  assert.ok(all.every((metric) => Number.isFinite(metric.sharedScale.min) && Number.isFinite(metric.sharedScale.max)));
});

test("temperature table rows share one heat domain", () => {
  const model = buildTableModel({
    tableColumns: [
      { key: "temperatureMin", label: "Tmin", heatGroup: "temperature" },
      { key: "temperatureMax", label: "Tmax", heatGroup: "temperature" }
    ]
  }, [{ rows: [{ key: "a", temperatureMin: -5, temperatureMax: 28 }] }]);

  assert.deepEqual(model.rows.map((row) => row.heatDomain), [{ min: -5, max: 28 }, { min: -5, max: 28 }]);
});

test("combined temperature scale always includes every location's extrema", () => {
  const metric = combinedTemperatureMetric();
  const series = [{ styleIndex: 4, rows: [{ temperatureMin: -10, temperatureAvg: 20, temperatureMax: 25 }] }, { styleIndex: 8, rows: [{ temperatureMin: 2, temperatureAvg: 28, temperatureMax: 40 }] }];
  const scale = chartScale(metric, series);
  metric.rangeFocus = 8;
  assert.deepEqual(chartScale(metric, series), scale);
  assert.ok(scale.min < -10 && scale.max > 40);
});

test("band selection uses stable location IDs and adapts to visible count", () => {
  const series = [1, 4, 8].map((styleIndex) => ({ styleIndex }));
  assert.deepEqual(temperatureBandIndices(series, 4), [4]);
  assert.deepEqual(temperatureBandIndices(series, 999), [1]);
  assert.deepEqual(temperatureBandIndices(series.slice(1), 1), [4, 8]);
  assert.deepEqual(temperatureBandIndices(series.slice(2), null), [8]);
  assert.deepEqual(temperatureBandIndices([], null), []);
});

test("range segments break at absent, incomplete, or reversed ranges", () => {
  const rows = [
    { key: "a", min: 1, max: 3 }, { key: "b", min: null, max: 4 },
    { key: "d", min: 2, max: 5 }, { key: "e", min: 8, max: 4 },
    { key: "f", min: 2, max: null }, { key: "g", min: 3, max: 3 }
  ];
  const segments = chartSegments(["a", "b", "c", "d", "e", "f", "g"], rows, ["min", "max"]);
  assert.deepEqual(segments.map((segment) => segment.points.map((point) => point.index)), [[0], [3], [6]]);
});

test("forecast range edges bridge adjacent samples but never missing buckets", () => {
  const rows = [{ key: "a", avg: 3 }, { key: "b", avg: 4, dataKind: "forecast" }, { key: "d", avg: 6, dataKind: "forecast" }];
  const segments = chartSegments(["a", "b", "c", "d"], rows, ["avg"]);
  assert.deepEqual(segments.map(({ kind, points }) => [kind, points.map(({ index }) => index)]), [["historical", [0]], ["forecast", [0, 1]], ["forecast", [3]]]);
  assert.equal(lineDashForKind(segments[0].kind), "");
  assert.equal(lineDashForKind(segments[1].kind), "8 5");
});

test("entirely absent time buckets do not get bridged", () => {
  const keys = ["2026-09-10", "2026-09-12"];
  const rows = keys.map((key) => ({ key, min: 10, max: 20 }));
  assert.deepEqual(chartSegments(keys, rows, ["min", "max"], 1440).map(({ points }) => points.length), [1, 1]);
  const hours = ["2026-09-10T00:00", "2026-09-10T01:00"];
  assert.equal(chartSegments(hours, hours.map((key) => ({ key, avg: 4 })), ["avg"], 30).length, 2);
  assert.equal(chartSegments(hours, hours.map((key) => ({ key, avg: 4 })), ["avg"], 60).length, 1);
});
