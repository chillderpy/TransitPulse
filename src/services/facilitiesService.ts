import { fetchLta } from "../lta/client";
import { LTA_ENDPOINTS } from "../lta/endpoints";

// Confirmed against the live endpoint (2026-09-17): each entry is a lift
// currently out of service, not a maintenance schedule - LTA calls the
// dataset "FacilitiesMaintenance" but it's really "faulty lifts right now".
interface LtaFacilityMaintenanceItem {
  Line?: string;
  StationCode?: string;
  StationName?: string;
  LiftID?: string;
  LiftDesc?: string;
}

interface LtaFacilityMaintenanceResponse {
  value?: LtaFacilityMaintenanceItem[];
}

export interface LiftOutageDto {
  stationCode: string;
  stationName: string;
  line: string;
  liftDescription: string;
}

const CACHE_TTL_SECONDS = 10 * 60;

export async function getLiftOutages(): Promise<LiftOutageDto[]> {
  const data = await fetchLta<LtaFacilityMaintenanceResponse>(
    LTA_ENDPOINTS.FACILITIES_MAINTENANCE,
    { cacheTtlSeconds: CACHE_TTL_SECONDS }
  );
  return (data.value ?? [])
    .filter((item) => item.StationCode)
    .map((item) => ({
      stationCode: item.StationCode!,
      stationName: item.StationName ?? item.StationCode!,
      line: item.Line ?? "",
      liftDescription: item.LiftDesc ?? "A lift at this station",
    }));
}

export function liftOutagesForStation(
  outages: LiftOutageDto[],
  stationCode: string
): LiftOutageDto[] {
  return outages.filter((o) => o.stationCode === stationCode);
}
