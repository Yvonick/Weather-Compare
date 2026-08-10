export function getBucketKey(timeString, granularity) {
  const [date, clock = "00:00"] = timeString.split("T");
  if (granularity === "day") return date;
  const size = granularity === "12h" ? 12 : granularity === "6h" ? 6 : 3;
  const hour = Number(clock.slice(0, 2));
  return `${date}T${String(Math.floor(hour / size) * size).padStart(2, "0")}:00`;
}

export function formatBucketLabel(key, granularity = "day") {
  const [date, time] = key.split("T");
  const [year, month, day] = date.split("-");
  const dateLabel = `${day}/${month}/${year}`;
  if (!time || granularity === "day") return dateLabel;
  const startHour = Number(time.slice(0, 2));
  const duration = granularity === "12h" ? 12 : granularity === "6h" ? 6 : 3;
  const endHour = Math.min(23, startHour + duration - 1);
  return `${dateLabel} ${String(startHour).padStart(2, "0")}:00-${String(endHour).padStart(2, "0")}:59`;
}

function emptyBucket(key, granularity) {
  return {
    key,
    label: formatBucketLabel(key, granularity),
    temperatureMin: Infinity, temperatureMax: -Infinity, temperatureSum: 0, temperatureCount: 0,
    precipitationSum: 0, precipitationCount: 0,
    snowfallSum: 0, snowfallCount: 0,
    sunshineSeconds: 0, sunshineCount: 0,
    precipitationProbabilityMax: -Infinity,
    uvSum: 0, uvCount: 0, uvMax: -Infinity,
    windSpeedSum: 0, windSpeedCount: 0, windGustMax: -Infinity,
    windDirectionSin: 0, windDirectionCos: 0, windDirectionCount: 0,
    aqiSum: 0, aqiCount: 0, aqiMax: -Infinity,
    pm25Sum: 0, pm25Count: 0, pm10Sum: 0, pm10Count: 0,
    no2Sum: 0, no2Count: 0, ozoneSum: 0, ozoneCount: 0, so2Sum: 0, so2Count: 0
  };
}

const finiteAt = (array, index) => Array.isArray(array) && Number.isFinite(array[index]) ? array[index] : null;
const addAverage = (bucket, prefix, value) => {
  if (value === null) return;
  bucket[`${prefix}Sum`] += value;
  bucket[`${prefix}Count`] += 1;
};

function ingestWeather(hourly = {}, ensureBucket) {
  (hourly.time || []).forEach((time, index) => {
    const bucket = ensureBucket(time);
    const temperature = finiteAt(hourly.temperature_2m, index);
    const precipitation = finiteAt(hourly.precipitation, index);
    const snowfall = finiteAt(hourly.snowfall, index);
    const sunshine = finiteAt(hourly.sunshine_duration, index);
    const speed = finiteAt(hourly.wind_speed_10m, index);
    const gust = finiteAt(hourly.wind_gusts_10m, index);
    const direction = finiteAt(hourly.wind_direction_10m, index);

    if (temperature !== null) {
      bucket.temperatureMin = Math.min(bucket.temperatureMin, temperature);
      bucket.temperatureMax = Math.max(bucket.temperatureMax, temperature);
      bucket.temperatureSum += temperature;
      bucket.temperatureCount += 1;
    }
    if (precipitation !== null) {
      bucket.precipitationSum += precipitation;
      bucket.precipitationCount += 1;
    }
    if (snowfall !== null) {
      bucket.snowfallSum += snowfall;
      bucket.snowfallCount += 1;
    }
    if (sunshine !== null) {
      bucket.sunshineSeconds += sunshine;
      bucket.sunshineCount += 1;
    }
    const precipitationProbability = finiteAt(hourly.precipitation_probability, index);
    if (precipitationProbability !== null) {
      bucket.precipitationProbabilityMax = Math.max(bucket.precipitationProbabilityMax, precipitationProbability);
    }
    addAverage(bucket, "windSpeed", speed);
    if (gust !== null) bucket.windGustMax = Math.max(bucket.windGustMax, gust);
    if (direction !== null) {
      const radians = direction * Math.PI / 180;
      bucket.windDirectionSin += Math.sin(radians);
      bucket.windDirectionCos += Math.cos(radians);
      bucket.windDirectionCount += 1;
    }
  });
}

