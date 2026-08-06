import test from "node:test";
import assert from "node:assert/strict";
import { MAX_LOCATIONS, SERIES_STYLES } from "../src/config.js";

test("every supported location slot has a distinct visual style", () => {
  assert.equal(SERIES_STYLES.length, MAX_LOCATIONS);
  const signatures = new Set(SERIES_STYLES.map((style) => `${style.color}|${style.dash}|${style.marker}`));
  assert.equal(signatures.size, MAX_LOCATIONS);
});
