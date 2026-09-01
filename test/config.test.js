import test from "node:test";
import assert from "node:assert/strict";
import { MAX_LOCATIONS, METRIC_GROUPS, SERIES_STYLES } from "../src/config.js";

test("every supported location slot has a distinct visual style", () => {
  assert.equal(SERIES_STYLES.length, MAX_LOCATIONS);
  const signatures = new Set(SERIES_STYLES.map((style) => `${style.color}|${style.marker}`));
  assert.equal(signatures.size, MAX_LOCATIONS);
  assert.deepEqual(new Set(SERIES_STYLES.map((style) => style.marker)), new Set(["circle", "diamond"]));
});

test("air-quality table indicators each have an independent heat domain", () => {
  const airColumns = METRIC_GROUPS.find((group) => group.id === "air").tableColumns;
  const heatGroups = airColumns.map((column) => column.heatGroup || column.key);
  assert.equal(new Set(heatGroups).size, airColumns.length);
});

test("all precipitation graph metrics use bars", () => {
  const precipitation = METRIC_GROUPS.find((group) => group.id === "precipitation");
  assert.ok(precipitation.metrics.length > 0);
  assert.ok(precipitation.metrics.every((metric) => metric.type === "bar"));
});
