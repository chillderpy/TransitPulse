import { CrowdLevelDto, Persona, RerouteSuggestionDto, RouteOptionDto, RouteStepDto } from "../types/api";
import { TrainAlertsDto } from "../types/api";
import {
  CYCLE_METERS_PER_MINUTE,
  EDGES,
  findNearestStations,
  findStationCode,
  haversineMeters,
  parseCoordinate,
  stationCoords,
  stationName,
  StationEdge,
  WALK_METERS_PER_MINUTE,
} from "./graph";
import { shortestPath, PathResult } from "./dijkstra";
import { kShortestPaths } from "./multiRouteDijkstra";
import { BusGraph, busStopCoords, busStopLabel, findNearestBusStops, getBusGraph } from "./busGraph";
import { LiftOutageDto, liftOutagesForStation } from "../services/facilitiesService";
import { WeatherAdvisoryDto } from "../services/weatherService";
import { fetchWalkCycleGeometry } from "../services/walkGeometryService";
import {
  boardingWaitMinutes,
  classifyPeriod,
  getServiceAvailability,
  scaleEdgesForTime,
  TIME_PERIOD_LABELS,
} from "./timeOfDay";

// A coordinate input walks to any node (station or bus stop) within this
// radius; the accessible persona uses a shorter radius since a longer walk
// is a bigger ask when the point is to reduce physical effort, not just
// minimise time.
const WALK_RADIUS_METERS: Record<Persona, number> = {
  standard: 1200,
  accessible: 600,
};

// A wider first/last-mile radius offered via cycling, on top of (not
// instead of) the walk radius above - the planner still generates walk
// edges within WALK_RADIUS_METERS, and additionally offers cycle edges out
// to CYCLE_RADIUS_METERS, letting Dijkstra pick whichever mode is actually
// faster for that particular distance. The accessible persona gets no
// cycling: it's aimed at reducing physical effort and shorter walks, not
// bringing in a mode that demands more of it.
const CYCLE_RADIUS_METERS: Record<Persona, number> = {
  standard: 3000,
  accessible: 0,
};

// A flat "unlock/park a bike" overhead so a cycle leg only wins over walking
// when the distance actually justifies it, rather than always being
// marginally faster than the equivalent walk.
const CYCLE_UNLOCK_MINUTES = 3;

const WALK_ADVISORY_THRESHOLD_METERS = 300;

// Boarding a train/bus at a highly (or moderately) crowded platform is
// modelled as extra "cost" on top of the plain time-of-day wait, so the
// live route can choose to board a line one stop earlier/later or take a
// different line altogether when doing so avoids the worst crowding - the
// same mechanism disruption-avoidance already uses (extra minutes bias the
// optimizer), just triggered by crowding instead of an outage.
const CROWDING_BOARDING_PENALTY_MINUTES: Record<CrowdLevelDto, number> = {
  high: 5,
  moderate: 1.5,
  low: 0,
  unknown: 0,
};
const EMPTY_BUS_GRAPH: BusGraph = { stops: new Map(), edges: [], builtAt: 0 };

// A commuter facing a disruption is being offered a choice between new
// optimal routes, not "old route vs new route" - this many ranked,
// meaningfully distinct disruption-aware alternatives are computed and
// returned for them to pick between (see RerouteSuggestionDto.routes).
const MAX_ROUTE_OPTIONS = 3;

export interface SuggestOptions {
  persona?: Persona;
  liftOutages?: LiftOutageDto[];
  originWeather?: WeatherAdvisoryDto | null;
  destinationWeather?: WeatherAdvisoryDto | null;
  // Overrides the live LTA-backed bus graph - tests use this to inject a
  // small synthetic graph so they're deterministic and don't hit the
  // network (the real graph is a multi-thousand-row fetch); real callers
  // (rerouteService) never set this and always get the live graph.
  busGraph?: BusGraph;
  // Live per-station platform crowding (uppercased station code -> level),
  // from crowdingService.getNetworkCrowding(). Missing/omitted means "no
  // crowding data available", same degrade-gracefully treatment as a
  // missing busGraph.
  crowding?: Map<string, CrowdLevelDto>;
  // When the traveller plans to depart - drives the time-of-day speed
  // adjustment (rush-hour buses slower, night buses/trains faster or
  // slower per src/routing/timeOfDay.ts). Defaults to right now, same as
  // Google Maps' "leave now".
  departAt?: Date;
}

