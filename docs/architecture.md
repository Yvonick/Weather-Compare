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
- Continuous ranges split at the local present-day boundary: completed days come from the archive API and today onward comes from the forecast API.
- Forecast provenance is preserved through aggregation, charts, tables, tooltips, and CSV export.
- Missing sum metrics remain missing instead of being converted to a misleading zero.

## Forecast presentation

The historical and forecast segments share the same date axis. A labeled solid vertical boundary and tinted future region make the transition explicit. Forecast series use dashed lines, hollow markers, and reduced opacity. Forecast table columns use the same tint.

Line color and marker shape belong exclusively to location identity. A dashed plotted line belongs exclusively to forecast status. Chart domains use exact symmetric padding around the displayed values with readable ticks inside that domain; zero is included only when it is part of the data range.

The confidence label is deliberately described as a lead-time guide, not a statistical probability: higher for days 0–2, medium for days 3–5, and lower for day 6 onward. This keeps the prototype honest until ensemble forecast distributions are introduced.

## Deliberate compatibility

- Existing share-link parameter names are retained.
- Existing saved-settings key is retained so visitors keep their choices.
- Defaults, presets, units, aggregation rules, threshold bands, and export columns match the observed prototype.
- Reset clears results instead of silently issuing API traffic.
