import { fetchLta } from "../lta/client";
import { LTA_ENDPOINTS } from "../lta/endpoints";
import {
  CrowdLevel,
  LtaPlatformCrowdForecastResponse,
  LtaPlatformCrowdRealtimeResponse,
} from "../types/lta";
import { CrowdLevelDto, CrowdReportInput, StationCrowdingDto } from "../types/api";
import { TrainLineCode } from "../lta/endpoints";
import { crowdReportRepository } from "../repositories/crowdReportRepository";

// LTA documents this feed as refreshing roughly every ~30 min, which is why
// the app is expected to show an explicit staleness indicator rather than
// implying it's live-live (see the write-up's UC 5.0 notes). We cache at the
// same cadence so we're not polling LTA far more often than the data itself
// changes.
const CROWD_CACHE_TTL_SECONDS = 30 * 60;

const LEVEL_MAP: Record<CrowdLevel, CrowdLevelDto> = {
  l: "low",
  m: "moderate",
  h: "high",
};

function toDtoLevel(level: CrowdLevel | string | undefined): CrowdLevelDto {
  if (!level) return "unknown";
  return LEVEL_MAP[level as CrowdLevel] ?? "unknown";
}

export async function getStationCrowding(
  trainLine: TrainLineCode,
  station: string
): Promise<StationCrowdingDto> {
  const [realtime, forecast] = await Promise.all([
    fetchLta<LtaPlatformCrowdRealtimeResponse>(LTA_ENDPOINTS.PLATFORM_CROWD_REALTIME, {
      params: { TrainLine: trainLine },
      cacheTtlSeconds: CROWD_CACHE_TTL_SECONDS,
    }),
    fetchLta<LtaPlatformCrowdForecastResponse>(LTA_ENDPOINTS.PLATFORM_CROWD_FORECAST, {
      params: { TrainLine: trainLine },
      cacheTtlSeconds: CROWD_CACHE_TTL_SECONDS,
    }),
  ]);

  const liveEntry = (realtime.value ?? []).find(
    (e) => e.Station.toUpperCase() === station.toUpperCase()
  );
  const forecastEntry = (forecast.value ?? []).find(
    (e) => e.Station.toUpperCase() === station.toUpperCase()
  );

  const asOf = liveEntry?.StartTime ? new Date(liveEntry.StartTime) : null;
  const staleForSeconds = asOf ? Math.max(0, Math.round((Date.now() - asOf.getTime()) / 1000)) : null;

  const crowdsourced = crowdReportRepository
    .listActiveForStation(station)
    .map((r) => ({
      level: r.level === "medium" ? ("moderate" as const) : (r.level as "low" | "high"),
      reportedAt: r.reportedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));

  return {
    station,
    live: {
      level: toDtoLevel(liveEntry?.CrowdLevel),
      asOf: asOf ? asOf.toISOString() : null,
      staleForSeconds,
    },
    forecast: (forecastEntry?.Interval ?? []).map((i) => ({
      start: i.Start,
      end: i.End,
      level: toDtoLevel(i.CrowdLevel),
    })),
    crowdsourced,
    fetchedAt: new Date().toISOString(),
  };
}

export function reportCrowding(input: CrowdReportInput) {
  return crowdReportRepository.add(input.station, input.level);
}
