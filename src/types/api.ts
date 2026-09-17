// App-facing DTOs returned by our API - shaped for what the Flutter screens
// actually need, not a raw passthrough of LTA's schema.

export interface BusArrivalDto {
  busStopCode: string;
  services: Array<{
    serviceNo: string;
    operator: string;
    nextArrivals: Array<{
      etaSeconds: number | null; // null if LTA gave no estimate
      etaMinutes: number | null;
      load: "seats_available" | "standing_available" | "limited_standing" | "unknown";
      wheelchairAccessible: boolean;
      busType: "single" | "double" | "bendy" | "unknown";
      latitude: number | null;
      longitude: number | null;
    }>;
  }>;
  fetchedAt: string;
}

export type DisruptionStatus = "normal" | "disrupted";

export interface LineDisruptionDto {
  line: string;
  lineCode: string | null;
  status: DisruptionStatus;
  affectedStations: string[];
  freeBoardingBus: boolean;
  freeMrtShuttle: boolean;
  messages: string[];
}

export interface TrainAlertsDto {
  overallStatus: DisruptionStatus;
  lines: LineDisruptionDto[];
  fetchedAt: string;
}

export type CrowdLevelDto = "low" | "moderate" | "high" | "unknown";

export interface StationCrowdingDto {
  station: string;
  live: {
    level: CrowdLevelDto;
    asOf: string | null;
    staleForSeconds: number | null;
  };
  forecast: Array<{ start: string; end: string; level: CrowdLevelDto }>;
  crowdsourced: Array<{
    level: CrowdLevelDto;
    reportedAt: string;
    expiresAt: string;
  }>;
  fetchedAt: string;
}

export interface CrowdReportInput {
  station: string;
  level: "low" | "medium" | "high";
}

export interface SavedRouteInput {
  ownerId: string;
  name?: string;
  originStation: string;
  destinationStation: string;
}

export interface SavedRouteDto {
  id: string;
  ownerId: string;
  name: string;
  originStation: string;
  destinationStation: string;
  createdAt: string;
}

export interface RouteStepDto {
  order: number;
  station: string;
  mode: "origin" | "walk" | "bus" | "train" | "destination";
  note: string;
  lat: number;
  lon: number;
}

export interface RerouteSuggestionDto {
  originStation: string;
  destinationStation: string;
  totalMinutes: number;
  usualMinutes: number;
  deltaMinutes: number;
  transfers: number;
  disruptionReason: string | null;
  steps: RouteStepDto[];
}
