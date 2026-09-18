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

export type DepartPreset = "amPeak" | "pmPeak" | "offPeak" | "night";

export interface SavedRouteInput {
  ownerId: string;
  name?: string;
  originStation: string;
  destinationStation: string;
  persona?: Persona;
  departPreset?: DepartPreset;
}

export interface SavedRouteDto {
  id: string;
  ownerId: string;
  name: string;
  originStation: string;
  destinationStation: string;
  persona: Persona;
  departPreset: DepartPreset | null;
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

// One selectable disruption-aware route out of the ranked alternatives
// RerouteSuggestionDto.routes offers - a commuter facing a disruption is
// unlikely to want the pre-disruption "usual" route (it may not even be
// possible), so the choice offered is between multiple *new* optimal
// routes, not old-vs-new.
export interface RouteOptionDto {
  id: string; // "option-1" (fastest) .. "option-N", stable within one response
  totalMinutes: number;
  deltaMinutes: number; // vs usualMinutes (the pre-disruption baseline), for context only
  // A single point estimate reads as more certain than live transit data
  // actually is - this is totalMinutes plus a modest buffer, so the UI can
  // show a range instead of one confident number.
  confidenceRangeMinutes: { min: number; max: number };
  transfers: number;
  disruptionReason: string | null;
  // Non-null when live platform crowding (not a line disruption) changed
  // which stations/lines this option boards at - the "crowded platform
  // should change what the app recommends, and say why" requirement,
  // distinct from disruptionReason above which is about outages.
  crowdingReason: string | null;
  steps: RouteStepDto[];
  livePath: Array<[number, number]>;
  // Which usual-path segments this option skips because of the
  // disruption, so the UI can render "this is what you're avoiding" for
  // this specific alternative.
  avoidedSegments: Array<[[number, number], [number, number]]>;
  weatherAdvisory: { area: string; forecast: string; message: string } | null;
  accessibilityWarnings: string[];
}

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
  // Mirrors routes[0] (the fastest option) for callers that only want a
  // single suggestion; new integrations should read `routes` instead.
  totalMinutes: number;
  usualMinutes: number;
  deltaMinutes: number;
  confidenceRangeMinutes: { min: number; max: number };
  transfers: number;
  disruptionReason: string | null;
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
  // Up to a handful of ranked (fastest-first), meaningfully distinct
  // disruption-aware routes for the commuter to pick between. routes[0] is
  // the same route mirrored into the top-level fields above.
  routes: RouteOptionDto[];
}
