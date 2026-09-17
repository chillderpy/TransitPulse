import { RerouteSuggestionDto, RouteStepDto } from "../types/api";
import { TrainAlertsDto } from "../types/api";
import { EDGES, findStationCode, stationName, stationCoords, StationEdge } from "./graph";
import { shortestPath, PathResult } from "./dijkstra";

/**
 * Everything the reroute endpoint needs from a route-planning engine. The
 * static-graph implementation below is an MVP; the write-up's planned
 * multi-modal engine (full MRT+bus coverage, persona-weighted scoring)
 * should implement this same interface so the API/route layer doesn't need
 * to change when it lands.
 */
export interface RoutePlanner {
  suggest(
    originInput: string,
    destinationInput: string,
    alerts: TrainAlertsDto
  ): RerouteSuggestionDto | { error: string };
}

function edgesAvoidingDisruptedLines(alerts: TrainAlertsDto): {
  edges: StationEdge[];
  blockedLines: string[];
} {
  const disruptedLines = alerts.lines.filter((l) => l.status === "disrupted");
  if (disruptedLines.length === 0) return { edges: EDGES, blockedLines: [] };

  const blockedLines: string[] = [];
  const edges = EDGES.filter((edge) => {
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

function buildSteps(result: PathResult): RouteStepDto[] {
  return result.path.map((code, i) => {
    let mode: RouteStepDto["mode"] = "train";
    let note = `${result.linesUsed[i - 1] ?? result.linesUsed[0]} line`;
    if (i === 0) {
      mode = "origin";
      note = "Journey start";
    } else if (i === result.path.length - 1) {
      mode = "destination";
      note = "Destination";
    } else if (result.linesUsed[i - 1] !== result.linesUsed[i]) {
      note = `Interchange to ${result.linesUsed[i]} line`;
    }
    const { lat, lon } = stationCoords(code);
    return { order: i + 1, station: stationName(code), mode, note, lat, lon };
  });
}

export class StaticGraphRoutePlanner implements RoutePlanner {
  suggest(
    originInput: string,
    destinationInput: string,
    alerts: TrainAlertsDto
  ): RerouteSuggestionDto | { error: string } {
    const origin = findStationCode(originInput);
    const destination = findStationCode(destinationInput);
    if (!origin || !destination) {
      return {
        error:
          `Unknown station(s): ${[
            !origin ? originInput : null,
            !destination ? destinationInput : null,
          ]
            .filter(Boolean)
            .join(", ")}. This MVP planner only covers a small sample of ` +
          `interchange stations - see src/routing/graph.ts.`,
      };
    }

    const usual = shortestPath(EDGES, origin, destination);
    if (!usual) {
      return { error: "No route found between these stations in the sample graph." };
    }

    const { edges: liveEdges, blockedLines } = edgesAvoidingDisruptedLines(alerts);
    const live = shortestPath(liveEdges, origin, destination) ?? usual;

    const transfers = new Set(live.linesUsed).size - 1;
    const disrupted = blockedLines.length > 0 && live.totalMinutes !== usual.totalMinutes;

    return {
      originStation: stationName(origin),
      destinationStation: stationName(destination),
      totalMinutes: live.totalMinutes,
      usualMinutes: usual.totalMinutes,
      deltaMinutes: live.totalMinutes - usual.totalMinutes,
      transfers: Math.max(0, transfers),
      disruptionReason: disrupted
        ? `Avoiding disruption on the ${blockedLines.join(", ")} line${blockedLines.length > 1 ? "s" : ""}`
        : null,
      steps: buildSteps(live),
    };
  }
}

export const routePlanner: RoutePlanner = new StaticGraphRoutePlanner();
