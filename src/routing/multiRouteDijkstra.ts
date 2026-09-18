import { StationEdge } from "./graph";
import { buildAdjacency, hopKey, PathResult, shortestPathOnAdjacency, START_LINE } from "./dijkstra";

/**
 * Yen's k-shortest-loopless-paths algorithm, built on top of dijkstra.ts's
 * single-path shortestPath. This is the new piece behind "give the commuter
 * a choice of routes" instead of a single optimal suggestion: it returns up
 * to `k` distinct, ranked (fastest-first) routes on the same edge set
 * shortestPath would otherwise search once.
 *
 * Standard algorithm (see e.g. Yen 1971): the first result is the plain
 * shortest path. Each subsequent result is found by, for every node along
 * the previous result ("spur" node), temporarily removing (a) the specific
 * next-hop edge any already-found path also takes from that same root
 * prefix (so we don't just rediscover the same route) and (b) every earlier
 * node in that root prefix (so the alternate can't loop back through it),
 * then re-running Dijkstra from the spur node to the destination. The
 * cheapest candidate produced across all spur nodes becomes the next result.
 *
 * One adaptation for this codebase: shortestPath's cost model depends on
 * which line you arrived on (continuing a line is free, switching costs a
 * boarding wait - see dijkstra.ts's state comment), so a spur path computed
 * in isolation doesn't know what line the stitched-on root prefix arrived
 * with. recomputeHopCosts re-derives every hop's cost for the *stitched*
 * path so the reported total reflects the real boarding pattern, rather
 * than trusting the root and spur segments' costs to simply add up.
 *
 * Every search here - the initial one and every spur search after it -
 * shares one pre-built adjacency map (see dijkstra.ts's buildAdjacency)
 * instead of each rebuilding its own from `edges`: on the live rail+bus
 * graph (tens of thousands of edges), rebuilding it per search was measured
 * as the majority of this function's cost, since a single k=3 request can
 * run Dijkstra a couple dozen times.
 *
 * Yen's algorithm on its own tends to produce near-duplicates on a graph
 * with many closely-spaced bus stops: e.g. blocking one disrupted rail
 * segment, the mathematically 2nd- and 3rd-shortest paths are often the
 * *same* rail-walk-bus-walk-rail bridge as the 1st, just boarding the same
 * bus service from a stop a few metres away - a technically-shortest but
 * not a meaningfully different choice for a commuter to pick between. So
 * candidates are still generated in strict cost order (correctness is
 * unchanged), but only kept in the returned set if their *mode signature*
 * (the sequence of lines/modes ridden, collapsing consecutive same-line
 * hops and ignoring which specific stop within a mode was used - see
 * modeSignature) hasn't already been returned - a near-duplicate is
 * skipped, but the search keeps spurring off it (and off every other
 * generated candidate) exactly as Yen's algorithm would, so a genuinely
 * different route further down the ranking still gets found rather than
 * the whole search stalling on one corridor.
 */
