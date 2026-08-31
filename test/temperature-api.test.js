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

test("Météo-France uses official hourly extrema from the resolved department", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://portail-api.meteofrance.fr/token") {
      return Response.json({ access_token: "test-access-token" });
    }
    if (url.startsWith("https://geo.api.gouv.fr/communes?")) {
      return Response.json([{ codeDepartement: "35" }]);
    }
    if (url.includes("/DPClim/v1/liste-stations/horaire")) {
      return Response.json([{ id: 35281001, nom: "RENNES-ST JACQUES", lat: 48.0688, lon: -1.734 }]);
    }
    if (url.includes("/DPClim/v1/commande-station/horaire")) {
      return Response.json({ elaboreProduitAvecDemandeResponse: { return: "order-1" } }, { status: 202 });
    }
    if (url.includes("/DPClim/v1/commande/fichier")) {
      return new Response("NUM_POSTE;AAAAMMJJHH;T;TN;TX\n35281001;2026083000;15.2;14.6;15.8\n35281001;2026083001;15.7;15.0;16.3\n");
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const response = await handleTemperatureRequest(new Request(
      "https://weather.test/api/temperature-range?countryCode=FR&latitude=48.1173&longitude=-1.6778&timezone=Europe%2FParis&startDate=2026-08-30&endDate=2026-08-30&granularity=1h"
    ), { METEOFRANCE_APPLICATION_ID: "test-application-id" });
    const payload = await response.json();
    assert.equal(payload.source.name, "Météo-France");
    assert.equal(payload.source.stationName, "RENNES-ST JACQUES");
    assert.equal(payload.source.rangeMethod, "official hourly extrema");
    assert.equal(payload.observations.length, 2);
    assert.deepEqual(payload.observations[0], {
      time: "2026-08-30T01:59:59",
      avg: 15.2,
      min: 14.6,
      max: 15.8,
      sampleCount: 1,
      explicitRange: true
    });
    assert.ok(urls.some((url) => url.includes("id-departement=35")));
    assert.ok(urls.some((url) => url.includes("parametre=temperature")));
    const orderUrl = new URL(urls.find((url) => url.includes("/commande-station/horaire")));
    assert.equal(orderUrl.searchParams.get("date-deb-periode"), "2026-08-29T10:00:00Z");
    assert.equal(orderUrl.searchParams.get("date-fin-periode"), "2026-08-31T14:00:00Z");
    assert.ok(urls.every((url) => !url.includes("/DPObs/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
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
