/**
 * LAB 4 - 3.2.2  WHITE BOX (BASIS PATH) TESTING of method #2: toLatLon() in busArrivalService
 *         and BOUNDARY VALUE test of busStopCode length.
 *
 * toLatLon is module-private, so it is driven through the public getBusArrivals().
 *
 * toLatLon decision points:
 *   D1  if (bus.Monitored < 1)
 *   D2  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0))
 *   |edges| = 8, |nodes| = 7 (incl. one exit node)  ->  CC = 8 - 7 + 2 = 3 = 2 + 1
 *   ->  3 basis paths (LL-1..LL-3):
 *        P1 baseline  D1=false, D2=false  (coordinates returned)
 *        P2 flip D1   D1=true             (Monitored = 0)
 *        P3 flip D2   D1=false, D2=true   (coordinates rejected)
 * LL-4..LL-6 are NOT extra basis paths: they re-use P3 (LL-4, LL-6) or P1 (LL-5) but make every
 * individual condition inside D2 decide the outcome once (condition-level coverage beyond CC).
 *
 * Test IDs match docs/Lab4_TestDesign.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
 
vi.mock("../../src/lta/client", async (importOriginal) => ({
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
 
  // ---- toLatLon, CC = 3 (basis paths LL-1..LL-3) -----------------------------
  it("LL-1 P1 baseline (D1 false, D2 false): monitored bus, valid non-zero coordinates -> coordinates kept", async () => {
    const bus = await firstBus({});
    expect(bus.latitude).toBeCloseTo(1.3264425);
    expect(bus.longitude).toBeCloseTo(103.9059721);
  });
 
  it("LL-2 P2 flip D1 (D1 true): Monitored = 0 (even with real coordinates) -> null / null", async () => {
    const bus = await firstBus({ Monitored: 0 });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });
 
  it("LL-3 P3 flip D2 (D1 false, D2 true): latitude not a number -> null / null", async () => {
    const bus = await firstBus({ Latitude: "abc" });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });
 
  // ---- toLatLon, condition-level tests inside D2 (beyond CC) -----------------
  it("LL-4 D2 via 2nd condition (P3 again): longitude not a number (lat valid) -> null / null", async () => {
    const bus = await firstBus({ Longitude: "abc" });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });
 
  it("LL-5 D2 stays false (P1 again): lat = 0 but lon != 0 -> coordinates kept (not the (0,0) sentinel)", async () => {
    const bus = await firstBus({ Latitude: "0.0", Longitude: "103.9" });
    expect(bus.latitude).toBe(0);
    expect(bus.longitude).toBeCloseTo(103.9);
  });
 
  it("LL-6 D2 via 3rd condition (P3 again): (0,0) sentinel -> null / null", async () => {
    const bus = await firstBus({ Latitude: "0.0", Longitude: "0.0" });
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
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
 
  it("BV-1 just-below: 4 digits '8313' -> 400", async () => {
    const res = await request(app).get("/api/arrivals/bus/8313");
    expect(res.status).toBe(400);
  });
 
  it("BV-2 on-boundary: 5 digits '83139' -> 200", async () => {
    vi.mocked(fetchLta).mockResolvedValue({ BusStopCode: "83139", Services: [] });
    const res = await request(app).get("/api/arrivals/bus/83139");
    expect(res.status).toBe(200);
    expect(res.body.busStopCode).toBe("83139");
  });
 
  it("BV-3 just-above: 6 digits '831390' -> 400", async () => {
    const res = await request(app).get("/api/arrivals/bus/831390");
    expect(res.status).toBe(400);
  });
 
  it("EC-1 INVALID format: 5 characters but not digits 'abcde' -> 400", async () => {
    const res = await request(app).get("/api/arrivals/bus/abcde");
    expect(res.status).toBe(400);
  });
});