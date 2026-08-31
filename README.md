# Weather Compare

A dependency-free web application for comparing historical and forecast weather and air-quality data across up to 20 places. The default view joins the previous seven complete days to a seven-day forecast on one continuous timeline. Weather and air quality come from Open-Meteo. Historical temperature ranges use higher-frequency national station observations where possible, with an automatic per-bucket Open-Meteo fallback.

## Run locally

```powershell
npm.cmd start
```

Then open the local URL printed by the server. It starts at `http://localhost:4173`; if an older preview is already using that port, it automatically selects the next available preview port. The browser can discover the active local temperature service across these nearby ports, so national ranges do not silently disappear behind a stale static preview.

You can also open `index.html` directly, but the local server is required for national station ranges. The committed `app.bundle.js` is a classic browser bundle so the core controls still work in previews that do not support ES modules.

## Temperature range sources

Public adapters need no credentials: UK Met Office, DMI Denmark, DWD Germany, MeteoSwiss, GeoSphere Austria, and FMI Finland. MET Norway Frost, Météo-France, and KNMI require free provider credentials. Configure those as environment variables before starting the server:

```bash
export FROST_CLIENT_ID="..."
export METEOFRANCE_APPLICATION_ID="..."
export KNMI_API_KEY="..."
npm start
```

For Météo-France, subscribe the application to the Climatological Data API. The server exchanges `METEOFRANCE_APPLICATION_ID` for short-lived OAuth2 tokens automatically, uses the official French geographic API and climatology catalog to select nearby stations, then reads the quality-controlled hourly `T`, `TN`, and `TX` fields through data.gouv.fr's public tabular API. DPClim remains a fallback. The six-minute historical product is precipitation-only. `METEOFRANCE_API_KEY` remains available for a manually generated API key, but that key normally expires and is less suitable for a deployed app.

See `.env.example` for the variable names. Credentials stay on the server; the browser only calls the same-origin `/api/temperature-range` endpoint. If a provider is unconfigured, unavailable, outside its recent-data window, or has no nearby station, affected buckets remain populated from Open-Meteo and the UI explains the fallback. The free Met Office one-minute feed is a rolling seven-day dataset, so older UK periods use Open-Meteo unless a separate archival integration is configured.

## Test

```powershell
npm.cmd test
npm.cmd run check
```

`npm.cmd run build` also creates the Cloudflare Worker-compatible Sites artifact in `dist/server/index.js`.

## Project structure

- `src/api.js` — Open-Meteo requests plus national-range orchestration
- `src/aggregate.js` — deterministic provider-precedence and time-bucket aggregation
- `server/temperature-api.js` — normalized national station adapters and fallback contract
- `server/uk-stations.js` — generated Met Office station catalog
- `src/settings.js` — defaults, validation, persistence, and share-link serialization
- `src/charts.js` — SVG charts, tables, tooltips, and chart pop-outs
- `src/export.js` — stable CSV export schema
- `src/app.js` — UI state and event orchestration
- `scripts/build.mjs` — creates the browser-compatible `app.bundle.js` entry point
- `scripts/update-uk-stations.mjs` — refreshes the generated UK station catalog
- `docs/feature-inventory.md` — reverse-engineered product behavior
- `docs/architecture.md` — rebuild decisions and known prototype issues addressed
- `docs/full-workflow-audit.md` — verified prototype-to-rebuild workflow parity

No third-party packages are required. The three optional credential variables only enable their corresponding national adapters; all other behavior and the Open-Meteo fallback work without secrets. `npm.cmd start` and `npm.cmd run check` rebuild the browser bundle automatically.
