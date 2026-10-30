/**
 * LTA DataMall endpoint paths, relative to env.ltaBaseUrl
 * (https://datamall2.mytransport.sg/ltaodataservice).
 *
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
  FACILITIES_MAINTENANCE: "v2/FacilitiesMaintenance",
  ROAD_WORKS: "RoadWorks",
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
