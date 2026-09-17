import { fetchLta } from "../lta/client";
import { LTA_ENDPOINTS } from "../lta/endpoints";
import { LtaBusArrivalNextBus, LtaBusArrivalResponse } from "../types/lta";
import { BusArrivalDto } from "../types/api";

const LOAD_MAP: Record<string, BusArrivalDto["services"][number]["nextArrivals"][number]["load"]> = {
  SEA: "seats_available",
  SDA: "standing_available",
  LSD: "limited_standing",
};

const TYPE_MAP: Record<string, BusArrivalDto["services"][number]["nextArrivals"][number]["busType"]> = {
  SD: "single",
  DD: "double",
  BD: "bendy",
};

function toEta(estimatedArrival: string): { etaSeconds: number | null; etaMinutes: number | null } {
  if (!estimatedArrival) return { etaSeconds: null, etaMinutes: null };
  const arrival = new Date(estimatedArrival).getTime();
  if (Number.isNaN(arrival)) return { etaSeconds: null, etaMinutes: null };
  const seconds = Math.max(0, Math.round((arrival - Date.now()) / 1000));
  return { etaSeconds: seconds, etaMinutes: Math.round(seconds / 60) };
}

function mapNextBus(bus: LtaBusArrivalNextBus) {
  if (!bus || !bus.OriginCode) return null;
  return {
    ...toEta(bus.EstimatedArrival),
    load: LOAD_MAP[bus.Load] ?? "unknown",
    wheelchairAccessible: bus.Feature === "WAB",
    busType: TYPE_MAP[bus.Type] ?? "unknown",
    latitude: bus.Latitude ? Number(bus.Latitude) : null,
    longitude: bus.Longitude ? Number(bus.Longitude) : null,
  };
}

/**
 * Real-time bus arrivals for a stop, from LTA DataMall's Bus Arrival API -
 * the one LTA feed that gives genuine per-vehicle ETAs. There is no
 * equivalent public "next train" ETA feed for MRT/LRT (see README), which is
 * why this only covers buses.
 */
export async function getBusArrivals(
  busStopCode: string,
  serviceNo?: string
): Promise<BusArrivalDto> {
  const data = await fetchLta<LtaBusArrivalResponse>(LTA_ENDPOINTS.BUS_ARRIVAL, {
    params: { BusStopCode: busStopCode, ServiceNo: serviceNo },
    cacheTtlSeconds: 15,
  });

  return {
    busStopCode: data.BusStopCode,
    services: (data.Services ?? []).map((svc) => ({
      serviceNo: svc.ServiceNo,
      operator: svc.Operator,
      nextArrivals: [svc.NextBus, svc.NextBus2, svc.NextBus3]
        .map(mapNextBus)
        .filter((b): b is NonNullable<typeof b> => b !== null),
    })),
    fetchedAt: new Date().toISOString(),
  };
}
