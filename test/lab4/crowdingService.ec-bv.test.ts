/**
 * LAB 4 - 3.2.1  BLACK BOX TESTING of a control class: CrowdingService
 * Techniques: Equivalence Class + Boundary Value 
 *
 * Rules followed:
 *  - one test case = at most ONE invalid input, all other inputs valid
 *  - small valid sets (LTA level l/m/h, report level low/medium/high) are enumerated fully
 *  - boundary values only for RANGE parameters (staleness age, report TTL, empty-string station)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Keep the real LtaNotConfiguredError etc.; only replace the network call.
vi.mock("../src/lta/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lta/client")>()),
  fetchLta: vi.fn(),
}));

import { fetchLta } from "../../src/lta/client";
import {
  getStationCrowding,
  reportCrowding,
  UnknownStationError,
} from "../../src/services/crowdingService";
import { crowdReportRepository } from "../../src/repositories/crowdReportRepository";
import { createApp } from "../../src/app";

const NOW = new Date("2026-10-29T10:00:00.000Z");
const TTL_MS = 15 * 60 * 1000;

/** Make every PCDRealTime / PCDForecast call return the given station entry. */
function mockCrowdFeed(opts: {
  station: string;
  liveLevel?: string;
  startTime?: string;
  forecast?: Array<{ Start: string; CrowdLevel: string }>;
}) {
  vi.mocked(fetchLta).mockImplementation(async (endpoint: string) => {
    if (endpoint === "PCDRealTime") {
      return {
        value:
          opts.liveLevel === undefined
            ? []
            : [
                {
                  Station: opts.station,
                  StartTime: opts.startTime ?? NOW.toISOString(),
                  EndTime: NOW.toISOString(),
                  CrowdLevel: opts.liveLevel,
                },
              ],
      };
    }
    // PCDForecast
    return {
      value: opts.forecast
        ? [{ Date: "2026-10-29", Stations: [{ Station: opts.station, Interval: opts.forecast }] }]
        : [],
    };
  });
}

afterEach(() => {
  vi.mocked(fetchLta).mockReset();
});

// ---------------------------------------------------------------------------
// EQUIVALENCE CLASS TESTING
// ---------------------------------------------------------------------------
describe("CrowdingService - Equivalence Class tests (getStationCrowding)", () => {
  // VALID combinations: one row covers station-by-name, station-by-code, single-line and
  // interchange stations, and every LTA level l / m / h (small set => enumerate all).
  it.each([
    ["EC-1", "Jurong East", "NS1", "l", "low"], // by NAME, interchange
    ["EC-2", "NS1", "NS1", "m", "moderate"], // by CODE
    ["EC-3", "Bras Basah", "CC2", "h", "high"], // single-line station
  ])("%s station '%s' (%s), LTA level %s -> %s", async (_id, input, code, ltaLevel, expected) => {
    mockCrowdFeed({ station: code, liveLevel: ltaLevel });
    const result = await getStationCrowding(input);
    expect(result.live.level).toBe(expected);
    expect(result.station).toBe(input);
  });

  it("EC-4 valid station but LTA has no entry for it -> level 'unknown', no timestamp", async () => {
    mockCrowdFeed({ station: "NS1" /* liveLevel omitted => empty feed */ });
    const result = await getStationCrowding("Jurong East");
    expect(result.live.level).toBe("unknown");
    expect(result.live.asOf).toBeNull();
    expect(result.live.staleForSeconds).toBeNull();
  });

  it("EC-5 INVALID LTA level value ('x', not l/m/h) -> 'unknown', does not crash", async () => {
    mockCrowdFeed({ station: "NS1", liveLevel: "x" });
    const result = await getStationCrowding("Jurong East");
    expect(result.live.level).toBe("unknown");
  });

  it("EC-6 INVALID station (not a recognised name/code) -> UnknownStationError, LTA never called", async () => {
    await expect(getStationCrowding("Foo")).rejects.toBeInstanceOf(UnknownStationError);
    expect(fetchLta).not.toHaveBeenCalled();
  });

  it("EC-7 forecast intervals are mapped l/m/h -> low/moderate/high", async () => {
    mockCrowdFeed({
      station: "NS1",
      liveLevel: "l",
      forecast: [
        { Start: "2026-10-29T10:00:00+08:00", CrowdLevel: "l" },
        { Start: "2026-10-29T10:30:00+08:00", CrowdLevel: "m" },
        { Start: "2026-10-29T11:00:00+08:00", CrowdLevel: "h" },
      ],
    });
    const result = await getStationCrowding("Jurong East");
    expect(result.forecast.map((f) => f.level)).toEqual(["low", "moderate", "high"]);
  });
});

