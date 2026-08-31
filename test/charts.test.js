import test from "node:test";
import assert from "node:assert/strict";

import { buildTableModel, chartScale, chartTickParts, lineDashForKind, tableHeatStyle } from "../src/charts.js";

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

test("table heat colors span the requested low-to-high palette with readable text", () => {
  const domain = { min: -10, max: 40 };
  assert.deepEqual(tableHeatStyle(-10, domain), { backgroundColor: "rgb(255 255 255)", textColor: "#111" });
  assert.deepEqual(tableHeatStyle(40, domain), { backgroundColor: "rgb(118 42 131)", textColor: "#fff" });
  assert.equal(tableHeatStyle(4, { min: 4, max: 4 }), null);
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
