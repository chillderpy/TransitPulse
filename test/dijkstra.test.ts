import { describe, expect, it } from "vitest";
import { shortestPath } from "../src/routing/dijkstra";
import { EDGES } from "../src/routing/graph";

describe("shortestPath", () => {
  it("finds a direct route between adjacent stations", () => {
    const result = shortestPath(EDGES, "JUR", "CLE");
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(["JUR", "CLE"]);
    expect(result!.totalMinutes).toBe(4);
  });

  it("finds a multi-hop route across the sample graph", () => {
    const result = shortestPath(EDGES, "JUR", "RFP");
    expect(result).not.toBeNull();
    expect(result!.path[0]).toBe("JUR");
    expect(result!.path.at(-1)).toBe("RFP");
    expect(result!.totalMinutes).toBeGreaterThan(0);
  });

  it("returns null when no path exists", () => {
    const result = shortestPath(EDGES, "JUR", "NOPE");
    expect(result).toBeNull();
  });

  it("reroutes around a removed edge via an alternate line", () => {
    const withoutBuonaVistaLink = EDGES.filter(
      (e) => !(e.from === "CLE" && e.to === "BNV") && !(e.from === "BNV" && e.to === "CLE")
    );
    const direct = shortestPath(EDGES, "JUR", "RFP");
    const detour = shortestPath(withoutBuonaVistaLink, "JUR", "RFP");
    expect(detour).not.toBeNull();
    expect(detour!.path).not.toEqual(direct!.path);
  });
});