describe("CrowdingService - Equivalence Class tests (reportCrowding / crowdsourced)", () => {
  // Valid report levels: enumerate all three. 'medium' must surface as 'moderate'.
  it.each([
    ["EC-8", "Dakota", "low", "low"],
    ["EC-9", "Mountbatten", "medium", "moderate"],
    ["EC-10", "Stadium", "high", "high"],
  ])("%s station %s, report level %s shown as %s", async (_id, station, level, shown) => {
    mockCrowdFeed({ station: "ZZ0" });
    reportCrowding({ station, level: level as "low" | "medium" | "high" });
    const result = await getStationCrowding(station);
    expect(result.crowdsourced).toHaveLength(1);
    expect(result.crowdsourced[0].level).toBe(shown);
  });
});

describe("CrowdingService - Equivalence Class tests (HTTP layer, POST /api/crowding/report)", () => {
  const app = createApp();

  it("EC-11 INVALID report level 'critical' -> 400", async () => {
    const res = await request(app)
      .post("/api/crowding/report")
      .send({ station: "Jurong East", level: "critical" });
    expect(res.status).toBe(400);
  });

  it("EC-12 valid station + valid level -> 201", async () => {
    const res = await request(app)
      .post("/api/crowding/report")
      .send({ station: "Jurong East", level: "high" });
    expect(res.status).toBe(201);
  });

  it("EC-13 INVALID station (not a recognised name/code) -> 400, same rule as getStationCrowding", async () => {
    const res = await request(app)
      .post("/api/crowding/report")
      .send({ station: "Foo", level: "low" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Foo");
  });

  it("EC-14 reportCrowding() with an unrecognised station throws UnknownStationError and stores nothing", () => {
    expect(() => reportCrowding({ station: "Foo", level: "low" })).toThrow(UnknownStationError);
    expect(crowdReportRepository.listActiveForStation("Foo")).toHaveLength(0);
  });

  it("EC-15 valid station given by CODE (NS1) -> 201", async () => {
    const res = await request(app)
      .post("/api/crowding/report")
      .send({ station: "NS1", level: "medium" });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// BOUNDARY VALUE TESTING (range parameters only)
// ---------------------------------------------------------------------------
describe("CrowdingService - Boundary Value tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Range: age of the live reading in seconds. Lower boundary of staleForSeconds is 0
  // (value is clamped with Math.max(0, ...)).  just-below / on / just-above:
  it.each([
    ["BV-1 just-below: reading 1 s in the FUTURE -> staleForSeconds 0", +1_000, 0],
    ["BV-2 on-boundary: reading exactly now -> staleForSeconds 0", 0, 0],
    ["BV-3 just-above: reading 1 s old -> staleForSeconds 1", -1_000, 1],
  ])("%s", async (_name, offsetMs, expectedStale) => {
    mockCrowdFeed({
      station: "NS1",
      liveLevel: "l",
      startTime: new Date(NOW.getTime() + offsetMs).toISOString(),
    });
    const result = await getStationCrowding("Jurong East");
    expect(result.live.staleForSeconds).toBe(expectedStale);
  });

  // Range: age of a crowdsourced report. Valid (active) while age < 15 min (expiresAt > now).
  it("BV-4 just-below TTL (14:59.999) -> report still listed", () => {
    crowdReportRepository.add("BV4-station", "low");
    vi.advanceTimersByTime(TTL_MS - 1);
    expect(crowdReportRepository.listActiveForStation("BV4-station")).toHaveLength(1);
  });

  it("BV-5 on-boundary TTL (15:00.000) -> report expired (strict '>' in prune)", () => {
    crowdReportRepository.add("BV5-station", "low");
    vi.advanceTimersByTime(TTL_MS);
    expect(crowdReportRepository.listActiveForStation("BV5-station")).toHaveLength(0);
  });

  it("BV-6 just-above TTL (15:00.001) -> report expired", () => {
    crowdReportRepository.add("BV6-station", "low");
    vi.advanceTimersByTime(TTL_MS + 1);
    expect(crowdReportRepository.listActiveForStation("BV6-station")).toHaveLength(0);
  });
});

describe("CrowdingService - Boundary Value tests (station string length, HTTP layer)", () => {
  const app = createApp();

  // Range: length of station >= 1 (zod min(1)). Only the lower boundary is checked here;
  // above it the station must also be a recognised name/code (see EC-13).
  it("BV-7 just-below (length 0, empty string) -> 400", async () => {
    const res = await request(app).post("/api/crowding/report").send({ station: "", level: "low" });
    expect(res.status).toBe(400);
  });
});
