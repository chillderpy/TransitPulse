// Shapes of LTA DataMall responses we consume. Field names mirror LTA's
// PascalCase convention exactly, since that's what the API returns.

export interface LtaBusArrivalNextBus {
  OriginCode: string;
  DestinationCode: string;
  EstimatedArrival: string; // ISO 8601 timestamp, "" if unavailable
  Monitored: number;
  Latitude: string;
  Longitude: string;
  VisitNumber: string;
  Load: "SEA" | "SDA" | "LSD" | "";
  Feature: string;
  Type: "SD" | "DD" | "BD" | "";
}

export interface LtaBusService {
  ServiceNo: string;
  Operator: string;
  NextBus: LtaBusArrivalNextBus;
  NextBus2: LtaBusArrivalNextBus;
  NextBus3: LtaBusArrivalNextBus;
}

export interface LtaBusArrivalResponse {
  BusStopCode: string;
  Services: LtaBusService[];
}

export interface LtaTrainServiceAlertStatus {
  Status: "1" | "2"; // 1 = normal, 2 = disrupted
  AffectedSegments: Array<{
    Line: string;
    Direction: string;
    Stations: string;
    FreePublicBus: string;
    FreeMRTShuttle: string;
    MRTShuttleDirection: string;
  }>;
  Message: Array<{ Content: string }>;
}

export interface LtaTrainServiceAlertsResponse {
  value: LtaTrainServiceAlertStatus[];
}

export type CrowdLevel = "l" | "m" | "h"; // low / moderate / high, per LTA's PCD convention

export interface LtaPlatformCrowdEntry {
  Station: string;
  StartTime: string;
  EndTime: string;
  CrowdLevel: CrowdLevel;
}

export interface LtaPlatformCrowdRealtimeResponse {
  value: LtaPlatformCrowdEntry[];
}

export interface LtaPlatformCrowdForecastEntry {
  Station: string;
  Interval: Array<{ Start: string; End: string; CrowdLevel: CrowdLevel }>;
}

export interface LtaPlatformCrowdForecastResponse {
  value: LtaPlatformCrowdForecastEntry[];
}
