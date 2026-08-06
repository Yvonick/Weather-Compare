# Architecture

## Why a static, dependency-free application

The product is entirely client-side and all source APIs support browser requests. A static ES-module application keeps deployment simple, removes a framework/build-chain dependency, and makes the data transformations independently testable. GitHub Pages can serve the repository directly.

## Boundaries

```text
app.js
  ├─ settings.js  URL ↔ normalized settings ↔ browser persistence
  ├─ api.js       user query ↔ Open-Meteo responses
  │    └─ aggregate.js  hourly arrays ↔ deterministic buckets
  ├─ charts.js    loaded series ↔ SVG graphs / tables / pop-out
  └─ export.js    visible series ↔ stable CSV
```

The domain modules do not read DOM state. `app.js` is the only controller and owns the current settings, loaded series, loading flag, and failures.

## Rebuild improvements

- Twenty distinct series styles instead of repeating after location ten.
- No page-level horizontal overflow at narrow widths.
- Data-point `aria-label` values in addition to visual tooltips.
- Native modal dialog with focus restoration.
- URL parsing and normalization are isolated and tested.
- Aggregation is pure and tested, including circular wind direction.
- CSV shape is stable and independent of rendered tables.
- API errors preserve successful sibling requests.
- Location loads use bounded concurrency and retry transient `429`/server responses before surfacing a per-location failure.

## Deliberate compatibility

- Existing share-link parameter names are retained.
- Existing saved-settings key is retained so visitors keep their choices.
- Defaults, presets, units, aggregation rules, threshold bands, and export columns match the observed prototype.
- Reset clears results instead of silently issuing API traffic.
