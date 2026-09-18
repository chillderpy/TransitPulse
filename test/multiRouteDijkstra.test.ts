import { describe, expect, it } from "vitest";
import { kShortestPaths } from "../src/routing/multiRouteDijkstra";
import { StationEdge } from "../src/routing/graph";

// Mimics the real-world case that motivated this file: a rail leg (O -> A)
// feeds into a bus bridge, but the bus stop right by A has several nearby
// "boarding points" (B1/B2/B3) all served by the *same* bus service, plus
// one stop (B4) served by a genuinely different service. Yen's algorithm on
// its own ranks these purely by cost, so its 2nd- and 3rd-cheapest paths
// are B2/B3 - the same physical bus ride as the 1st, just a few metres'
// walk away - exactly the "three options that are basically the same"
// degenerate case reported against the real bus graph (BUS:105 via three
// different nearby stops for the EWL-disrupted Jurong East -> Raffles Place
// scenario).
const O = "O";
const A = "A";
const B1 = "B1";
const B2 = "B2";
const B3 = "B3";
const B4 = "B4";
const C = "C";
const D = "D";

const EDGES: StationEdge[] = [
  { from: O, to: A, line: "L1", minutes: 5 },
  { from: A, to: B1, line: "WALK", minutes: 1.0 },
  { from: A, to: B2, line: "WALK", minutes: 1.3 },
  { from: A, to: B3, line: "WALK", minutes: 1.6 },
  { from: A, to: B4, line: "WALK", minutes: 1.0 },
  { from: B1, to: C, line: "BUS:1", minutes: 10 },
  { from: B2, to: C, line: "BUS:1", minutes: 10 },
  { from: B3, to: C, line: "BUS:1", minutes: 10 },
  { from: B4, to: C, line: "BUS:2", minutes: 11 },
  { from: C, to: D, line: "WALK", minutes: 1 },
];

describe("kShortestPaths", () => {
  it("skips near-duplicate candidates that ride the same service from a different nearby stop", () => {
    // Cost order is B1 (17.0) < B2 (17.3) < B3 (17.6) < B4 (18.0), so a plain
    // (non-diversity-aware) k-shortest-paths would return B1/B2/B3 for k=3 -
    // three routes that are the same choice to a rider. This asserts every
    // returned option rides a distinct sequence of lines/modes instead.
    const results = kShortestPaths(EDGES, O, D, 3);

    const modeSignatures = results.map((r) =>
      r.linesUsed.filter((l, i) => l !== r.linesUsed[i - 1]).join(">")
    );
    expect(new Set(modeSignatures).size).toBe(modeSignatures.length);
  });

  it("digs past several near-duplicates to surface a genuinely different route", () => {
    // For k=2, the 2nd result should be the BUS:2 route (B4), not B2 or B3 -
    // even though B2 and B3 both rank cheaper than B4, they're the same
    // choice as the 1st result (B1) and should be skipped.
    const results = kShortestPaths(EDGES, O, D, 2);
    expect(results).toHaveLength(2);
    expect(results[0].totalMinutes).toBeCloseTo(17.0);
    expect(results[1].totalMinutes).toBeCloseTo(18.0);
    expect(results[1].linesUsed).toContain("BUS:2");
  });

  it("falls back to fewer than k results when no further diverse route exists", () => {
    // Only two genuinely distinct route shapes exist in this fixture (the
    // BUS:1 bridge and the BUS:2 bridge) - asking for k=4 shouldn't pad the
    // result with more near-duplicates just to hit the count.
    const results = kShortestPaths(EDGES, O, D, 4);
    expect(results.length).toBeLessThan(4);
    const modeSignatures = results.map((r) =>
      r.linesUsed.filter((l, i) => l !== r.linesUsed[i - 1]).join(">")
    );
    expect(new Set(modeSignatures).size).toBe(modeSignatures.length);
  });
});
