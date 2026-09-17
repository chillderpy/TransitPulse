import { StationEdge } from "./graph";

export interface PathResult {
  path: string[]; // station codes, origin to destination inclusive
  totalMinutes: number;
  linesUsed: string[]; // in traversal order, collapsed to changes only
}

/**
 * Plain Dijkstra over a small in-memory graph. Fine for a handful of nodes;
 * would want a priority queue (and a much bigger station set) for a real
 * network-wide router.
 */
export function shortestPath(
  edges: StationEdge[],
  from: string,
  to: string
): PathResult | null {
  const distances = new Map<string, number>();
  const previous = new Map<string, { station: string; line: string }>();
  const visited = new Set<string>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  nodes.add(from);
  nodes.add(to);

  for (const n of nodes) distances.set(n, Infinity);
  distances.set(from, 0);

  const adjacency = new Map<string, StationEdge[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e);
  }

  while (visited.size < nodes.size) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const n of nodes) {
      if (visited.has(n)) continue;
      const d = distances.get(n)!;
      if (d < currentDist) {
        currentDist = d;
        current = n;
      }
    }
    if (current === null) break;
    if (current === to) break;
    visited.add(current);

    for (const edge of adjacency.get(current) ?? []) {
      const alt = currentDist + edge.minutes;
      if (alt < distances.get(edge.to)!) {
        distances.set(edge.to, alt);
        previous.set(edge.to, { station: current, line: edge.line });
      }
    }
  }

  if (distances.get(to) === Infinity || !nodes.has(to)) return null;

  const path: string[] = [to];
  const linesUsed: string[] = [];
  let cursor = to;
  while (cursor !== from) {
    const prev = previous.get(cursor);
    if (!prev) return null;
    path.unshift(prev.station);
    linesUsed.unshift(prev.line);
    cursor = prev.station;
  }

  return {
    path,
    totalMinutes: distances.get(to)!,
    linesUsed,
  };
}
