import { fetchLta } from "../lta/client";
import { LTA_ENDPOINTS } from "../lta/endpoints";

// Confirmed against the live endpoint (2026-09-17): dates are "YYYY-MM-DD",
// no time component, and this dataset covers *planned* roadworks - the
// planned-disruption signal PS2 calls out as distinct from live incidents.
interface LtaRoadWorkItem {
  EventID?: string;
  StartDate?: string;
  EndDate?: string;
  SvcDept?: string;
  RoadName?: string;
  Other?: string;
}

interface LtaRoadWorksResponse {
  value?: LtaRoadWorkItem[];
}

export interface PlannedRoadWorkDto {
  eventId: string;
  roadName: string;
  startDate: string;
  endDate: string;
  department: string;
  details: string;
}

const CACHE_TTL_SECONDS = 30 * 60;

export async function getActivePlannedRoadWorks(): Promise<PlannedRoadWorkDto[]> {
  const data = await fetchLta<LtaRoadWorksResponse>(LTA_ENDPOINTS.ROAD_WORKS, {
    cacheTtlSeconds: CACHE_TTL_SECONDS,
  });
  const today = new Date().toISOString().slice(0, 10);
  return (data.value ?? [])
    .filter((item) => item.RoadName && item.StartDate && item.EndDate)
    .filter((item) => item.StartDate! <= today && item.EndDate! >= today)
    .map((item) => ({
      eventId: item.EventID ?? "",
      roadName: item.RoadName!,
      startDate: item.StartDate!,
      endDate: item.EndDate!,
      department: item.SvcDept ?? "",
      details: item.Other ?? "",
    }));
}