/**
 * Everything the reroute endpoint needs from a route-planning engine.
 */
export interface RoutePlanner {
  suggest(
    originInput: string,
    destinationInput: string,
    alerts: TrainAlertsDto,
    options?: SuggestOptions
  ): Promise<RerouteSuggestionDto | { error: string }>;
}

function edgeKey(e: StationEdge): string {
  return `${e.line}|${e.from}|${e.to}`;
}

/**
 * Shortest path (by hop count) between two nodes in a single line's
 * subgraph, as the sequence of edges taken. Used to find every station a
 * disruption's named endpoints actually span, including stations the alert
 * doesn't name (see edgesAvoidingDisruptedLines).
 */
function bfsPath(adjacency: Map<string, StationEdge[]>, start: string, goal: string): StationEdge[] {
  if (start === goal) return [];
  const cameFrom = new Map<string, StationEdge>();
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const edge of adjacency.get(node) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      cameFrom.set(edge.to, edge);
      if (edge.to === goal) {
        const path: StationEdge[] = [];
        let cur = goal;
        while (cur !== start) {
          const step = cameFrom.get(cur)!;
          path.push(step);
          cur = step.from;
        }
        return path.reverse();
      }
      queue.push(edge.to);
    }
  }
  return [];
}

function edgesAvoidingDisruptedLines(alerts: TrainAlertsDto): {
  edges: StationEdge[];
  blockedLines: string[];
} {
  const disruptedLines = alerts.lines.filter((l) => l.status === "disrupted");
  if (disruptedLines.length === 0) return { edges: EDGES, blockedLines: [] };

  const blockedLines: string[] = [];
  const blockedEdgeKeys = new Set<string>();
  const blockEdges = (blocked: Iterable<StationEdge>) => {
    for (const e of blocked) {
      // EDGES stores each hop as two directed entries; a path found by BFS
      // only walks one direction, so block both or the reverse trip through
      // the same disrupted stations stays open.
      blockedEdgeKeys.add(edgeKey(e));
      blockedEdgeKeys.add(edgeKey({ ...e, from: e.to, to: e.from }));
      if (!blockedLines.includes(e.line)) blockedLines.push(e.line);
    }
  };

  for (const matching of disruptedLines) {
    const lineEdges = EDGES.filter((e) =>
      matching.line.toUpperCase().includes(edgeLineFullName(e.line))
    );
    if (lineEdges.length === 0) continue;

    const namedStations = matching.affectedStations.map((s) => s.toUpperCase());
    if (namedStations.length === 0) {
      // No station-level detail at all - we can't tell which segment, so
      // the whole line is treated as blocked.
      blockEdges(lineEdges);
      continue;
    }

    const codesOnLine = new Set<string>();
    for (const e of lineEdges) {
      codesOnLine.add(e.from);
      codesOnLine.add(e.to);
    }
    const namedCodes = [...codesOnLine].filter((code) =>
      namedStations.some((s) => s.includes(stationName(code).toUpperCase()))
    );

    if (namedCodes.length < 2) {
      // Fewer than two named stations on this line means there's no span to
      // compute - fall back to the conservative "both endpoints named" rule
      // (in practice this blocks nothing, since an edge needs two named
      // endpoints and we only have zero or one).
      blockEdges(
        lineEdges.filter(
          (e) =>
            namedStations.some((s) => s.includes(stationName(e.from).toUpperCase())) &&
            namedStations.some((s) => s.includes(stationName(e.to).toUpperCase()))
        )
      );
      continue;
    }

    // Block every edge on the path between any two named stations, not just
    // edges whose own two endpoints happen to both be named - an alert that
    // names only the two ends of a disrupted stretch (e.g. "Clementi and
    // Commonwealth") still fully blocks the stations in between (e.g.
    // Dover) that it never mentions by name.
    const adjacency = new Map<string, StationEdge[]>();
    for (const e of lineEdges) {
      if (!adjacency.has(e.from)) adjacency.set(e.from, []);
      adjacency.get(e.from)!.push(e);
    }
    for (let i = 0; i < namedCodes.length; i++) {
      for (let j = i + 1; j < namedCodes.length; j++) {
        blockEdges(bfsPath(adjacency, namedCodes[i], namedCodes[j]));
      }
    }
  }

  const edges = EDGES.filter((edge) => !blockedEdgeKeys.has(edgeKey(edge)));
  return { edges, blockedLines };
}

