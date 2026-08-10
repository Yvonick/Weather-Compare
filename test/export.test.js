import test from "node:test";
import assert from "node:assert/strict";
import { buildCsv, buildExportRows, EXPORT_HEADERS } from "../src/export.js";

const series = [{
  query: "Paris, France",
  label: "Paris, Île-de-France, France",
  latitude: 48.85,
  longitude: 2.35,
  timezone: "Europe/Paris",
  rows: [{
    key: "2026-08-06", label: "06/08/2026",
    temperatureMin: 10, temperatureAvg: 15, temperatureMax: 20,
    precipitationSum: 1, snowfallSum: 0, sunshineHours: 8,
    uvAvg: 2, uvMax: 5, windSpeedAvg: 7, windGustMax: 18, windDirection: 240,
    aqiAvg: 30, aqiMax: 50, pm25Avg: 7, pm10Avg: 12, no2Avg: 5, ozoneAvg: 70, so2Avg: 1
  }]
}];

test("export rows keep the observed stable schema", () => {
  const [row] = buildExportRows(series);
  assert.deepEqual(Object.keys(row), EXPORT_HEADERS);
  assert.equal(row.location_query, "Paris, France");
  assert.equal(row.wind_direction_deg, 240);
  assert.equal(row.data_kind, "historical");
});

test("CSV includes a BOM and safely quotes commas", () => {
  const csv = buildCsv(series);
  assert.ok(csv.startsWith("\uFEFFlocation_query"));
  assert.match(csv, /"Paris, France"/);
  assert.match(csv, /"Paris, Île-de-France, France"/);
});