export function kShortestPaths(
  edges: StationEdge[],
  from: string,
  to: string,
  k: number,
  boardingPenaltyMinutes: (line: string, atStation: string) => number = () => 0,
  options: { maxCandidates?: number } = {}
): PathResult[] {
  const adjacency = buildAdjacency(edges);

  const first = shortestPathOnAdjacency(adjacency, from, to, boardingPenaltyMinutes);
  if (!first) return [];

  // Every loopless shortest path generated so far, in rank order - Yen's
  // algorithm needs the true next-best path to keep spurring from
  // correctly, regardless of whether it ends up being diverse enough to
  // return, so this can't be limited to just the diverse subset.
  const found: PathResult[] = [first];
  // The subset of `found` with distinct mode signatures - this is what
  // actually gets returned.
  const diverse: PathResult[] = [first];
  const seenModeSignatures = new Set<string>([modeSignature(first)]);

  const candidates: PathResult[] = [];
  const seenSignatures = new Set<string>([pathSignature(first)]);

  // Bounds worst-case cost: without a cap, a corridor with many redundant
  // near-duplicate candidates (see above) could force Yen's algorithm
  // through a very large number of spur searches - each a full Dijkstra run
  // over the live graph - before turning up k diverse results.
  const maxCandidates = options.maxCandidates ?? Math.max(k * 4, 8);

  while (diverse.length < k && found.length < maxCandidates) {
    const previous = found[found.length - 1];

    for (let i = 0; i < previous.path.length - 1; i++) {
      const spurNode = previous.path[i];
      const rootNodes = previous.path.slice(0, i + 1);

      const excludedHopKeys = new Set<string>();
      for (const p of found) {
        if (p.path.length <= i + 1) continue;
        if (!arraysEqual(p.path.slice(0, i + 1), rootNodes)) continue;
        excludedHopKeys.add(`${p.linesUsed[i]}|${p.path[i]}|${p.path[i + 1]}`);
      }

      // Every root-prefix node except the spur node itself is off-limits for
      // the spur search, so the alternate route can't loop back into the
      // path it's branching from.
      const excludedNodes = new Set(rootNodes.slice(0, -1));

      const spur = shortestPathOnAdjacency(adjacency, spurNode, to, boardingPenaltyMinutes, {
        excludedNodes,
        excludedHopKeys,
      });
      if (!spur) continue;

      const stitchedPath = [...rootNodes.slice(0, -1), ...spur.path];
      const stitchedLines = [...previous.linesUsed.slice(0, i), ...spur.linesUsed];
      const signature = pathSignature({ path: stitchedPath, linesUsed: stitchedLines } as PathResult);
      if (seenSignatures.has(signature) || candidates.some((c) => pathSignature(c) === signature)) continue;

      const { totalMinutes, legMinutes, waitMinutes } = recomputeHopCosts(
        edges,
        stitchedPath,
        stitchedLines,
        boardingPenaltyMinutes
      );
      candidates.push({ path: stitchedPath, linesUsed: stitchedLines, totalMinutes, legMinutes, waitMinutes });
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.totalMinutes - b.totalMinutes);
    const next = candidates.shift()!;
    seenSignatures.add(pathSignature(next));
    found.push(next);

    const modeSig = modeSignature(next);
    if (!seenModeSignatures.has(modeSig)) {
      seenModeSignatures.add(modeSig);
      diverse.push(next);
    }
  }

  return diverse;
}

function pathSignature(p: Pick<PathResult, "path" | "linesUsed">): string {
  return `${p.path.join(">")}#${p.linesUsed.join(">")}`;
}

/**
 * The sequence of lines/modes a route rides, collapsing consecutive hops on
 * the same line into one entry - two candidates that ride the exact same
 * lines in the exact same order (e.g. "EWL > WALK > BUS:105 > WALK > EWL")
 * are the same *choice* to a commuter even if they board/alight the bus at
 * a slightly different stop along the way, which is all that tends to
 * differ between Yen's algorithm's top few results on a graph with many
 * closely-spaced bus stops.
 */
function modeSignature(p: PathResult): string {
  const tokens: string[] = [];
  for (const line of p.linesUsed) {
    if (tokens[tokens.length - 1] !== line) tokens.push(line);
  }
  return tokens.join(">");
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Re-derives every hop's ride/wait cost for a full stitched path, so a
 * route assembled from a root prefix + a spur path (each costed
 * independently, starting the spur "fresh" with no known arrival line)
 * reports the boarding pattern the rider would actually experience -
 * notably, whether the hop right at the join is a free continuation or a
 * fresh boarding depends on the root prefix's arrival line, which the spur
 * search itself had no way to know.
 */
function recomputeHopCosts(
  edges: StationEdge[],
  path: string[],
  linesUsed: string[],
  boardingPenaltyMinutes: (line: string, atStation: string) => number
): { totalMinutes: number; legMinutes: number[]; waitMinutes: number[] } {
  const minutesByHop = new Map<string, number>();
  for (const e of edges) minutesByHop.set(hopKey(e), e.minutes);

  const legMinutes: number[] = [];
  const waitMinutes: number[] = [];
  let totalMinutes = 0;
  let arrivalLine = START_LINE;

  for (let i = 0; i < linesUsed.length; i++) {
    const line = linesUsed[i];
    const rideMinutes = minutesByHop.get(`${line}|${path[i]}|${path[i + 1]}`) ?? 0;
    const isBoarding = line !== "WALK" && line !== arrivalLine;
    const wait = isBoarding ? boardingPenaltyMinutes(line, path[i]) : 0;
    legMinutes.push(rideMinutes);
    waitMinutes.push(wait);
    totalMinutes += rideMinutes + wait;
    arrivalLine = line;
  }

  return { totalMinutes: Math.round(totalMinutes * 1000) / 1000, legMinutes, waitMinutes };
}
