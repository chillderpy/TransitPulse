import { BusGraph, getBusGraph } from "../routing/busGraph";
import { haversineMeters, WALK_METERS_PER_MINUTE } from "../routing/graph";
import { NearbyBusStopDto, NearbyBusStopsDto } from "../types/api";

export const DEFAULT_NEARBY_RADIUS_METERS = 500;
export const DEFAULT_NEARBY_LIMIT = 5;

/**
 * Pure ranking step (no I/O): the stops within `radiusMeters` of the point,
 * nearest first, capped at `limit`. Split out from getNearbyBusStops so it can
 * be tested without LTA.
 */
export function rankNearbyBusStops(
  graph: BusGraph,
  lat: number,
  lon: number,
  radiusMeters: number,
  limit: number
): NearbyBusStopDto[] {
  return [...graph.stops.values()]
    .map((s) => ({ stop: s, distance: haversineMeters(lat, lon, s.lat, s.lon) }))
    .filter((c) => c.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ stop, distance }) => ({
      busStopCode: stop.code,
      description: stop.description,
      roadName: stop.roadName,
      latitude: stop.lat,
      longitude: stop.lon,
      distanceMeters: Math.round(distance),
      walkMinutes: Math.max(1, Math.round(distance / WALK_METERS_PER_MINUTE)),
    }));
}

/**
 * Bus stops near a GPS position, from the same cached LTA BusStops dataset the
 * route planner uses (src/routing/busGraph.ts), so no extra LTA calls are made
 * once that cache is warm.
 */
export async function getNearbyBusStops(
  lat: number,
  lon: number,
  radiusMeters = DEFAULT_NEARBY_RADIUS_METERS,
  limit = DEFAULT_NEARBY_LIMIT
): Promise<NearbyBusStopsDto> {
  const graph = await getBusGraph();
  return {
    origin: { latitude: lat, longitude: lon },
    radiusMeters,
    stops: rankNearbyBusStops(graph, lat, lon, radiusMeters, limit),
  };
}
