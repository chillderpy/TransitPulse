/**
 * LTA DataMall endpoint paths, relative to env.ltaBaseUrl
 * (https://datamall2.mytransport.sg/ltaodataservice).
 *
 * IMPORTANT: verify these against the current official API User Guide PDF
 * at https://datamall.lta.gov.sg before relying on this in production - this
 * sandbox's network egress blocks datamall.lta.gov.sg, so these paths were
 * confirmed via secondary sources (package docs, migration announcements)
 * rather than the primary PDF. LTA migrated Bus Arrival from the legacy
 * `BusArrivalv2` path to `v3/BusArrival` in mid-2025; if your account key
 * predates that and v3 rejects your calls, fall back to BUS_ARRIVAL_LEGACY.
 */
export const LTA_ENDPOINTS = {
  BUS_ARRIVAL: "v3/BusArrival",
  BUS_ARRIVAL_LEGACY: "BusArrivalv2",
  BUS_SERVICES: "BusServices",
  BUS_ROUTES: "BusRoutes",
  BUS_STOPS: "BusStops",
  TRAIN_SERVICE_ALERTS: "TrainServiceAlerts",
  PLATFORM_CROWD_REALTIME: "PCDRealTime",
  PLATFORM_CROWD_FORECAST: "PCDForecast",
  FACILITIES_MAINTENANCE: "FacilitiesMaintenance",
} as const;

/**
 * Train line codes as used by the PCDRealTime/PCDForecast `TrainLine` query
 * parameter and by TrainServiceAlerts line codes in its response.
 */
export const TRAIN_LINES = {
  NSL: "North-South Line",
  EWL: "East-West Line",
  CCL: "Circle Line",
  DTL: "Downtown Line",
  TEL: "Thomson-East Coast Line",
  NEL: "North East Line",
  BPL: "Bukit Panjang LRT",
  SLRT: "Sengkang LRT",
  PLRT: "Punggol LRT",
} as const;

export type TrainLineCode = keyof typeof TRAIN_LINES;
