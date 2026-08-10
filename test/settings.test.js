import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShareUrl,
  createDefaultSettings,
  describeWindow,
  normalizeSettings,
  settingsFromUrl,
  syncPresetDates,
  validateSettings
} from "../src/settings.js";

const now = new Date("2026-08-06T12:00:00");

test("defaults open the continuous historical and forecast timeline", () => {
  const settings = createDefaultSettings(now);
  assert.equal(settings.preset, "7d7f");
  assert.equal(settings.startDate, "2026-07-30");
  assert.equal(settings.endDate, "2026-08-12");
  assert.deepEqual(settings.locations, ["Fulda, Germany", "Zurich, Switzerland"]);
});

test("normalization limits locations and aligns hidden state", () => {
  const candidate = {
    locations: Array.from({ length: 25 }, (_, index) => `Place ${index}`),
    hiddenLocations: ["1", "0", true],
    highlightLocation: "19",
    preset: "15d",
    granularity: "6h",
    view: "table",
    startDate: "2026-01-01",
    endDate: "2026-01-02"
  };
  const settings = normalizeSettings(candidate, now);
  assert.equal(settings.locations.length, 20);
  assert.deepEqual(settings.hiddenLocations.slice(0, 3), [true, false, true]);
  assert.equal(settings.highlightLocation, 19);
});

test("continuous preset spans seven historical and seven forecast days", () => {
  const settings = syncPresetDates({ ...createDefaultSettings(now), preset: "7d7f" }, now);
  assert.equal(settings.startDate, "2026-07-30");
  assert.equal(settings.endDate, "2026-08-12");
  assert.match(describeWindow(settings), /next 7 forecast days/);
});

test("share URLs round-trip all compatibility parameters", () => {
  const settings = {
    locations: ["Berlin, Germany", "Paris, France"],
    hiddenLocations: [false, true],
    highlightLocation: 0,
    preset: "custom",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    granularity: "12h",
    view: "table"
  };
  const url = buildShareUrl(settings, "https://example.test/weathercompare/?old=1");
  assert.deepEqual(settingsFromUrl(url, now), settings);
});

test("validation reports date ordering and empty locations", () => {
  const settings = createDefaultSettings(now);
  settings.locations = [" "];
  settings.startDate = "2026-08-07";
  settings.endDate = "2026-08-06";
  assert.deepEqual(validateSettings(settings), [
    "Add at least one location.",
    "Start date must be before or equal to the end date."
  ]);
});

test("validation limits the deterministic forecast horizon", () => {
  const settings = createDefaultSettings(now);
  settings.preset = "custom";
  settings.endDate = "2026-08-26";
  assert.deepEqual(validateSettings(settings, now), [
    "Forecast dates can extend at most 16 days from today."
  ]);
});
