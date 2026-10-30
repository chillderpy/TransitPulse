/**
 * LAB 4 - 3.2.2  WHITE BOX (BASIS PATH) TESTING of method #2: toLatLon() in busArrivalService
 *         (+ toEta() as a smaller second example) and BOUNDARY VALUE test of busStopCode length.
 *
 * toLatLon / toEta are module-private, so they are driven through the public getBusArrivals().
 *
 * toLatLon decision points (each || / && condition counted as its own decision):
 *   D1 Monitored < 1
 *   D2 !isFinite(lat)    D3 !isFinite(lon)    D4 lat === 0    D5 lon === 0
 *   CC = 5 + 1 = 6  ->  6 basis paths (LL-1..LL-6)
 * toEta decisions: D1 !estimatedArrival, D2 isNaN(arrival)  -> CC = 3 (ETA-1..ETA-3)
 *
 * Test IDs match docs/Lab4_TestDesign.md (BUS-EC / BUS-BV are the bus stop code tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lta/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lta/client")>()),
  fetchLta: vi.fn(),
}));

import { fetchLta } from "../../src/lta/client";
import { getBusArrivals } from "../../src/services/busArrivalService";
import { createApp } from "../../src/app";

const NOW = new Date("2026-10-29T10:00:00.000Z");

function nextBus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    OriginCode: "77009",
    DestinationCode: "77009",
    EstimatedArrival: new Date(NOW.getTime() + 120_000).toISOString(),
    Monitored: 1,
    Latitude: "1.3264425",
    Longitude: "103.9059721",
    VisitNumber: "1",
    Load: "SEA",
    Feature: "WAB",
    Type: "SD",
    ...overrides,
  };
}

async function firstBus(overrides: Partial<Record<string, unknown>>) {
  vi.mocked(fetchLta).mockResolvedValue({
    BusStopCode: "83139",
    Services: [{ ServiceNo: "15", Operator: "GAS", NextBus: nextBus(overrides), NextBus2: {}, NextBus3: {} }],
  });
  const result = await getBusArrivals("83139");
  return result.services[0].nextArrivals[0];
}

describe("busArrivalService - basis path tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchLta).mockReset();
  });

  // ---- toLatLon, CC = 6 ----------------------------------------------------
  it("LL-1 baseline: monitored bus, valid non-zero coordinates -> coordinates kept", async () => {
    const bus = await firstBus({});
    expect(bus.latitude).toBeCloseTo(1.3264425);
    expect(bus.longitude).toBeCloseTo(103.9059721);
  });

  it("LL-2 flip D1: Monitored = 0 (even with real coordinates) -> null / null", async () => {
    const bus = await firstBus({ Monitored: 0 });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });

  it("LL-3 flip D2: latitude not a number -> null / null", async () => {
    const bus = await firstBus({ Latitude: "abc" });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });

  it("LL-4 flip D3: longitude not a number (lat valid) -> null / null", async () => {
    const bus = await firstBus({ Longitude: "abc" });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });

  it("LL-5 D4 true, D5 false: lat = 0 but lon != 0 -> coordinates kept (not the (0,0) sentinel)", async () => {
    const bus = await firstBus({ Latitude: "0.0", Longitude: "103.9" });
    expect(bus.latitude).toBe(0);
    expect(bus.longitude).toBeCloseTo(103.9);
  });

  it("LL-6 D4 true, D5 true: (0,0) sentinel -> null / null", async () => {
    const bus = await firstBus({ Latitude: "0.0", Longitude: "0.0" });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });

  // ---- toEta, CC = 3 --------------------------------------------------------
  it("ETA-1 baseline: valid future timestamp (+120 s) -> 120 s / 2 min", async () => {
    const bus = await firstBus({});
    expect(bus.etaSeconds).toBe(120);
    expect(bus.etaMinutes).toBe(2);
  });

  it("ETA-2 flip D1: empty EstimatedArrival -> null / null", async () => {
    const bus = await firstBus({ EstimatedArrival: "" });
    expect(bus.etaSeconds).toBeNull();
    expect(bus.etaMinutes).toBeNull();
  });

  it("ETA-3 flip D2: unparseable EstimatedArrival -> null / null", async () => {
    const bus = await firstBus({ EstimatedArrival: "not-a-date" });
    expect(bus.etaSeconds).toBeNull();
    expect(bus.etaMinutes).toBeNull();
  });

  it("ETA-4 boundary: arrival 30 s in the PAST is clamped to 0 (never negative)", async () => {
    const bus = await firstBus({ EstimatedArrival: new Date(NOW.getTime() - 30_000).toISOString() });
    expect(bus.etaSeconds).toBe(0);
    expect(bus.etaMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY VALUE: busStopCode must be exactly 5 digits (route regex ^\d{5}$)
// ---------------------------------------------------------------------------
describe("GET /api/arrivals/bus/:busStopCode - equivalence class + boundary value (HTTP layer)", () => {
  const app = createApp();

  afterEach(() => {
    vi.mocked(fetchLta).mockReset();
  });

  it("BUS-BV-1 just-below: 4 digits '8313' -> 400", async () => {
    const res = await request(app).get("/api/arrivals/bus/8313");
    expect(res.status).toBe(400);
  });

  it("BUS-BV-2 on-boundary: 5 digits '83139' -> 200", async () => {
    vi.mocked(fetchLta).mockResolvedValue({ BusStopCode: "83139", Services: [] });
    const res = await request(app).get("/api/arrivals/bus/83139");
    expect(res.status).toBe(200);
    expect(res.body.busStopCode).toBe("83139");
  });

  it("BUS-BV-3 just-above: 6 digits '831390' -> 400", async () => {
    const res = await request(app).get("/api/arrivals/bus/831390");
    expect(res.status).toBe(400);
  });

  it("BUS-EC-1 INVALID format: 5 characters but not digits 'abcde' -> 400", async () => {
    const res = await request(app).get("/api/arrivals/bus/abcde");
    expect(res.status).toBe(400);
  });
});
