export const STORAGE_KEY = "weathercompare-settings-v1";
export const MAX_LOCATIONS = 20;

export const ENDPOINTS = Object.freeze({
  weather: "https://archive-api.open-meteo.com/v1/archive",
  forecast: "https://api.open-meteo.com/v1/forecast",
  geocode: "https://geocoding-api.open-meteo.com/v1/search",
  reverseGeocode: "https://geocoding-api.open-meteo.com/v1/reverse",
  air: "https://air-quality-api.open-meteo.com/v1/air-quality"
});

export const PRESETS = Object.freeze({ "7d": 7, "15d": 15, "21d": 21 });
export const CONTINUOUS_PRESET = "7d7f";

const colors = [
  "#0f5db8", "#12715c", "#c05621", "#9b2c5f", "#58657a",
  "#6b46c1", "#00738f", "#8a6a0b", "#b4333c", "#2c7a7b"
];

export const SERIES_STYLES = Object.freeze(Array.from({ length: MAX_LOCATIONS }, (_, index) => ({
  color: colors[index % colors.length],
  marker: index < colors.length ? "circle" : "diamond"
})));

const bands = (limits) => {
  const labels = ["Good", "Fair", "Moderate", "Poor", "Very poor", "Extremely poor"];
  const fills = ["#eff5f1", "#f2f0e7", "#f7f0de", "#f7e8dc", "#f2dddd", "#ead4d4"];
  return labels.map((label, index) => ({
    label,
    start: index === 0 ? 0 : limits[index - 1],
    end: index < limits.length ? limits[index] : Infinity,
    fill: fills[index]
  }));
};

export const AIR_QUALITY_BANDS = Object.freeze({
  aqiAvg: bands([20, 40, 60, 80, 100]),
  pm25Avg: bands([5, 15, 50, 90, 140]),
  pm10Avg: bands([15, 45, 120, 195, 270]),
  no2Avg: bands([10, 25, 60, 100, 150]),
  ozoneAvg: bands([60, 100, 120, 160, 180]),
  so2Avg: bands([20, 40, 125, 190, 275])
});

export const METRIC_GROUPS = Object.freeze([
  {
    id: "temperature",
    eyebrow: "Temperature",
    title: "Min, average, and max",
    description: "Each location gets a min-to-max segment with the average marked inside each bucket.",
    chartTitle: "Temperature range per bucket",
    tableTitle: "Temperature summary",
    metrics: [{ id: "temperatureAvg", title: "Temperature range per bucket", unit: "°C", type: "range", minKey: "temperatureMin", maxKey: "temperatureMax", digits: 1 }],
    tableColumns: [
      { key: "temperatureMin", label: "Tmin (°C)", digits: 1, heatGroup: "temperature" },
      { key: "temperatureAvg", label: "Tavg (°C)", digits: 1, heatGroup: "temperature" },
      { key: "temperatureMax", label: "Tmax (°C)", digits: 1, heatGroup: "temperature" }
    ]
  },
  {
    id: "precipitation",
    eyebrow: "Precipitation",
    title: "Rain and snow",
    description: "Precipitation is shown in millimetres and snowfall in centimetres.",
    tableTitle: "Precipitation and snow summary",
    metrics: [
      { id: "precipitationSum", title: "Precipitation sum", unit: "mm", digits: 1, floorZero: true },
      { id: "snowfallSum", title: "Snowfall sum", unit: "cm", digits: 2, floorZero: true },
      { id: "precipitationProbabilityMax", title: "Precipitation probability", unit: "%", digits: 0, floorZero: true, forecastOnly: true }
    ],
    tableColumns: [
      { key: "precipitationSum", label: "Precip. (mm)", digits: 1 },
      { key: "snowfallSum", label: "Snow (cm)", digits: 2 },
      { key: "precipitationProbabilityMax", label: "Chance (%)", digits: 0, forecastOnly: true }
    ]
  },
  {
    id: "sunshine",
    eyebrow: "Sunshine",
    title: "Duration and UV",
    description: "Sunshine duration is aggregated from hourly sunshine seconds, with UV index shown as bucket averages and peaks.",
    tableTitle: "Sunshine and UV summary",
    metrics: [
      { id: "sunshineHours", title: "Sunshine duration", unit: "h", digits: 2, floorZero: true },
      { id: "uvAvg", title: "UV index average", unit: "index", digits: 2, floorZero: true }
    ],
    tableColumns: [
      { key: "sunshineHours", label: "Sun (h)", digits: 2 },
      { key: "uvAvg", label: "UV avg", digits: 2, heatGroup: "uv" },
      { key: "uvMax", label: "UV max", digits: 2, heatGroup: "uv" }
    ]
  },
  {
    id: "wind",
    eyebrow: "Wind",
    title: "Speed, gusts, and direction",
    description: "Mean wind speed and peak gusts are charted; dominant direction is included in tables.",
    tableTitle: "Wind summary",
    metrics: [
      { id: "windSpeedAvg", title: "Mean wind speed", unit: "km/h", digits: 1, floorZero: true },
      { id: "windGustMax", title: "Peak gust", unit: "km/h", digits: 1, floorZero: true }
    ],
    tableColumns: [
      { key: "windSpeedAvg", label: "Avg (km/h)", digits: 1, heatGroup: "wind-speed" },
      { key: "windGustMax", label: "Gust (km/h)", digits: 1, heatGroup: "wind-speed" },
      { key: "windDirection", label: "Direction", formatter: "direction" }
    ]
  },
  {
    id: "air",
    eyebrow: "Air quality",
    title: "Aggregate and indicators",
    description: "European AQI is combined with PM2.5, PM10, NO2, O3, and SO2 concentrations. Shaded graph bands use EEA reference thresholds.",
    tableTitle: "Air-quality summary",
    metrics: [
      { id: "aqiAvg", title: "European AQI average", unit: "index", digits: 1, floorZero: true, bands: AIR_QUALITY_BANDS.aqiAvg },
      { id: "pm25Avg", title: "PM2.5 average", unit: "µg/m³", digits: 1, floorZero: true, bands: AIR_QUALITY_BANDS.pm25Avg },
      { id: "pm10Avg", title: "PM10 average", unit: "µg/m³", digits: 1, floorZero: true, bands: AIR_QUALITY_BANDS.pm10Avg },
      { id: "no2Avg", title: "NO2 average", unit: "µg/m³", digits: 1, floorZero: true, bands: AIR_QUALITY_BANDS.no2Avg },
      { id: "ozoneAvg", title: "O3 average", unit: "µg/m³", digits: 1, floorZero: true, bands: AIR_QUALITY_BANDS.ozoneAvg },
      { id: "so2Avg", title: "SO2 average", unit: "µg/m³", digits: 1, floorZero: true, bands: AIR_QUALITY_BANDS.so2Avg }
    ],
    tableColumns: [
      { key: "aqiAvg", label: "AQI avg", digits: 1 },
      { key: "aqiMax", label: "AQI max", digits: 1 },
      { key: "pm25Avg", label: "PM2.5", digits: 1 },
      { key: "pm10Avg", label: "PM10", digits: 1 },
      { key: "no2Avg", label: "NO2", digits: 1 },
      { key: "ozoneAvg", label: "O3", digits: 1 },
      { key: "so2Avg", label: "SO2", digits: 1 }
    ]
  }
]);
