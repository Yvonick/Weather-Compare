import test from "node:test";
import assert from "node:assert/strict";
import { handleTemperatureRequest } from "../server/temperature-api.js";

const requestUrl = (countryCode) => `http://localhost/api/temperature-range?countryCode=${countryCode}&latitude=59.91&longitude=10.75&timezone=Europe%2FOslo&startDate=2026-08-29&endDate=2026-08-29&granularity=1h`;

test("credential-gated providers return a usable fallback response when unconfigured", async () => {
  const response = await handleTemperatureRequest(new Request(requestUrl("NO")));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.source, null);
  assert.deepEqual(payload.observations, []);
  assert.match(payload.notices[0], /FROST_CLIENT_ID/);
});

test("Météo-France fallback names both supported credential modes", async () => {
  const response = await handleTemperatureRequest(new Request(requestUrl("FR")));
  const payload = await response.json();
  assert.equal(payload.source, null);
  assert.match(payload.notices[0], /METEOFRANCE_APPLICATION_ID/);
  assert.match(payload.notices[0], /METEOFRANCE_API_KEY/);
});

test("unsupported countries retain the normalized empty-provider contract", async () => {
  const response = await handleTemperatureRequest(new Request(requestUrl("ES")));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.source, null);
  assert.deepEqual(payload.observations, []);
  assert.match(payload.notices[0], /No national temperature provider/);
});

test("the temperature endpoint rejects mutations", async () => {
  const response = await handleTemperatureRequest(new Request(requestUrl("NO"), { method: "POST" }));
  assert.equal(response.status, 405);
});
