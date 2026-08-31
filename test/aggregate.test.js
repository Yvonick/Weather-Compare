import test from "node:test";
import assert from "node:assert/strict";
import { aggregateLocationData, forecastConfidenceForLead, formatBucketLabel, getBucketKey } from "../src/aggregate.js";

test("sub-day bucket keys use local clock boundaries", () => {
  assert.equal(getBucketKey("2026-08-06T11:30", "6h"), "2026-08-06T06:00");
  assert.equal(getBucketKey("2026-08-06T12:00", "12h"), "2026-08-06T12:00");
  assert.equal(getBucketKey("2026-08-06T23:00", "3h"), "2026-08-06T21:00");
  assert.equal(getBucketKey("2026-08-06T23:00", "1h"), "2026-08-06T23:00");
  assert.equal(getBucketKey("2026-08-06T11:45", "30m"), "2026-08-06T11:30");
});

test("sub-day labels describe the complete bucket window", () => {
  assert.equal(formatBucketLabel("2026-08-06T00:00", "12h"), "06/08/2026 00:00-11:59");
  assert.equal(formatBucketLabel("2026-08-06T18:00", "6h"), "06/08/2026 18:00-23:59");
  assert.equal(formatBucketLabel("2026-08-06T21:00", "3h"), "06/08/2026 21:00-23:59");
  assert.equal(formatBucketLabel("2026-08-06T21:00", "1h"), "06/08/2026 21:00-21:59");
  assert.equal(formatBucketLabel("2026-08-06T21:30", "30m"), "06/08/2026 21:30-21:59");
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

test("a single instantaneous hourly temperature does not claim an hourly range", () => {
  const result = aggregateLocationData(
    { query: "Test", label: "Test", latitude: 1, longitude: 2 },
    { hourly: { time: ["2026-08-06T11:00"], temperature_2m: [18.4] } },
    { hourly: {} },
    "1h"
  );
  assert.equal(result.rows[0].temperatureAvg, 18.4);
  assert.equal(result.rows[0].temperatureMin, null);
  assert.equal(result.rows[0].temperatureMax, null);
  assert.equal(result.rows[0].temperatureSampleCount, 1);
});

test("national station observations replace Open-Meteo temperature per bucket and preserve real ranges", () => {
  const result = aggregateLocationData(
    { query: "Vienna", label: "Vienna", latitude: 48.2, longitude: 16.3 },
    { hourly: { time: ["2026-08-06T11:00", "2026-08-06T12:00"], temperature_2m: [18, 19] } },
    { hourly: {} },
    "1h",
    {},
    { kind: "historical" },
    {
      source: { name: "Test provider", stationName: "Test station", stationDistanceKm: 4.2 },
      observations: [
        { time: "2026-08-06T11:10", avg: 17, min: 16.8, max: 17.2, sampleCount: 1, explicitRange: true },
        { time: "2026-08-06T11:20", avg: 18, min: 17.7, max: 18.4, sampleCount: 1, explicitRange: true }
      ]
    }
  );
  assert.equal(result.rows[0].temperatureMin, 16.8);
  assert.equal(result.rows[0].temperatureAvg, 17.5);
  assert.equal(result.rows[0].temperatureMax, 18.4);
  assert.equal(result.rows[0].temperatureSourceKind, "national-station");
  assert.equal(result.rows[0].temperatureStationName, "Test station");
  assert.equal(result.rows[0].temperatureStationDistanceKm, 4.2);
  assert.equal(result.rows[0].temperatureProviderName, "Test provider");
  assert.equal(result.rows[1].temperatureAvg, 19);
  assert.equal(result.rows[1].temperatureMin, null);
  assert.equal(result.rows[1].temperatureSourceKind, "open-meteo");
  assert.equal(result.rows[1].temperatureStationName, null);
});

test("multiple sub-hourly station samples form a range without explicit extrema", () => {
  const [row] = aggregateLocationData(
    { query: "Helsinki", label: "Helsinki", latitude: 60.1, longitude: 24.9 },
    { hourly: { time: ["2026-08-06T11:00"], temperature_2m: [99] } },
    { hourly: {} },
    "1h",
    {},
    { kind: "historical" },
    { observations: [
      { time: "2026-08-06T11:00", avg: 10, sampleCount: 1, explicitRange: false },
      { time: "2026-08-06T11:10", avg: 13, sampleCount: 1, explicitRange: false }
    ] }
  ).rows;
  assert.equal(row.temperatureMin, 10);
  assert.equal(row.temperatureAvg, 11.5);
  assert.equal(row.temperatureMax, 13);
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
