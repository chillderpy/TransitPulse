import NodeCache from "node-cache";
import { haversineMeters } from "../routing/graph";

// data.gov.sg's 2-hour weather forecast, split into ~47 named areas across
// Singapore. Public API, no key needed - separate host from LTA DataMall so
// it gets its own tiny fetch/cache rather than going through lta/client.ts.
const WEATHER_URL = "https://api.data.gov.sg/v1/environment/2-hour-weather-forecast";
const CACHE_KEY = "2hr-forecast";
const CACHE_TTL_SECONDS = 5 * 60;
const FETCH_TIMEOUT_MS = 5000;

const cache = new NodeCache({ checkperiod: 60 });

interface AreaMetadata {
  name: string;
  label_location: { latitude: number; longitude: number };
}

interface ForecastItem {
  area: string;
  forecast: string;
}

interface TwoHourForecastResponse {
  area_metadata: AreaMetadata[];
  items: Array<{ valid_period: { start: string; end: string }; forecasts: ForecastItem[] }>;
}

const RAIN_PATTERN = /rain|shower|thundery/i;

async function fetchForecast(): Promise<TwoHourForecastResponse | null> {
  const cached = cache.get<TwoHourForecastResponse>(CACHE_KEY);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(WEATHER_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as TwoHourForecastResponse;
    cache.set(CACHE_KEY, data, CACHE_TTL_SECONDS);
    return data;
  } catch {
    // Weather is an advisory nice-to-have, not core routing - any failure
    // (network, timeout, bad payload) just means no advisory this time.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface WeatherAdvisoryDto {
  area: string;
  forecast: string;
  rainLikely: boolean;
}

/** Nearest data.gov.sg forecast area to a point, or null if the API is unreachable. */
export async function getWeatherNear(lat: number, lon: number): Promise<WeatherAdvisoryDto | null> {
  const data = await fetchForecast();
  if (!data || !data.items?.length) return null;

  const latest = data.items[data.items.length - 1];
  let nearest: { name: string; distance: number } | null = null;
  for (const meta of data.area_metadata) {
    const distance = haversineMeters(lat, lon, meta.label_location.latitude, meta.label_location.longitude);
    if (!nearest || distance < nearest.distance) nearest = { name: meta.name, distance };
  }
  if (!nearest) return null;

  const forecast = latest.forecasts.find((f) => f.area === nearest!.name);
  if (!forecast) return null;

  return {
    area: forecast.area,
    forecast: forecast.forecast,
    rainLikely: RAIN_PATTERN.test(forecast.forecast),
  };
}
