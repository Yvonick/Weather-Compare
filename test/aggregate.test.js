import test from "node:test";
import assert from "node:assert/strict";
import { aggregateLocationData, forecastConfidenceForLead, formatBucketLabel, getBucketKey } from "../src/aggregate.js";

test("sub-day bucket keys use local clock boundaries", () => {
  assert.equal(getBucketKey("2026-08-06T11:30", "6h"), "2026-08-06T06:00");
  assert.equal(getBucketKey("2026-08-06T12:00", "12h"), "2026-08-06T12:00");
  assert.equal(getBucketKey("2026-08-06T23:00", "3h"), "2026-08-06T21:00");
});

test("sub-day labels describe the complete bucket window", () => {
  assert.equal(formatBucketLabel("2026-08-06T00:00", "12h"), "06/08/2026 00:00-11:59");
  assert.equal(formatBucketLabel("2026-08-06T18:00", "6h"), "06/08/2026 18:00-23:59");
  assert.equal(formatBucketLabel("2026-08-06T21:00", "3h"), "06/08/2026 21:00-23:59");
});

test("hourly values aggregate with metric-specific rules", () => {
  const times = ["2026-08-06T00:00", "2026-08-06T01:00"];
  const weather = {
    timezone: "Europe/Berlin",
    hourly: {
      time: times,
      temperature_2m: [10, 20],
      precipitation: [1.2, 0.8],
      snowfall: [0.1, 0.2],
      sunshine_duration: [1800, 3600],
      wind_speed_10m: [5, 15],
      wind_gusts_10m: [12, 22],
      wind_direction_10m: [350, 10]
    }
  };
  const air = {
    hourly: {
      time: times,
      european_aqi: [20, 40],
      pm2_5: [5, 15],
      pm10: [10, 30],
      nitrogen_dioxide: [4, 8],
      ozone: [30, 50],
      sulphur_dioxide: [1, 3],
      uv_index: [0, 2]
    }
  };
  const [row] = aggregateLocationData({ query: "Test", label: "Test", latitude: 1, longitude: 2 }, weather, air, "day").rows;
  assert.equal(row.temperatureMin, 10);
  assert.equal(row.temperatureAvg, 15);
  assert.equal(row.temperatureMax, 20);
  assert.equal(row.precipitationSum, 2);
  assert.equal(row.sunshineHours, 1.5);
  assert.equal(row.windGustMax, 22);
  assert.ok(row.windDirection < 0.001 || row.windDirection > 359.999);
  assert.equal(row.aqiAvg, 30);
  assert.equal(row.aqiMax, 40);
  assert.equal(row.pm25Avg, 10);
  assert.equal(row.uvMax, 2);
});

test("weather and air timestamps merge into the same bucket", () => {
  const result = aggregateLocationData(
    { query: "Test", label: "Test", latitude: 1, longitude: 2 },
    { hourly: { time: ["2026-08-06T00:00"], temperature_2m: [12] } },
    { hourly: { time: ["2026-08-06T01:00"], european_aqi: [33] } },
    "day"
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].temperatureAvg, 12);
  assert.equal(result.rows[0].aqiAvg, 33);
});

test("forecast rows retain provenance and a lead-time confidence guide", () => {
  const result = aggregateLocationData(
    { query: "Test", label: "Test", latitude: 1, longitude: 2 },
    { hourly: { time: ["2026-08-10T00:00", "2026-08-16T00:00"], temperature_2m: [12, 18], precipitation_probability: [30, 70] } },
    { hourly: {} },
    "day",
    {},
    { kind: "forecast", forecastStartDate: "2026-08-10" }
  );
  assert.equal(result.rows[0].dataKind, "forecast");
  assert.equal(result.rows[0].forecastConfidence, "higher");
  assert.equal(result.rows[1].forecastConfidence, "lower");
  assert.equal(result.rows[1].precipitationProbabilityMax, 70);
  assert.equal(forecastConfidenceForLead(4), "medium");
});

test("sum metrics remain missing when every source value is missing", () => {
  const [row] = aggregateLocationData(
    { query: "Test", label: "Test", latitude: 1, longitude: 2 },
    { hourly: { time: ["2026-08-06T00:00"], temperature_2m: [12], precipitation: [null], snowfall: [null], sunshine_duration: [null] } },
    { hourly: {} },
    "day"
  ).rows;
  assert.equal(row.precipitationSum, null);
  assert.equal(row.snowfallSum, null);
  assert.equal(row.sunshineHours, null);
});
