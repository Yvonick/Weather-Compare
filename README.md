# Weather Compare

A dependency-free web application for comparing historical and forecast weather and air-quality data across up to 20 places. The default view joins the previous seven complete days to a seven-day forecast on one continuous timeline. It uses the public Open-Meteo APIs and can be hosted as static files, including on GitHub Pages and GPT Sites.

## Run locally

```powershell
npm.cmd start
```

Then open `http://localhost:4173`.

You can also open `index.html` directly. The committed `app.bundle.js` is a classic browser bundle so the location controls work even when a file preview does not support ES modules. Running `npm.cmd start` remains the preferred local workflow.

## Test

```powershell
npm.cmd test
npm.cmd run check
```

`npm.cmd run build` also creates the Cloudflare Worker-compatible Sites artifact in `dist/server/index.js`.

## Project structure

- `src/api.js` — Open-Meteo geocoding, historical, forecast, air-quality, and reverse-geocoding requests
- `src/aggregate.js` — deterministic hourly-to-bucket aggregation
- `src/settings.js` — defaults, validation, persistence, and share-link serialization
- `src/charts.js` — SVG charts, tables, tooltips, and chart pop-outs
- `src/export.js` — stable CSV export schema
- `src/app.js` — UI state and event orchestration
- `scripts/build.mjs` — creates the browser-compatible `app.bundle.js` entry point
- `docs/feature-inventory.md` — reverse-engineered product behavior
- `docs/architecture.md` — rebuild decisions and known prototype issues addressed
- `docs/full-workflow-audit.md` — verified prototype-to-rebuild workflow parity

No runtime secrets or third-party packages are required. `npm.cmd start` and `npm.cmd run check` rebuild the browser bundle automatically.