// Exported so mockDisruptions.ts's networkWideOutage scenario can build
// alert.line values edgesAvoidingDisruptedLines will actually match,
// instead of duplicating this mapping (and risking it drifting out of
// sync, as happened when that scenario used bare line codes instead).
export const LINE_FULL_NAMES: Record<string, string> = {
  NSL: "NORTH-SOUTH",
  EWL: "EAST-WEST",
  CCL: "CIRCLE",
  DTL: "DOWNTOWN",
  TEL: "THOMSON-EAST COAST",
  NEL: "NORTH EAST",
};

function edgeLineFullName(code: string): string {
  return LINE_FULL_NAMES[code] ?? code;
}

/** A resolved endpoint: either a real station/bus stop, or an arbitrary point that walks in to one or more nearby nodes. */
type ResolvedEndpoint =
  | { kind: "node"; code: string; lat: number; lon: number }
  | { kind: "coordinate"; virtualNode: string; lat: number; lon: number; walkEdges: StationEdge[] };

function resolveEndpoint(
  input: string,
  virtualNode: string,
  persona: Persona,
  busGraph: BusGraph
): ResolvedEndpoint | null {
  const code = findStationCode(input);
  if (code) {
    const coords = stationCoords(code);
    return coords ? { kind: "node", code, lat: coords.lat, lon: coords.lon } : null;
  }

  const coordinate = parseCoordinate(input);
  if (!coordinate) return null;

  const walkRadius = WALK_RADIUS_METERS[persona];
  const cycleRadius = CYCLE_RADIUS_METERS[persona];
  const searchRadius = Math.max(walkRadius, cycleRadius);
  const nearby = [
    ...findNearestStations(coordinate.lat, coordinate.lon, searchRadius),
    ...findNearestBusStops(busGraph, coordinate.lat, coordinate.lon, searchRadius),
  ]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 4);
  if (nearby.length === 0) return null;

  const walkEdges: StationEdge[] = nearby.flatMap(({ code: nodeCode, distanceMeters }) => {
    const edges: StationEdge[] = [];
    if (distanceMeters <= walkRadius) {
      const minutes = Math.max(1, Math.round((distanceMeters / WALK_METERS_PER_MINUTE) * 10) / 10);
      edges.push(
        { from: virtualNode, to: nodeCode, line: "WALK", minutes },
        { from: nodeCode, to: virtualNode, line: "WALK", minutes }
      );
    }
    if (distanceMeters <= cycleRadius) {
      const minutes =
        Math.max(1, Math.round((distanceMeters / CYCLE_METERS_PER_MINUTE) * 10) / 10) + CYCLE_UNLOCK_MINUTES;
      edges.push(
        { from: virtualNode, to: nodeCode, line: "CYCLE", minutes },
        { from: nodeCode, to: virtualNode, line: "CYCLE", minutes }
      );
    }
    return edges;
  });

  return { kind: "coordinate", virtualNode, lat: coordinate.lat, lon: coordinate.lon, walkEdges };
}

function endpointGraphNode(resolved: ResolvedEndpoint): string {
  return resolved.kind === "node" ? resolved.code : resolved.virtualNode;
}

