import { describe, expect, it } from "vitest";
import request from "supertest";
import { vi } from "vitest";

vi.mock("../src/routing/busGraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/routing/busGraph")>();
  return { ...actual, getBusGraph: vi.fn() };
});

import { getBusGraph, BusGraph } from "../src/routing/busGraph";
import { rankNearbyBusStops } from "../src/services/nearbyBusStopsService";
import { createApp } from "../src/app";

// Three stops around Jurong East MRT (1.3331, 103.7422): ~0 m, ~111 m north, ~1.1 km north
function fakeGraph(): BusGraph {
  const mk = (code: string, lat: number, lon: number) => ({
    code,
    description: `Stop ${code}`,
    roadName: "Jurong Gateway Rd",
    lat,
    lon,
  });
  return {
    stops: new Map([
      ["far", mk("far", 1.3431, 103.7422)],
      ["near", mk("near", 1.3331, 103.7422)],
      ["mid", mk("mid", 1.3341, 103.7422)],
    ]),
    edges: [],
    builtAt: Date.now(),
  };
}

describe("rankNearbyBusStops", () => {
  it("returns stops within the radius, nearest first, with distance and walk time", () => {
    const result = rankNearbyBusStops(fakeGraph(), 1.3331, 103.7422, 500, 5);
    expect(result.map((s) => s.busStopCode)).toEqual(["near", "mid"]);
    expect(result[0].distanceMeters).toBe(0);
    expect(result[1].distanceMeters).toBeGreaterThan(100);
    expect(result[1].distanceMeters).toBeLessThan(125);
    expect(result[0].walkMinutes).toBeGreaterThanOrEqual(1); // never "0 min walk"
  });

  it("applies the limit after sorting", () => {
    const result = rankNearbyBusStops(fakeGraph(), 1.3331, 103.7422, 5000, 2);
    expect(result.map((s) => s.busStopCode)).toEqual(["near", "mid"]);
  });

  it("returns an empty list when nothing is in range", () => {
    expect(rankNearbyBusStops(fakeGraph(), 1.3331, 103.7422, 50, 5).map((s) => s.busStopCode)).toEqual(["near"]);
    expect(rankNearbyBusStops({ ...fakeGraph(), stops: new Map() }, 1.3331, 103.7422, 500, 5)).toEqual([]);
  });
});

describe("GET /api/arrivals/nearby", () => {
  const app = createApp();

  it("returns nearby stops for a Singapore location", async () => {
    vi.mocked(getBusGraph).mockResolvedValue(fakeGraph());
    const res = await request(app).get("/api/arrivals/nearby?lat=1.3331&lon=103.7422&radius=500");
    expect(res.status).toBe(200);
    expect(res.body.stops.map((s: { busStopCode: string }) => s.busStopCode)).toEqual(["near", "mid"]);
    expect(res.body.origin).toEqual({ latitude: 1.3331, longitude: 103.7422 });
  });

  it("rejects a location outside Singapore", async () => {
    const res = await request(app).get("/api/arrivals/nearby?lat=3.139&lon=101.6869"); // Kuala Lumpur
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outside Singapore/);
  });

  it("rejects missing or non-numeric coordinates", async () => {
    expect((await request(app).get("/api/arrivals/nearby")).status).toBe(400);
    expect((await request(app).get("/api/arrivals/nearby?lat=abc&lon=103.8")).status).toBe(400);
  });

  it("rejects an out-of-range radius", async () => {
    const res = await request(app).get("/api/arrivals/nearby?lat=1.3331&lon=103.7422&radius=99999");
    expect(res.status).toBe(400);
  });
});
