import test from "node:test";
import assert from "node:assert/strict";
import { splitTimeline } from "../src/api.js";

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
