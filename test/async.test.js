import test from "node:test";
import assert from "node:assert/strict";
import { settleWithConcurrency } from "../src/async.js";

test("concurrent settling preserves order and isolates failures", async () => {
  const results = await settleWithConcurrency([3, 1, 2], async (value) => {
    if (value === 1) throw new Error("expected failure");
    return value * 2;
  }, 2);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal(results[0].value, 6);
  assert.equal(results[1].reason.message, "expected failure");
  assert.equal(results[2].value, 4);
});

test("concurrent settling respects the requested worker limit", async () => {
  let active = 0;
  let peak = 0;
  await settleWithConcurrency([1, 2, 3, 4, 5, 6], async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve(value);
    active -= 1;
  }, 3);
  assert.equal(peak, 3);
});
