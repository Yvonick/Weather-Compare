import test from "node:test";
import assert from "node:assert/strict";
import { calendarDays } from "../src/calendar.js";

test("calendar uses Monday-first complete weeks and includes leap day", () => {
  const days = calendarDays(2024, 1);
  assert.equal(days.length, 42);
  assert.equal(days[0], "2024-01-29");
  assert.ok(days.includes("2024-02-29"));
  assert.ok(!calendarDays(2025, 1).includes("2025-02-29"));
  assert.equal(new Set(days).size, 42);
});

test("calendar crosses the year boundary without losing days", () => {
  const days = calendarDays(2026, 11);
  assert.equal(days[0], "2026-11-30");
  assert.equal(days[41], "2027-01-10");
});