function endpointLabel(resolved: ResolvedEndpoint, busGraph: BusGraph): string {
  if (resolved.kind === "coordinate") return "Your location";
  return nodeLabelForCode(resolved.code, busGraph);
}

function endpointCoords(resolved: ResolvedEndpoint): { lat: number; lon: number } {
  return { lat: resolved.lat, lon: resolved.lon };
}

function nodeLabelForCode(code: string, busGraph: BusGraph): string {
  const station = stationCoords(code);
  if (station) return stationName(code);
  const busLabel = busGraph.stops.has(code) ? busStopLabel(busGraph, code) : null;
  return busLabel ?? code;
}

function nodeCoords(
  node: string,
  origin: ResolvedEndpoint,
  destination: ResolvedEndpoint,
  busGraph: BusGraph
): { lat: number; lon: number } {
  if (origin.kind === "coordinate" && node === origin.virtualNode) return endpointCoords(origin);
  if (destination.kind === "coordinate" && node === destination.virtualNode) return endpointCoords(destination);
  const station = stationCoords(node);
  if (station) return station;
  return busStopCoords(busGraph, node) ?? { lat: 0, lon: 0 };
}

function nodeLabel(
  node: string,
  origin: ResolvedEndpoint,
  destination: ResolvedEndpoint,
  busGraph: BusGraph
): string {
  if (origin.kind === "coordinate" && node === origin.virtualNode) return endpointLabel(origin, busGraph);
  if (destination.kind === "coordinate" && node === destination.virtualNode) return endpointLabel(destination, busGraph);
  return nodeLabelForCode(node, busGraph);
}

function sumLegMinutes(legMinutes: number[], fromIdx: number, toIdx: number): number {
  let total = 0;
  for (let j = fromIdx; j < toIdx; j++) total += legMinutes[j];
  return Math.round(total * 10) / 10;
}

function sumWalkDistanceMeters(
  path: string[],
  fromIdx: number,
  toIdx: number,
  origin: ResolvedEndpoint,
  destination: ResolvedEndpoint,
  busGraph: BusGraph
): number {
  let total = 0;
  for (let j = fromIdx; j < toIdx; j++) {
    const a = nodeCoords(path[j], origin, destination, busGraph);
    const b = nodeCoords(path[j + 1], origin, destination, busGraph);
    total += haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }
  return Math.round(total);
}

/**
 * Turns the raw hop-by-hop path into a rider-facing itinerary: one step per
 * mode change (board/alight/interchange), not one step per physical stop.
 * A bus leg alone can cover 20-30 real stops - listing each one would be
 * unreadable, so consecutive same-line hops collapse into a single "ride"
 * step summarising the stop count and time.
 */
