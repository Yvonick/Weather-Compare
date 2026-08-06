export const EXPORT_HEADERS = [
  "location_query", "location_label", "latitude", "longitude", "timezone", "bucket_key", "bucket_label",
  "temperature_min_c", "temperature_avg_c", "temperature_max_c", "precipitation_sum_mm", "snowfall_sum_cm",
  "sunshine_hours", "uv_avg", "uv_max", "wind_speed_avg_kmh", "wind_gust_max_kmh", "wind_direction_deg",
  "aqi_avg", "aqi_max", "pm25_avg_ugm3", "pm10_avg_ugm3", "no2_avg_ugm3", "ozone_avg_ugm3", "so2_avg_ugm3"
];

export function buildExportRows(series) {
  return series.flatMap((location) => location.rows.map((row) => ({
    location_query: location.query,
    location_label: location.label,
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone,
    bucket_key: row.key,
    bucket_label: row.label,
    temperature_min_c: row.temperatureMin,
    temperature_avg_c: row.temperatureAvg,
    temperature_max_c: row.temperatureMax,
    precipitation_sum_mm: row.precipitationSum,
    snowfall_sum_cm: row.snowfallSum,
    sunshine_hours: row.sunshineHours,
    uv_avg: row.uvAvg,
    uv_max: row.uvMax,
    wind_speed_avg_kmh: row.windSpeedAvg,
    wind_gust_max_kmh: row.windGustMax,
    wind_direction_deg: row.windDirection,
    aqi_avg: row.aqiAvg,
    aqi_max: row.aqiMax,
    pm25_avg_ugm3: row.pm25Avg,
    pm10_avg_ugm3: row.pm10Avg,
    no2_avg_ugm3: row.no2Avg,
    ozone_avg_ugm3: row.ozoneAvg,
    so2_avg_ugm3: row.so2Avg
  })));
}

const escapeCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function buildCsv(series) {
  const rows = buildExportRows(series);
  return `\uFEFF${[EXPORT_HEADERS.join(","), ...rows.map((row) => EXPORT_HEADERS.map((header) => escapeCell(row[header])).join(","))].join("\n")}`;
}

export function exportFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `weathercompare-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.csv`;
}

export function downloadCsv(series, documentRef = document) {
  const blob = new Blob([buildCsv(series)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = exportFilename();
  documentRef.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return buildExportRows(series).length;
}
