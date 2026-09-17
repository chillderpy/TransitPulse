// A straight line between two points on the map cuts across blocks, rivers
// and buildings in a way that immediately reads as "wrong" - real walking
// and cycling legs follow footpaths and roads, not the crow flies. This
// fetches the actual street/path-following shape for a single walk/cycle
// hop from OSRM's public routing API, for DISPLAY only: the ride-time
// estimate a rider sees still comes from timeOfDay.ts's flat-speed model
// (WALK_METERS_PER_MINUTE / CYCLE_METERS_PER_MINUTE), not from OSRM's own
// duration, so this can fail or be slow without touching the numbers a
// commuter actually plans against.
//
// router.project-osrm.org is the public OSRM demo server, rate-limited and
// meant for light/demo use, not production traffic - fine for this
// hackathon-scale app, but a real deployment should point PROFILE_PATH at a
// self-hosted OSRM instance (or a paid provider) instead.
const OSRM_BASE = "https://router.project-osrm.org/route/v1";
const REQUEST_TIMEOUT_MS = 4000;
// Road geometry between two fixed points doesn't change day to day, so a
// long-lived in-memory cache is fine - this is a display fallback, not
// something that needs to react to live conditions.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type WalkCycleProfile = "foot" | "bike";

interface CacheEntry {
  points: Array<[number, number]> | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(
  profile: WalkCycleProfile,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): string {
  return `${profile}:${from.lat.toFixed(6)},${from.lon.toFixed(6)}:${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
}

interface OsrmRouteResponse {
  routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
}

/**
 * Real path geometry for one walk/cycle hop, [lat, lon] pairs including
 * both endpoints - or null on any failure (network, timeout, no route
 * found), in which case the caller should fall back to a straight line
 * between `from` and `to`. This is enrichment, never a hard dependency.
 */
export async function fetchWalkCycleGeometry(
  profile: WalkCycleProfile,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<Array<[number, number]> | null> {
  const key = cacheKey(profile, from, to);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.points;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${OSRM_BASE}/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
    const data = (await res.json()) as OsrmRouteResponse;
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) throw new Error("OSRM returned no usable geometry");
    const points: Array<[number, number]> = coords.map(([lon, lat]) => [lat, lon]);
    cache.set(key, { points, fetchedAt: Date.now() });
    return points;
  } catch {
    cache.set(key, { points: null, fetchedAt: Date.now() });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
