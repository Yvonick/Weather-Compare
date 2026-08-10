import test from "node:test";
import assert from "node:assert/strict";

import { chartScale } from "../src/charts.js";

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
