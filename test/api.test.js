import test from "node:test";
import assert from "node:assert/strict";
import { buildLocationSuggestion, localTemperatureApiFallbackUrls, rankLocationCandidates, splitTimeline } from "../src/api.js";

const now = new Date("2026-08-10T12:00:00");

test("continuous ranges split cleanly at the present-day boundary", () => {
  assert.deepEqual(splitTimeline({
    preset: "7d7f",
    startDate: "2026-08-03",
    endDate: "2026-08-16"
  }, now), [
    { kind: "historical", startDate: "2026-08-03", endDate: "2026-08-09" },
    { kind: "forecast", startDate: "2026-08-10", endDate: "2026-08-16", forecastStartDate: "2026-08-10" }
  ]);
});

test("historical presets keep their existing all-past request", () => {
  assert.deepEqual(splitTimeline({
    preset: "7d",
    startDate: "2026-08-04",
    endDate: "2026-08-10"
  }, now), [
    { kind: "historical", startDate: "2026-08-04", endDate: "2026-08-10" }
  ]);
});

test("important populated cities outrank tiny exact-name settlements", () => {
  const ranked = rankLocationCandidates([
    { name: "Frankfurt", country: "Germany", country_code: "DE", feature_code: "PPLL", latitude: 49.68, longitude: 10.53 },
    { name: "Frankfurt am Main", country: "Germany", country_code: "DE", feature_code: "PPLA3", population: 650000, latitude: 50.11, longitude: 8.68 },
    { name: "Frankfurt (Oder)", country: "Germany", country_code: "DE", feature_code: "PPL", population: 57015, latitude: 52.34, longitude: 14.55 }
  ], "Frankfurt, Germany");
  assert.equal(ranked[0].name, "Frankfurt am Main");
});

test("country hints take priority over similarly named foreign locations", () => {
  const ranked = rankLocationCandidates([
    { name: "Cambridge", country: "Canada", country_code: "CA", feature_code: "PPL", population: 129920 },
    { name: "Cambridge", country: "United Kingdom", country_code: "GB", feature_code: "PPLA2", population: 145700 }
  ], "Cambridge, GB");
  assert.equal(ranked[0].country_code, "GB");
});

test("population outweighs minor administrative status for namesakes", () => {
  const ranked = rankLocationCandidates([
    { name: "London", country: "Canada", country_code: "CA", feature_code: "PPL", population: 422324 },
    { name: "London", country: "United States", country_code: "US", feature_code: "PPLA2", population: 10060 }
  ], "London");
  assert.equal(ranked[0].country_code, "CA");
});

test("autocomplete suggestions separate primary place, context, and importance metadata", () => {
  const suggestion = buildLocationSuggestion({
    name: "Frankfurt am Main", admin1: "Hesse", admin2: "Regierungsbezirk Darmstadt",
    country: "Germany", country_code: "DE", feature_code: "PPLA3", population: 650000
  });
  assert.equal(suggestion.name, "Frankfurt am Main");
  assert.equal(suggestion.context, "Hesse, Germany");
  assert.equal(suggestion.meta, "Administrative centre · 650k people");
  assert.equal(suggestion.countryCode, "DE");
});

test("local previews can discover a fresh national-range server on nearby ports", () => {
  const primary = new URL("http://127.0.0.1:4173/api/temperature-range?countryCode=DE");
  const alternatives = localTemperatureApiFallbackUrls(primary, "http://127.0.0.1:4173");
  assert.deepEqual(alternatives.map((url) => url.port), ["4174", "4175", "4176", "4177"]);
  assert.equal(localTemperatureApiFallbackUrls(primary, "https://weather.example").length, 0);
});
