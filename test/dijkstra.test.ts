import { describe, expect, it } from "vitest";
import { shortestPath } from "../src/routing/dijkstra";
import { EDGES } from "../src/routing/graph";

// NS1 = Jurong East, EW23 = Clementi, EW21 = Buona Vista, NS26 = Raffles Place
// - see src/routing/graph.ts for the full station code list.

describe("shortestPath", () => {
  it("finds a direct route between adjacent stations", () => {
    const result = shortestPath(EDGES, "NS1", "EW23");
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(["NS1", "EW23"]);
    expect(result!.totalMinutes).toBe(4);
  });

  it("finds a multi-hop route across the network", () => {
    const result = shortestPath(EDGES, "NS1", "NS26");
    expect(result).not.toBeNull();
    expect(result!.path[0]).toBe("NS1");
    expect(result!.path.at(-1)).toBe("NS26");
    expect(result!.totalMinutes).toBeGreaterThan(0);
  });

  it("returns null when no path exists", () => {
    const result = shortestPath(EDGES, "NS1", "NOPE");
    expect(result).toBeNull();
  });

  it("reroutes around a removed edge via an alternate line", () => {
    const withoutBuonaVistaLink = EDGES.filter(
      (e) => !(e.from === "EW20" && e.to === "EW21") && !(e.from === "EW21" && e.to === "EW20")
    );
    const direct = shortestPath(EDGES, "NS1", "NS26");
    const detour = shortestPath(withoutBuonaVistaLink, "NS1", "NS26");
    expect(detour).not.toBeNull();
    expect(detour!.path).not.toEqual(direct!.path);
  });
});