function buildSteps(
  result: PathResult,
  origin: ResolvedEndpoint,
  destination: ResolvedEndpoint,
  busGraph: BusGraph
): RouteStepDto[] {
  const last = result.path.length - 1;
  const isBoundary = (i: number) =>
    i === 0 || i === last || result.linesUsed[i - 1] !== result.linesUsed[i];
  const keptIndices: number[] = [];
  for (let i = 0; i <= last; i++) if (isBoundary(i)) keptIndices.push(i);

  const steps: RouteStepDto[] = [];
  for (let k = 0; k < keptIndices.length; k++) {
    const i = keptIndices[k];
    const { lat, lon } = nodeCoords(result.path[i], origin, destination, busGraph);
    const label = nodeLabel(result.path[i], origin, destination, busGraph);

    if (i === 0) {
      steps.push({ order: 1, station: label, mode: "origin", note: "Journey start", lat, lon });
      continue;
    }

    const prevI = keptIndices[k - 1];
    const segmentLine = result.linesUsed[i - 1]; // uniform across prevI+1..i by construction
    const rideMinutes = sumLegMinutes(result.legMinutes, prevI, i);
    // Only the first hop of a boarding segment carries a wait (every hop
    // after that is the same vehicle continuing), so this is never summed
    // across the segment the way rideMinutes is.
    const boardingMinutes = result.waitMinutes[prevI];
    const segmentMinutes = Math.round((rideMinutes + boardingMinutes) * 10) / 10;
    const stopsPassed = i - prevI - 1;
    const isWalk = segmentLine === "WALK";
    const isCycle = segmentLine === "CYCLE";
    const isBus = segmentLine.startsWith("BUS:");

    let mode: RouteStepDto["mode"] = isWalk ? "walk" : isCycle ? "cycle" : isBus ? "bus" : "train";
    let note: string;
    let distanceMeters: number | undefined;
    const waitSuffix = boardingMinutes > 0 ? `~${boardingMinutes} min wait + ` : "";

    if (isWalk || isCycle) {
      distanceMeters = sumWalkDistanceMeters(result.path, prevI, i, origin, destination, busGraph);
      note = isWalk ? `Walk ~${distanceMeters}m (${segmentMinutes} min)` : `Cycle ~${distanceMeters}m (${segmentMinutes} min)`;
    } else if (isBus) {
      const serviceNo = segmentLine.slice(4);
      note = stopsPassed > 0
        ? `Bus ${serviceNo} (${waitSuffix}${rideMinutes} min ride, ${stopsPassed + 1} stops)`
        : `Bus ${serviceNo} (${waitSuffix}${rideMinutes} min ride)`;
    } else {
      note = stopsPassed > 0
        ? `${segmentLine} line (${waitSuffix}${rideMinutes} min ride, ${stopsPassed + 1} stops)`
        : `${segmentLine} line (${waitSuffix}${rideMinutes} min ride)`;
    }

    if (i === last) {
      mode = "destination";
      // Keep the ride/walk description rather than replacing it outright -
      // when there's no interchange at all (a single train/bus leg door to
      // door), this is the ONLY step carrying that info, so overwriting it
      // with a bare "Destination" silently erased the entire journey detail.
      note = isWalk
        ? `Destination (walk ~${distanceMeters}m, ${segmentMinutes} min)`
        : isCycle
          ? `Destination (cycle ~${distanceMeters}m, ${segmentMinutes} min)`
          : `Destination (via ${note})`;
    }

    steps.push({ order: steps.length + 1, station: label, mode, note, lat, lon, distanceMeters });
  }

  return steps;
}

/**
 * Turns a PathResult into the [lat, lon] polyline the map draws, with every
 * WALK/CYCLE/bus hop traced along real street/path geometry instead of a
 * straight line between its two endpoints. Train hops are left as-is, since
 * rail runs on its own fixed alignment between closely-spaced stations, so a
 * straight line between them already tracks the real line closely. Bus
 * stops on the other hand can be far apart (e.g. either side of an
 * expressway interchange), where the actual route loops around on-ramps
 * rather than cutting straight across - hence bus hops get the same
 * road-following treatment as walk/cycle (see fetchWalkCycleGeometry's own
 * comment for why this only affects display, never the route's timing).
 * Hops are fetched in parallel since a route rarely has more than a
 * handful of these legs.
 */
async function pathCoordinatesWithRoadGeometry(
  result: PathResult,
  origin: ResolvedEndpoint,
  destination: ResolvedEndpoint,
  busGraph: BusGraph
): Promise<Array<[number, number]>> {
  const hopGeometries = await Promise.all(
    result.linesUsed.map((line, i) => {
      const isBus = line.startsWith("BUS:");
      if (line !== "WALK" && line !== "CYCLE" && !isBus) return Promise.resolve(null);
      const from = nodeCoords(result.path[i], origin, destination, busGraph);
      const to = nodeCoords(result.path[i + 1], origin, destination, busGraph);
      const profile = line === "WALK" ? "foot" : line === "CYCLE" ? "bike" : "driving";
      return fetchWalkCycleGeometry(profile, from, to);
    })
  );

  const first = nodeCoords(result.path[0], origin, destination, busGraph);
  const points: Array<[number, number]> = [[first.lat, first.lon]];
  for (let i = 0; i < result.linesUsed.length; i++) {
    const geometry = hopGeometries[i];
    if (geometry && geometry.length >= 2) {
      for (let k = 1; k < geometry.length; k++) points.push(geometry[k]);
    } else {
      const to = nodeCoords(result.path[i + 1], origin, destination, busGraph);
      points.push([to.lat, to.lon]);
    }
  }
  return points;
}