function ingestAir(hourly = {}, ensureBucket) {
  (hourly.time || []).forEach((time, index) => {
    const bucket = ensureBucket(time);
    const aqi = finiteAt(hourly.european_aqi, index);
    const uv = finiteAt(hourly.uv_index, index);
    addAverage(bucket, "aqi", aqi);
    if (aqi !== null) bucket.aqiMax = Math.max(bucket.aqiMax, aqi);
    addAverage(bucket, "pm25", finiteAt(hourly.pm2_5, index));
    addAverage(bucket, "pm10", finiteAt(hourly.pm10, index));
    addAverage(bucket, "no2", finiteAt(hourly.nitrogen_dioxide, index));
    addAverage(bucket, "ozone", finiteAt(hourly.ozone, index));
    addAverage(bucket, "so2", finiteAt(hourly.sulphur_dioxide, index));
    addAverage(bucket, "uv", uv);
    if (uv !== null) bucket.uvMax = Math.max(bucket.uvMax, uv);
  });
}

function average(bucket, prefix) {
  return bucket[`${prefix}Count`] ? bucket[`${prefix}Sum`] / bucket[`${prefix}Count`] : null;
}

function finalize(bucket) {
  const direction = bucket.windDirectionCount
    ? (Math.atan2(bucket.windDirectionSin / bucket.windDirectionCount, bucket.windDirectionCos / bucket.windDirectionCount) * 180 / Math.PI + 360) % 360
    : null;
  return {
    key: bucket.key,
    label: bucket.label,
    temperatureMin: bucket.temperatureCount ? bucket.temperatureMin : null,
    temperatureAvg: average(bucket, "temperature"),
    temperatureMax: bucket.temperatureCount ? bucket.temperatureMax : null,
    precipitationSum: bucket.precipitationCount ? bucket.precipitationSum : null,
    snowfallSum: bucket.snowfallCount ? bucket.snowfallSum : null,
    sunshineHours: bucket.sunshineCount ? bucket.sunshineSeconds / 3600 : null,
    precipitationProbabilityMax: Number.isFinite(bucket.precipitationProbabilityMax) ? bucket.precipitationProbabilityMax : null,
    uvAvg: average(bucket, "uv"),
    uvMax: bucket.uvCount ? bucket.uvMax : null,
    windSpeedAvg: average(bucket, "windSpeed"),
    windGustMax: Number.isFinite(bucket.windGustMax) ? bucket.windGustMax : null,
    windDirection: direction,
    aqiAvg: average(bucket, "aqi"),
    aqiMax: bucket.aqiCount ? bucket.aqiMax : null,
    pm25Avg: average(bucket, "pm25"),
    pm10Avg: average(bucket, "pm10"),
    no2Avg: average(bucket, "no2"),
    ozoneAvg: average(bucket, "ozone"),
    so2Avg: average(bucket, "so2")
  };
}

export function forecastConfidenceForLead(leadDays) {
  if (!Number.isFinite(leadDays) || leadDays < 0) return null;
  if (leadDays <= 2) return "higher";
  if (leadDays <= 5) return "medium";
  return "lower";
}

const daysBetween = (leftDate, rightDate) => Math.round(
  (Date.parse(`${leftDate}T00:00:00Z`) - Date.parse(`${rightDate}T00:00:00Z`)) / 86400000
);

export function aggregateLocationData(resolved, weather, air, granularity, sourceLabels = {}, period = {}) {
  const buckets = new Map();
  const ensureBucket = (time) => {
    const key = getBucketKey(time, granularity);
    if (!buckets.has(key)) buckets.set(key, emptyBucket(key, granularity));
    return buckets.get(key);
  };
  ingestWeather(weather.hourly, ensureBucket);
  ingestAir(air.hourly, ensureBucket);
  return {
    ...resolved,
    timezone: weather.timezone || air.timezone || resolved.timezone || "auto",
    weatherSource: sourceLabels.weather || null,
    airSource: sourceLabels.air || null,
    rows: [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key)).map(finalize).map((row) => {
      const dataKind = period.kind === "forecast" ? "forecast" : "historical";
      const forecastLeadDays = dataKind === "forecast" && period.forecastStartDate
        ? Math.max(0, daysBetween(row.key.slice(0, 10), period.forecastStartDate))
        : null;
      return {
        ...row,
        dataKind,
        forecastLeadDays,
        forecastConfidence: forecastConfidenceForLead(forecastLeadDays)
      };
    })
  };
}

export function collectBucketKeys(series) {
  return [...new Set(series.flatMap((location) => location.rows.map((row) => row.key)))].sort();
}
