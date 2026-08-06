import test from "node:test";
import assert from "node:assert/strict";
import { formatDirection, formatNumber } from "../src/charts.js";

test("table value formatting matches the prototype", () => {
  assert.equal(formatNumber(null, 1), "n/a");
  assert.equal(formatNumber(12.34, 1), "12,3");
  assert.equal(formatDirection(null), "n/a");
  assert.equal(formatDirection(239.6), "240 deg SW");
});