interface RouteOptionContext {
  usual: PathResult;
  blockedLines: string[];
  origin: ResolvedEndpoint;
  destination: ResolvedEndpoint;
  busGraph: BusGraph;
  crowding?: Map<string, CrowdLevelDto>;
  persona: Persona;
  liftOutages?: LiftOutageDto[];
  originWeather?: WeatherAdvisoryDto | null;
  destinationWeather?: WeatherAdvisoryDto | null;
}

/**
 * Builds one fully-described, selectable route (steps, road-following
 * polyline, disruption/crowding explanations, warnings) out of a single
 * PathResult - the same derivation the planner used to run once for "the"
 * route, now run once per ranked alternative so each option in
 * RerouteSuggestionDto.routes is independently explorable rather than only
 * the top one.
 */
async function buildRouteOption(id: string, live: PathResult, ctx: RouteOptionContext): Promise<RouteOptionDto> {
  const { usual, blockedLines, origin, destination, busGraph, crowding, persona, liftOutages, originWeather, destinationWeather } = ctx;

  const trainLinesUsed = new Set(live.linesUsed.filter((l) => l !== "WALK" && l !== "CYCLE"));
  const transfers = Math.max(0, trainLinesUsed.size - 1);
  const disrupted = blockedLines.length > 0 && live.totalMinutes !== usual.totalMinutes;

  const roundedTotalMinutes = Math.round(live.totalMinutes * 10) / 10;
  const bufferMinutes = Math.max(1, Math.round(roundedTotalMinutes * 0.15));
  const confidenceRangeMinutes = {
    min: Math.floor(roundedTotalMinutes),
    max: Math.ceil(roundedTotalMinutes + bufferMinutes),
  };

  let crowdingReason: string | null = null;
  if (crowding && live.path !== usual.path) {
    const isHighCrowd = (node: string) => crowding.get(node.toUpperCase()) === "high";
    const highCrowdOnUsual = usual.path.filter(
      (n, idx) => idx > 0 && idx < usual.path.length - 1 && isHighCrowd(n)
    );
    const avoided = highCrowdOnUsual.filter((n) => !live.path.includes(n));
    if (avoided.length > 0) {
      const names = [...new Set(avoided.map((n) => nodeLabelForCode(n, busGraph)))];
      crowdingReason = `Adjusted to avoid high platform crowding at ${names.join(", ")}`;
    }
  }

  const avoidedSegments: Array<[[number, number], [number, number]]> = [];
  if (disrupted) {
    for (let i = 0; i < usual.path.length - 1; i++) {
      const line = usual.linesUsed[i];
      if (blockedLines.includes(line) && !live.path.includes(usual.path[i + 1])) {
        const from = nodeCoords(usual.path[i], origin, destination, busGraph);
        const to = nodeCoords(usual.path[i + 1], origin, destination, busGraph);
        avoidedSegments.push([[from.lat, from.lon], [to.lat, to.lon]]);
      }
    }
  }

  const accessibilityWarnings: string[] = [];
  if (persona === "accessible" && liftOutages?.length) {
    for (const node of live.path) {
      if (node === endpointGraphNode(origin) || node === endpointGraphNode(destination)) continue;
      const outages = liftOutagesForStation(liftOutages, node);
      for (const outage of outages) {
        accessibilityWarnings.push(`Lift out of service at ${stationName(node)}: ${outage.liftDescription}`);
      }
    }
  }

  let maxWalkMeters = 0;
  for (let i = 1; i < live.path.length; i++) {
    if (live.linesUsed[i - 1] !== "WALK" && live.linesUsed[i - 1] !== "CYCLE") continue;
    const a = nodeCoords(live.path[i - 1], origin, destination, busGraph);
    const b = nodeCoords(live.path[i], origin, destination, busGraph);
    maxWalkMeters = Math.max(maxWalkMeters, haversineMeters(a.lat, a.lon, b.lat, b.lon));
  }

  let weatherAdvisory: RouteOptionDto["weatherAdvisory"] = null;
  if (maxWalkMeters >= WALK_ADVISORY_THRESHOLD_METERS) {
    const rainy = [originWeather, destinationWeather].find((w) => w?.rainLikely);
    if (rainy) {
      weatherAdvisory = {
        area: rainy.area,
        forecast: rainy.forecast,
        message: `${rainy.forecast} near ${rainy.area} - allow extra time for the walking leg of this trip.`,
      };
    }
  }

  const livePath = await pathCoordinatesWithRoadGeometry(live, origin, destination, busGraph);

  return {
    id,
    totalMinutes: roundedTotalMinutes,
    deltaMinutes: Math.round((live.totalMinutes - usual.totalMinutes) * 10) / 10,
    confidenceRangeMinutes,
    transfers,
    disruptionReason: disrupted
      ? `Avoiding disruption on the ${blockedLines.join(", ")} line${blockedLines.length > 1 ? "s" : ""}`
      : null,
    crowdingReason,
    steps: buildSteps(live, origin, destination, busGraph),
    livePath,
    avoidedSegments,
    weatherAdvisory,
    accessibilityWarnings,
  };
}

