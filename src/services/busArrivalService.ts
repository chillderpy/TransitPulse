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

// LTA sets Monitored=0 when a bus has no live GPS fix yet, and fills
// Latitude/Longitude with "0.0" rather than omitting them - which is a real
// coordinate (off the coast of Africa, nowhere near Singapore), not a null
// one. Trusting it at face value is how a bus stop card ends up plotting a
// marker in the Gulf of Guinea. Both the Monitored flag and a sentinel
// (0, 0) check are guarded here since either could show up alone.
function toLatLon(bus: LtaBusArrivalNextBus): { latitude: number | null; longitude: number | null } {
  if (bus.Monitored < 1) return { latitude: null, longitude: null };
  const lat = Number(bus.Latitude);
  const lon = Number(bus.Longitude);
  // Number() on "" or whitespace coerces to 0 rather than NaN, and on a
  // garbled/non-numeric payload it's NaN rather than null - neither of
  // which the old null-only check caught, letting bad coordinates (and,
  // for NaN, an "Invalid LatLng" crash in the map) reach the client.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    return { latitude: null, longitude: null };
  }
  return { latitude: lat, longitude: lon };
}

function mapNextBus(bus: LtaBusArrivalNextBus) {
  if (!bus || !bus.OriginCode) return null;
  return {
    ...toEta(bus.EstimatedArrival),
    load: LOAD_MAP[bus.Load] ?? "unknown",
    wheelchairAccessible: bus.Feature === "WAB",
    busType: TYPE_MAP[bus.Type] ?? "unknown",
    ...toLatLon(bus),
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
