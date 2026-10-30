/**
 * LAB 4 - 3.2.2  WHITE BOX (BASIS PATH) TESTING of method #1: suggestReroute()
 * Technique: Control Flow Testing / Basis Path Testing
 *
 * Decision points in suggestReroute (the .catch arrow-callbacks are separate functions):
 *   D1  if (boundaryError)    -> true: return { error }   (coordinate outside Singapore)
 *   D2  if (!originPoint)     -> true: return { error }   (unknown origin, fail fast)
 *   D3  if (!destPoint)       -> true: return { error }   (unknown destination, fail fast)
 *   D4  mockDisruption ? canned alerts : live LTA alerts
 *   CC = 4 decisions + 1 = 5  ->  5 basis paths (BP-1..BP-5)
 * Extra tests BP-6..BP-9 cover the arrow-callbacks: the alerts .catch (now two conditions:
 * LtaNotConfiguredError || LtaApiError, so callback CC = 3) and the enrichment .catch handlers.
 *
 * Baseline BP-1: D1=false, D2=false, D3=false, D4=false (live alerts)  (the "typical" journey)
 * Each further basis path flips exactly ONE decision of the baseline.
 *
 * Collaborators are mocked so each test isolates the control flow of suggestReroute itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/trainAlertsService", () => ({ getTrainAlerts: vi.fn() }));
vi.mock("../src/services/facilitiesService", () => ({ getLiftOutages: vi.fn() }));
vi.mock("../src/services/weatherService", () => ({ getWeatherNear: vi.fn() }));
vi.mock("../src/services/crowdingService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/crowdingService")>()),
  getNetworkCrowding: vi.fn(),
}));
vi.mock("../src/routing/routePlanner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/routing/routePlanner")>()),
  routePlanner: { suggest: vi.fn() },
}));

import { suggestReroute } from "../../src/services/rerouteService";
import { getTrainAlerts } from "../../src/services/trainAlertsService";
import { getLiftOutages } from "../../src/services/facilitiesService";
import { getWeatherNear } from "../../src/services/weatherService";
import { getNetworkCrowding } from "../../src/services/crowdingService";
import { routePlanner } from "../../src/routing/routePlanner";
import { LtaApiError, LtaNotConfiguredError } from "../../src/lta/client";
import { MOCK_DISRUPTION_SCENARIOS } from "../../src/services/mockDisruptions";
import type { TrainAlertsDto } from "../../src/types/api";

const OFF_PEAK = new Date("2026-09-14T10:00:00+08:00");
const NORMAL: TrainAlertsDto = {
  overallStatus: "normal",
  lines: [],
  generalAdvisories: [],
  fetchedAt: new Date(0).toISOString(),
};
const PLAN = { marker: "planner-result" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTrainAlerts).mockResolvedValue(NORMAL);
  vi.mocked(getLiftOutages).mockResolvedValue([]);
  vi.mocked(getWeatherNear).mockResolvedValue(null);
  vi.mocked(getNetworkCrowding).mockResolvedValue(new Map());
  vi.mocked(routePlanner.suggest).mockResolvedValue(PLAN as never);
});

describe("suggestReroute - basis path tests (CC = 5)", () => {
  it("BP-1 baseline: in-Singapore stations, live alerts, both endpoints resolvable", async () => {
    const out = await suggestReroute("Jurong East", "Raffles Place", "standard", OFF_PEAK);
    expect(out).toBe(PLAN);
    expect(getTrainAlerts).toHaveBeenCalledTimes(1);
    expect(getWeatherNear).toHaveBeenCalledTimes(2); // origin + destination
    expect(routePlanner.suggest).toHaveBeenCalledWith(
      "Jurong East",
      "Raffles Place",
      NORMAL,
      expect.objectContaining({ persona: "standard", departAt: OFF_PEAK })
    );
  });

  it("BP-2 flip D1: origin coordinate outside Singapore (Johor Bahru) -> { error }, nothing else called", async () => {
    const out = await suggestReroute("1.4927,103.7414", "Raffles Place");
    expect(out).toEqual({ error: expect.stringContaining("outside Singapore") });
    expect(getTrainAlerts).not.toHaveBeenCalled();
    expect(getWeatherNear).not.toHaveBeenCalled();
    expect(routePlanner.suggest).not.toHaveBeenCalled();
  });

  it("BP-3 flip D2: unknown origin 'Foo' -> { error } immediately, no LTA / weather / planner calls", async () => {
    const out = await suggestReroute("Foo", "Raffles Place", "standard", OFF_PEAK);
    expect(out).toEqual({ error: expect.stringContaining('Unknown origin "Foo"') });
    expect(getTrainAlerts).not.toHaveBeenCalled();
    expect(getWeatherNear).not.toHaveBeenCalled();
    expect(routePlanner.suggest).not.toHaveBeenCalled();
  });

  it("BP-4 flip D3: unknown destination 'Foo' -> { error } immediately, no LTA / weather / planner calls", async () => {
    const out = await suggestReroute("Jurong East", "Foo", "standard", OFF_PEAK);
    expect(out).toEqual({ error: expect.stringContaining('Unknown destination "Foo"') });
    expect(getTrainAlerts).not.toHaveBeenCalled();
    expect(getWeatherNear).not.toHaveBeenCalled();
    expect(routePlanner.suggest).not.toHaveBeenCalled();
  });

  it("BP-5 flip D4: mockDisruption given -> canned alerts used, live LTA alerts NOT fetched", async () => {
    await suggestReroute("Jurong East", "Raffles Place", "standard", OFF_PEAK, "ewlBuonaVista");
    expect(getTrainAlerts).not.toHaveBeenCalled();
    expect(routePlanner.suggest).toHaveBeenCalledWith(
      "Jurong East",
      "Raffles Place",
      MOCK_DISRUPTION_SCENARIOS.ewlBuonaVista,
      expect.anything()
    );
  });
});

describe("suggestReroute - callback paths (branch coverage beyond CC)", () => {
  it("BP-6 live alerts fail with LtaNotConfiguredError -> falls back to 'no known disruptions', flagged unavailable", async () => {
    vi.mocked(getTrainAlerts).mockRejectedValue(new LtaNotConfiguredError());
    const out = await suggestReroute("Jurong East", "Raffles Place", "standard", OFF_PEAK);
    expect(out).toBe(PLAN);
    expect(routePlanner.suggest).toHaveBeenCalledWith(
      "Jurong East",
      "Raffles Place",
      expect.objectContaining({ overallStatus: "normal", lines: [], dataStatus: "unavailable" }),
      expect.anything()
    );
  });

  it("BP-7 live alerts fail with LtaApiError (rate limit / outage, no earlier reading) -> same fallback, flagged unavailable", async () => {
    vi.mocked(getTrainAlerts).mockRejectedValue(new LtaApiError("rate limited", 429));
    const out = await suggestReroute("Jurong East", "Raffles Place", "standard", OFF_PEAK);
    expect(out).toBe(PLAN);
    expect(routePlanner.suggest).toHaveBeenCalledWith(
      "Jurong East",
      "Raffles Place",
      expect.objectContaining({ overallStatus: "normal", lines: [], dataStatus: "unavailable" }),
      expect.anything()
    );
  });

  it("BP-8 live alerts fail with any OTHER error -> error propagates, planner not called", async () => {
    vi.mocked(getTrainAlerts).mockRejectedValue(new Error("LTA down"));
    await expect(
      suggestReroute("Jurong East", "Raffles Place", "standard", OFF_PEAK)
    ).rejects.toThrow("LTA down");
    expect(routePlanner.suggest).not.toHaveBeenCalled();
  });

  it("BP-9 lift / crowding / weather enrichment all fail -> route is still planned", async () => {
    vi.mocked(getLiftOutages).mockRejectedValue(new Error("x"));
    vi.mocked(getNetworkCrowding).mockRejectedValue(new Error("x"));
    vi.mocked(getWeatherNear).mockRejectedValue(new Error("x"));
    const out = await suggestReroute("Jurong East", "Raffles Place", "standard", OFF_PEAK);
    expect(out).toBe(PLAN);
    expect(routePlanner.suggest).toHaveBeenCalledWith(
      "Jurong East",
      "Raffles Place",
      NORMAL,
      expect.objectContaining({ liftOutages: [], originWeather: null, destinationWeather: null })
    );
  });
});
