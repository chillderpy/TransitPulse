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
import { findStationCode, findStationLines } from "../routing/graph";

// The heavy-rail lines the route planner actually covers (see graph.ts) -
// LRT lines are out of scope network-wide, same as everywhere else in this
// codebase, so there's no point querying PCDRealTime for them here.
const ROUTED_TRAIN_LINES: TrainLineCode[] = ["NSL", "EWL", "CCL", "DTL", "TEL", "NEL"];

export class UnknownStationError extends Error {
  constructor(station: string) {
    super(`"${station}" is not a recognised MRT/LRT station name or code.`);
    this.name = "UnknownStationError";
  }
}

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

export async function getStationCrowding(station: string): Promise<StationCrowdingDto> {
  // LTA's crowd feeds key entries by station code (e.g. "NS1") and are
  // queried per line, while the app just takes a station name or code from
  // the user - so resolve the code, then figure out which line(s) actually
  // serve it (an interchange like Jurong East serves more than one).
  const stationCode = findStationCode(station);
  if (!stationCode) throw new UnknownStationError(station);

  const lines = findStationLines(stationCode) as TrainLineCode[];
  if (lines.length === 0) throw new UnknownStationError(station);

  const perLine = await Promise.all(
    lines.map(async (trainLine) => {
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
        (e) => e.Station.toUpperCase() === stationCode.toUpperCase()
      );
      const forecastEntry = (forecast.value ?? [])
        .flatMap((d) => d.Stations ?? [])
        .find((e) => e.Station.toUpperCase() === stationCode.toUpperCase());

      return { liveEntry, forecastEntry };
    })
  );

  // Prefer whichever line actually reported a live reading for this station;
  // interchanges can appear in more than one line's feed.
  const { liveEntry, forecastEntry } = perLine.find((r) => r.liveEntry) ?? perLine[0];

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
    forecast: (forecastEntry?.Interval ?? []).map((i, idx, all) => ({
      start: i.Start,
      end: all[idx + 1]?.Start ?? i.Start,
      level: toDtoLevel(i.CrowdLevel),
    })),
    crowdsourced,
    fetchedAt: new Date().toISOString(),
  };
}

export function reportCrowding(input: CrowdReportInput) {
  return crowdReportRepository.add(input.station, input.level);
}

/**
 * Live crowding level for every station currently reporting one, across all
 * routed lines at once - used by the route planner to steer away from
 * highly-crowded platforms, not just line disruptions. One PCDRealTime call
 * per line (6 total), same feed getStationCrowding uses for a single
 * station, just fetched network-wide and merged into a lookup map. A failed
 * or empty line simply contributes no entries rather than failing the
 * whole lookup - crowding is a routing enhancement, not a hard requirement.
 */
export async function getNetworkCrowding(): Promise<Map<string, CrowdLevelDto>> {
  const perLine = await Promise.all(
    ROUTED_TRAIN_LINES.map((trainLine) =>
      fetchLta<LtaPlatformCrowdRealtimeResponse>(LTA_ENDPOINTS.PLATFORM_CROWD_REALTIME, {
        params: { TrainLine: trainLine },
        cacheTtlSeconds: CROWD_CACHE_TTL_SECONDS,
      }).catch(() => ({ value: [] as LtaPlatformCrowdRealtimeResponse["value"] }))
    )
  );

  const levels = new Map<string, CrowdLevelDto>();
  for (const page of perLine) {
    for (const entry of page.value ?? []) {
      if (!entry.Station) continue;
      levels.set(entry.Station.toUpperCase(), toDtoLevel(entry.CrowdLevel));
    }
  }
  return levels;
}
