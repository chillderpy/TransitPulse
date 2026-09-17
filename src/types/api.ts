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
  // LTA's Message field can carry planned-service advisories (e.g. a
  // scheduled LRT closure) even while overallStatus is "normal" - these are
  // the "planned disruption" signal, distinct from per-line live incidents.
  generalAdvisories: string[];
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
  mode: "origin" | "walk" | "cycle" | "bus" | "train" | "destination";
  note: string;
  lat: number;
  lon: number;
  distanceMeters?: number; // present on "walk" steps
}

export type Persona = "standard" | "accessible";

export interface RerouteSuggestionDto {
  originStation: string;
  destinationStation: string;
  persona: Persona;
  // How the departure time (defaults to now) affected the estimate - rush
  // hour buses run slower, late-night services run faster/less frequent.
  timeContext: { period: "amPeak" | "pmPeak" | "night" | "offPeak"; label: string };
  // Non-null when MRT and/or regular buses aren't operating at the chosen
  // departure time, so the route was planned around whichever mode(s) are
  // actually running (see src/routing/timeOfDay.ts).
  serviceHoursNote: string | null;
  totalMinutes: number;
  usualMinutes: number;
  deltaMinutes: number;
  // A single point estimate reads as more certain than live transit data
  // actually is - this is totalMinutes plus a modest buffer, so the UI can
  // show a range instead of one confident number.
  confidenceRangeMinutes: { min: number; max: number };
  transfers: number;
  disruptionReason: string | null;
  // Non-null when live platform crowding (not a line disruption) changed
  // which stations/lines the route boards at - the "crowded platform should
  // change what the app recommends, and say why" requirement, distinct from
  // disruptionReason above which is about outages, not crowding.
  crowdingReason: string | null;
  steps: RouteStepDto[];
  // For the map: the currently-live path, the unaffected "usual" path (they
  // differ only when there's a disruption reroute), and which usual-path
  // segments are being avoided, so the UI can render "this is what you're
  // skipping" rather than just the one path taken.
  livePath: Array<[number, number]>;
  usualPath: Array<[number, number]>;
  avoidedSegments: Array<[[number, number], [number, number]]>;
  weatherAdvisory: { area: string; forecast: string; message: string } | null;
  accessibilityWarnings: string[];
}
