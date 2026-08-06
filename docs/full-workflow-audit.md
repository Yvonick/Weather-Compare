# Full workflow audit

Audited against the live prototype at `https://d.gildas.ch/weathercompare/` on 6 August 2026.

| Workflow | Result |
| --- | --- |
| Default startup | Fulda and Zurich, past seven days, daily graph view, automatic initial load |
| Location search | Replaced the prototype's invisible native datalist with a visible combobox/listbox; six ranked Open-Meteo suggestions, loading/empty/error feedback, mouse and arrow-key selection |
| Manual location input | Still accepted when no suggestion is selected or search is unavailable |
| Location management | Add/remove up to 20, final-row fallback, hide/unhide, single-series highlight |
| Time controls | 7/15/21-day presets and custom dates; invalid ordering produces an inline error |
| Aggregation | Day, 12h, 6h, and 3h; matched prototype values for a three-location two-day dataset |
| Sub-day labels | Full ranges such as `00:00-11:59`, matching the prototype |
| Loading | Controlled four-location concurrency, bounded retry for transient 429/server responses, successful siblings retained after a failure |
| Graph view | 13 charts, consistent series styling, EEA air-quality bands, focusable data-point tooltips |
| Table view | Five grouped tables; matched prototype row counts and metric values |
| Chart pop-out | Open, zoom in/out/reset, drag-pan, close button, explicit Escape close, focus restoration |
| Persistence | Reload restores locations, visibility, highlight, range, dates, granularity, and view |
| Sharing | Existing prototype URL parameter names round-trip through automated tests |
| CSV export | Existing 25-column schema, UTF-8 BOM, quoting, visible-series filtering, timestamped filename |
| Reset | Restores two default locations and clears loaded panels until the next explicit load |
| Responsive behavior | Search results and chart scrolling stay within a 390px viewport; no page-level horizontal overflow |

## Search defect cause

Both versions fetched suggestions successfully, but the prototype and first rebuild exposed them only through a browser-native `<datalist>`. That UI is browser-dependent, cannot provide a dependable visible result panel, and offered no loading, empty, or error state. The rebuild now renders and owns the complete search interface.
