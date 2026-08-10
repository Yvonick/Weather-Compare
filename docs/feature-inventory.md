# Feature inventory

This inventory was produced by systematically exercising the live prototype at `https://d.gildas.ch/weathercompare/` on 6 August 2026. It records behavior rather than copying the prototype's implementation.

## Core workflow

1. Start with Fulda, Germany and Zurich, Switzerland.
2. Select the continuous previous-7/next-7 view, a historical rolling range, or exact start and end dates.
3. Aggregate hourly source data into day, 12-hour, 6-hour, or 3-hour buckets.
4. Load all locations concurrently. Successful locations remain usable when another location fails.
5. Switch the loaded result between graph and table views without refetching.

## Locations

- One to 20 editable location rows.
- Debounced Open-Meteo autocomplete suggestions in a visible accessible listbox, with loading, empty, and error feedback.
- Mouse selection plus Arrow Up/Down, Enter, and Escape keyboard behavior; manual place text remains valid.
- Query disambiguation prefers exact locality/country matches and then larger places.
- Add, remove, hide/unhide, and highlight controls.
- Removing the final row leaves one empty row so the form remains usable.
- Hidden locations disappear from charts, tables, legend, and exports without refetching.
- One highlighted location receives stronger lines and markers while others are subdued.
- Resolved labels include locality/administrative context, coordinates, timezone, and source-grid labels.
- Each of 20 slots has a stable, distinguishable color/dash combination in this rebuild.

## Metrics and aggregation

Hourly data is fetched from Open-Meteo's historical, forecast, and air-quality endpoints in the resolved location timezone.

| Group | Graphs | Table-only values | Aggregation |
| --- | --- | --- | --- |
| Temperature | Minimum/average/maximum range | — | min, arithmetic mean, max |
| Precipitation | Rain, snowfall, forecast precipitation probability | — | sum; probability max |
| Sunshine | Sunshine duration, average UV | maximum UV | sunshine seconds to hours; UV mean/max |
| Wind | Mean speed, peak gust | dominant direction | speed mean; gust max; circular direction mean |
| Air quality | European AQI, PM2.5, PM10, NO2, O3, SO2 averages | maximum AQI | mean; AQI max |

The graph view contains 13 charts. Temperature uses min-to-max whiskers with average markers. Air-quality graphs include EEA category guide bands and legends. Graph points expose focusable hover/focus tooltips. Long timelines scroll horizontally.

## Continuous forecast timeline

- The default range joins the previous seven complete days to today plus the next six forecast days.
- A labeled vertical line marks the historical/forecast boundary and the future region has a light tint.
- Each location keeps the same color and marker shape across the complete timeline; dashed lines are reserved for forecasts, whose markers are hollow and whose lines have reduced opacity.
- Forecast table rows are tinted and carry a forecast badge.
- Forecast tooltips and table badges show a lead-time confidence guide: higher at 0–2 days, medium at 3–5 days, and lower from day 6.
- The interface explicitly says this guide is based on lead time and is not an ensemble-derived probability.
- Forecast provenance, confidence, and lead days are included in CSV exports.
- No best/worst location ranking is added.

## Tables

- Five tables mirror the metric groups.
- Two-tier headers group columns by resolved location.
- Rows are the union of time buckets across loaded locations.
- Missing values render as an em dash.
- Dates are shown day-first; sub-day rows include the bucket start time.
- Wind direction combines degrees with an eight-point compass label.

## Chart pop-out

- Every graph can open in a modal dialog.
- Zoom in, zoom out, and reset controls.
- Both axes grow with zoom.
- The enlarged chart can be panned by dragging.
- Close returns focus to the originating chart button.

## Persistence and sharing

- Locations, hidden state, highlight, range, dates, granularity, and view are stored locally.
- URL parameters override saved settings.
- Share links serialize repeated `location`/`hidden` pairs plus `preset`, `start`, `end`, `granularity`, `view`, and optional `highlight`.
- Opening a share link restores state and loads automatically.
- Reset restores the two default locations and seven-day/day/graph settings, clears results, and waits for an explicit reload.

## Export

CSV export contains one row per visible location and bucket. The stable columns are:

`location_query`, `location_label`, `latitude`, `longitude`, `timezone`, `bucket_key`, `bucket_label`, `data_kind`, `forecast_confidence`, `forecast_lead_days`, `temperature_min_c`, `temperature_avg_c`, `temperature_max_c`, `precipitation_sum_mm`, `snowfall_sum_cm`, `precipitation_probability_max_pct`, `sunshine_hours`, `uv_avg`, `uv_max`, `wind_speed_avg_kmh`, `wind_gust_max_kmh`, `wind_direction_deg`, `aqi_avg`, `aqi_max`, `pm25_avg_ugm3`, `pm10_avg_ugm3`, `no2_avg_ugm3`, `ozone_avg_ugm3`, `so2_avg_ugm3`.

The download is UTF-8 CSV with a BOM and a timestamped filename.

## Validation and failure states

- At least one non-empty location is required.
- No more than 20 locations.
- Both dates must be valid and start must not follow end.
- During loading, load/add controls are disabled.
- Per-location geocoding or API failures are listed while successful data stays visible.
- If every request fails, all metric panels show a clear empty state.
- Export explains whether data is absent or all loaded locations are hidden.

## Visual and responsive behavior

- Monospace editorial style, white page, pale panels, dark text, restrained green primary action.
- Desktop: 400px control/legend rail with a fluid dashboard.
- Tablet/mobile: single-column flow; location actions wrap under the input.
- Chart areas remain horizontally scrollable while the page itself does not overflow.
- The live prototype's mobile page overflow and repeated 10-style palette are intentionally corrected.
