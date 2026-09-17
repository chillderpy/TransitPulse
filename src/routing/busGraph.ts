import { fetchLta } from "../lta/client";
import { LTA_ENDPOINTS } from "../lta/endpoints";
import { StationEdge } from "./graph";
import { haversineMeters, STATIONS, WALK_METERS_PER_MINUTE } from "./graph";

// Confirmed against the live endpoints (2026-09-17): both are paginated 500
// rows/page via OData $skip, with no total-count header, so we page until a
// short page tells us we've reached the end.
interface LtaBusStopItem {
  BusStopCode: string;
  RoadName: string;
  Description: string;
  Latitude: number;
  Longitude: number;
}

interface LtaBusRouteItem {
  ServiceNo: string;
  Direction: number;
  StopSequence: number;
  BusStopCode: string;
  Distance: number; // km, cumulative from the start of this service+direction
}

export interface BusStopNode {
  code: string;
  description: string;
  roadName: string;
  lat: number;
  lon: number;
}

export interface BusGraph {
  stops: Map<string, BusStopNode>;
  edges: StationEdge[]; // one-way bus hops (line "BUS:<serviceNo>") + two-way transfer walks to MRT
  builtAt: number;
}

// Buses don't run point-to-point at a constant pace (traffic, stops,
// signals), and DataMall doesn't publish inter-stop timetables - this is a
// planning-grade average, not a measured one, same spirit as the MRT
// per-line minutes-per-hop constants in graph.ts.
const AVG_BUS_KMH = 20;
const TRANSFER_WALK_RADIUS_METERS = 300;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const PAGE_BATCH = 5; // concurrent pages per round, to cut cold-build latency without hammering LTA

let cached: BusGraph | null = null;
let building: Promise<BusGraph> | null = null;

async function fetchAllPages<T>(endpoint: string): Promise<T[]> {
  const results: T[] = [];
  let skip = 0;
  for (;;) {
    const batchSkips = Array.from({ length: PAGE_BATCH }, (_, i) => skip + i * PAGE_SIZE);
    const pages = await Promise.all(
      batchSkips.map((s) =>
        fetchLta<{ value?: T[] }>(endpoint, {
          params: { "$skip": s },
          cacheTtlSeconds: CACHE_TTL_MS / 1000,
        })
      )
    );
    let shortPageSeen = false;
    for (const page of pages) {
      const values = page.value ?? [];
      results.push(...values);
      if (values.length < PAGE_SIZE) shortPageSeen = true;
    }
    if (shortPageSeen) break;
    skip += PAGE_BATCH * PAGE_SIZE;
  }
  return results;
}

async function buildBusGraph(): Promise<BusGraph> {
  const [stopsRaw, routesRaw] = await Promise.all([
    fetchAllPages<LtaBusStopItem>(LTA_ENDPOINTS.BUS_STOPS),
    fetchAllPages<LtaBusRouteItem>(LTA_ENDPOINTS.BUS_ROUTES),
  ]);

  const stops = new Map<string, BusStopNode>();
  for (const s of stopsRaw) {
    if (!s.BusStopCode || s.Latitude == null || s.Longitude == null) continue;
    stops.set(s.BusStopCode, {
      code: s.BusStopCode,
      description: s.Description || s.BusStopCode,
      roadName: s.RoadName || "",
      lat: s.Latitude,
      lon: s.Longitude,
    });
  }

  const groups = new Map<string, LtaBusRouteItem[]>();
  for (const r of routesRaw) {
    if (!r.BusStopCode || !stops.has(r.BusStopCode)) continue;
    const key = `${r.ServiceNo}|${r.Direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const edges: StationEdge[] = [];
  for (const [key, stopsOnRoute] of groups) {
    stopsOnRoute.sort((a, b) => a.StopSequence - b.StopSequence);
    const serviceNo = key.split("|")[0];
    for (let i = 0; i < stopsOnRoute.length - 1; i++) {
      const a = stopsOnRoute[i];
      const b = stopsOnRoute[i + 1];
      if (a.BusStopCode === b.BusStopCode) continue;
      const deltaKm = Math.max(0.1, (b.Distance ?? 0) - (a.Distance ?? 0));
      const minutes = Math.max(0.5, Math.round(((deltaKm / AVG_BUS_KMH) * 60) * 10) / 10);
      edges.push({ from: a.BusStopCode, to: b.BusStopCode, line: `BUS:${serviceNo}`, minutes });
    }
  }

  // Walking transfers between a bus stop and any MRT station close enough
  // to change modes on foot - this is what lets a route hop from a bus leg
  // onto the rail network (or vice versa) rather than treating them as two
  // disconnected graphs.
  for (const stop of stops.values()) {
    for (const station of STATIONS) {
      const distanceMeters = haversineMeters(stop.lat, stop.lon, station.lat, station.lon);
      if (distanceMeters > TRANSFER_WALK_RADIUS_METERS) continue;
      const minutes = Math.max(0.5, Math.round((distanceMeters / WALK_METERS_PER_MINUTE) * 10) / 10);
      edges.push({ from: stop.code, to: station.code, line: "WALK", minutes });
      edges.push({ from: station.code, to: stop.code, line: "WALK", minutes });
    }
  }

  return { stops, edges, builtAt: Date.now() };
}

/**
 * Lazily builds and caches the bus-stop graph (a real fetch across ~5,200
 * stops and ~27,000 route entries, so the first call after server start
 * takes several seconds - subsequent calls within the TTL are instant).
 * Any caller failure (no LTA key, network error) should be treated by the
 * caller as "no bus data available" rather than fatal.
 */
export async function getBusGraph(): Promise<BusGraph> {
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;
  if (building) return building;
  building = buildBusGraph()
    .then((graph) => {
      cached = graph;
      building = null;
      return graph;
    })
    .catch((err) => {
      building = null;
      throw err;
    });
  return building;
}

export function busStopCoords(graph: BusGraph, code: string): { lat: number; lon: number } | null {
  const s = graph.stops.get(code);
  return s ? { lat: s.lat, lon: s.lon } : null;
}

export function busStopLabel(graph: BusGraph, code: string): string {
  const s = graph.stops.get(code);
  return s ? `${s.description} (${s.roadName})` : code;
}

export function findNearestBusStops(
  graph: BusGraph,
  lat: number,
  lon: number,
  maxMeters: number,
  limit = 3
): Array<{ code: string; distanceMeters: number }> {
  return [...graph.stops.values()]
    .map((s) => ({ code: s.code, distanceMeters: haversineMeters(lat, lon, s.lat, s.lon) }))
    .filter((s) => s.distanceMeters <= maxMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}
