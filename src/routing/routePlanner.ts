import { CrowdLevelDto, Persona, RerouteSuggestionDto, RouteStepDto } from "../types/api";
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

function edgesAvoidingDisruptedLines(alerts: TrainAlertsDto): {
  edges: StationEdge[];
  blockedLines: string[];
} {
  const disruptedLines = alerts.lines.filter((l) => l.status === "disrupted");
  if (disruptedLines.length === 0) return { edges: EDGES, blockedLines: [] };

  const blockedLines: string[] = [];
  const edges = EDGES.filter((edge) => {
    if (edge.line === "WALK" || edge.line === "CYCLE" || edge.line.startsWith("BUS:")) return true;
    const matching = disruptedLines.find((d) =>
      d.line.toUpperCase().includes(edgeLineFullName(edge.line))
    );
    if (!matching) return true;
    // Only treat the edge as blocked if the alert names both endpoint
    // stations as affected - a line-wide "disrupted" flag without station
    // detail still fully blocks, since we can't tell which segment.
    const namedStations = matching.affectedStations.map((s) => s.toUpperCase());
    const bothNamed =
      namedStations.length === 0 ||
      (namedStations.some((s) => s.includes(stationName(edge.from).toUpperCase())) &&
        namedStations.some((s) => s.includes(stationName(edge.to).toUpperCase())));
    if (bothNamed) {
      if (!blockedLines.includes(edge.line)) blockedLines.push(edge.line);
      return false;
    }
    return true;
  });

  return { edges, blockedLines };
}

const LINE_FULL_NAMES: Record<string, string> = {
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
 * WALK/CYCLE hop traced along real street/path geometry instead of a
 * straight line between its two endpoints - train and bus hops are left
 * as-is, since those already follow the real, physical sequence of
 * stations/stops (see fetchWalkCycleGeometry's own comment for why this
 * only affects display, never the route's timing). Hops are fetched in
 * parallel since a route rarely has more than one or two walk/cycle legs.
 */
async function pathCoordinatesWithRoadGeometry(
  result: PathResult,
  origin: ResolvedEndpoint,
  destination: ResolvedEndpoint,
  busGraph: BusGraph
): Promise<Array<[number, number]>> {
  const hopGeometries = await Promise.all(
    result.linesUsed.map((line, i) => {
      if (line !== "WALK" && line !== "CYCLE") return Promise.resolve(null);
      const from = nodeCoords(result.path[i], origin, destination, busGraph);
      const to = nodeCoords(result.path[i + 1], origin, destination, busGraph);
      return fetchWalkCycleGeometry(line === "WALK" ? "foot" : "bike", from, to);
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
    const live = shortestPath(liveEdges, originNode, destNode, liveBoardingPenalty) ?? usual;

    const trainLinesUsed = new Set(live.linesUsed.filter((l) => l !== "WALK" && l !== "CYCLE"));
    const transfers = Math.max(0, trainLinesUsed.size - 1);
    const disrupted = blockedLines.length > 0 && live.totalMinutes !== usual.totalMinutes;

    // Modest uncertainty band rather than one confident number: live transit
    // timing (headways, dwell time, walk pace, bus travel time itself only
    // an average-speed estimate) always has some slop, and hiding that
    // behind a single point estimate overstates precision. Bracketed with
    // floor/ceil (not round) around the same rounded value reported as
    // totalMinutes, so the range can never come in narrower than the point
    // estimate it's supposed to surround.
    const roundedTotalMinutes = Math.round(live.totalMinutes * 10) / 10;
    const bufferMinutes = Math.max(1, Math.round(roundedTotalMinutes * 0.15));
    const confidenceRangeMinutes = {
      min: Math.floor(roundedTotalMinutes),
      max: Math.ceil(roundedTotalMinutes + bufferMinutes),
    };

    // Explain a crowding-driven change in boarding choice the same way
    // disruptionReason explains an outage-driven one: if the live route
    // boards at fewer highly-crowded stations than the plain "usual" route
    // would have, name the stations it steered clear of.
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
    if (persona === "accessible" && options.liftOutages?.length) {
      for (const node of live.path) {
        if (node === originNode || node === destNode) continue;
        const outages = liftOutagesForStation(options.liftOutages, node);
        for (const outage of outages) {
          accessibilityWarnings.push(
            `Lift out of service at ${stationName(node)}: ${outage.liftDescription}`
          );
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

    let weatherAdvisory: RerouteSuggestionDto["weatherAdvisory"] = null;
    if (maxWalkMeters >= WALK_ADVISORY_THRESHOLD_METERS) {
      const rainy = [options.originWeather, options.destinationWeather].find((w) => w?.rainLikely);
      if (rainy) {
        weatherAdvisory = {
          area: rainy.area,
          forecast: rainy.forecast,
          message: `${rainy.forecast} near ${rainy.area} - allow extra time for the walking leg of this trip.`,
        };
      }
    }

    const [livePath, usualPath] = await Promise.all([
      pathCoordinatesWithRoadGeometry(live, origin, destination, busGraph),
      pathCoordinatesWithRoadGeometry(usual, origin, destination, busGraph),
    ]);

    return {
      originStation: endpointLabel(origin, busGraph),
      destinationStation: endpointLabel(destination, busGraph),
      persona,
      timeContext: { period: timePeriod, label: TIME_PERIOD_LABELS[timePeriod] },
      serviceHoursNote: serviceAvailability.note,
      totalMinutes: roundedTotalMinutes,
      usualMinutes: Math.round(usual.totalMinutes * 10) / 10,
      deltaMinutes: Math.round((live.totalMinutes - usual.totalMinutes) * 10) / 10,
      confidenceRangeMinutes,
      transfers,
      disruptionReason: disrupted
        ? `Avoiding disruption on the ${blockedLines.join(", ")} line${blockedLines.length > 1 ? "s" : ""}`
        : null,
      crowdingReason,
      steps: buildSteps(live, origin, destination, busGraph),
      livePath,
      usualPath,
      avoidedSegments,
      weatherAdvisory,
      accessibilityWarnings,
    };
  }
}

export const routePlanner: RoutePlanner = new StaticGraphRoutePlanner();