export class StaticGraphRoutePlanner implements RoutePlanner {
  async suggest(
    originInput: string,
    destinationInput: string,
    alerts: TrainAlertsDto,
    options: SuggestOptions = {}
  ): Promise<RerouteSuggestionDto | { error: string }> {
    const persona = options.persona ?? "standard";

    // The bus-stop graph is a large, LTA-backed fetch (thousands of stops
    // and routes) - if it's unavailable (no key, network error), routing
    // just degrades to rail+walk only rather than failing the request.
    let busGraph: BusGraph;
    if (options.busGraph) {
      busGraph = options.busGraph;
    } else {
      try {
        busGraph = await getBusGraph();
      } catch (err) {
        console.error("getBusGraph failed, falling back to rail+walk only:", err);
        busGraph = EMPTY_BUS_GRAPH;
      }
    }

    const origin = resolveEndpoint(originInput, "__ORIGIN__", persona, busGraph);
    const destination = resolveEndpoint(destinationInput, "__DESTINATION__", persona, busGraph);
    if (!origin || !destination) {
      return {
        error:
          `Unknown station(s) or unreachable location: ${[
            !origin ? originInput : null,
            !destination ? destinationInput : null,
          ]
            .filter(Boolean)
            .join(", ")}. Use a station name/code, or a "lat,lon" pair within ` +
          `${WALK_RADIUS_METERS[persona]}m of a station or bus stop (LRT is out of scope) - ` +
          `see src/routing/graph.ts for the full station list.`,
      };
    }

    const departAt = options.departAt ?? new Date();
    const timePeriod = classifyPeriod(departAt);
    const serviceAvailability = getServiceAvailability(departAt);

    // A closed mode isn't "disrupted" (that's the alerts-driven live-vs-usual
    // comparison below) - it's simply not part of the graph at this hour, so
    // both the "usual" and "live" paths are computed against the same
    // hours-filtered edge set. Regular bus edges only (not the walk-transfer
    // edges busGraph.ts also stores in the same array) are dropped when
    // buses aren't running.
    const scheduledBusGraphEdges = serviceAvailability.busOpen
      ? busGraph.edges
      : busGraph.edges.filter((e) => !e.line.startsWith("BUS:"));
    const railEdges = serviceAvailability.railOpen ? EDGES : [];

    const originWalkEdges = origin.kind === "coordinate" ? origin.walkEdges : [];
    const destWalkEdges = destination.kind === "coordinate" ? destination.walkEdges : [];
    const baseEdges = scaleEdgesForTime(
      [...railEdges, ...scheduledBusGraphEdges, ...originWalkEdges, ...destWalkEdges],
      departAt
    );
    const originNode = endpointGraphNode(origin);
    const destNode = endpointGraphNode(destination);

    // "usual" reflects only the time-of-day wait, no crowding/disruption
    // avoidance - it's the plain baseline the live route is compared
    // against. "live" layers a crowding penalty on top, so boarding at a
    // highly-crowded platform costs extra minutes and the optimizer can
    // choose a different line/station when that's worth it.
    const usualBoardingPenalty = (line: string) => boardingWaitMinutes(line, timePeriod);
    const crowding = options.crowding;
    const crowdingPenaltyFor = (atStation: string): number => {
      if (!crowding) return 0;
      const level = crowding.get(atStation.toUpperCase());
      return level ? CROWDING_BOARDING_PENALTY_MINUTES[level] : 0;
    };
    const liveBoardingPenalty = (line: string, atStation: string) =>
      boardingWaitMinutes(line, timePeriod) + crowdingPenaltyFor(atStation);

    const usual = shortestPath(baseEdges, originNode, destNode, usualBoardingPenalty);
    if (!usual) {
      const hint = serviceAvailability.note ? ` ${serviceAvailability.note}` : "";
      return { error: `No route found between these points across the rail and bus network.${hint}` };
    }

    const { edges: liveRailEdgesRaw, blockedLines } = edgesAvoidingDisruptedLines(alerts);
    const liveRailEdges = serviceAvailability.railOpen ? liveRailEdgesRaw : [];
    const liveEdges = scaleEdgesForTime(
      [...liveRailEdges, ...scheduledBusGraphEdges, ...originWalkEdges, ...destWalkEdges],
      departAt
    );
    // A disrupted commuter is choosing between several *new* optimal
    // routes, not between the old route and one new one - so this finds up
    // to MAX_ROUTE_OPTIONS distinct, ranked (fastest-first) routes on the
    // disruption-aware graph via Yen's algorithm, instead of a single
    // shortestPath call. "usual" (above) remains a single baseline path,
    // kept only as shared context (usualMinutes/deltaMinutes/
    // avoidedSegments per option) - it is never itself one of the choices
    // offered.
    const liveCandidates = kShortestPaths(liveEdges, originNode, destNode, MAX_ROUTE_OPTIONS, liveBoardingPenalty);
    const liveResults = liveCandidates.length > 0 ? liveCandidates : [usual];

    const routeOptionContext: RouteOptionContext = {
      usual,
      blockedLines,
      origin,
      destination,
      busGraph,
      crowding,
      persona,
      liftOutages: options.liftOutages,
      originWeather: options.originWeather,
      destinationWeather: options.destinationWeather,
    };

    const [routes, usualPath] = await Promise.all([
      Promise.all(liveResults.map((live, idx) => buildRouteOption(`option-${idx + 1}`, live, routeOptionContext))),
      pathCoordinatesWithRoadGeometry(usual, origin, destination, busGraph),
    ]);

    const best = routes[0];

    return {
      originStation: endpointLabel(origin, busGraph),
      destinationStation: endpointLabel(destination, busGraph),
      persona,
      timeContext: { period: timePeriod, label: TIME_PERIOD_LABELS[timePeriod] },
      serviceHoursNote: serviceAvailability.note,
      totalMinutes: best.totalMinutes,
      usualMinutes: Math.round(usual.totalMinutes * 10) / 10,
      deltaMinutes: best.deltaMinutes,
      confidenceRangeMinutes: best.confidenceRangeMinutes,
      transfers: best.transfers,
      disruptionReason: best.disruptionReason,
      crowdingReason: best.crowdingReason,
      steps: best.steps,
      livePath: best.livePath,
      usualPath,
      avoidedSegments: best.avoidedSegments,
      weatherAdvisory: best.weatherAdvisory,
      accessibilityWarnings: best.accessibilityWarnings,
      routes,
    };
  }
}

export const routePlanner: RoutePlanner = new StaticGraphRoutePlanner();
