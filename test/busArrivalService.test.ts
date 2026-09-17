import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../src/lta/client", () => ({
  fetchLta: vi.fn(),
}));

import { fetchLta } from "../src/lta/client";
import { getBusArrivals } from "../src/services/busArrivalService";

function makeNextBus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    OriginCode: "77009",
    DestinationCode: "77009",
    EstimatedArrival: new Date(Date.now() + 60_000).toISOString(),
    Monitored: 1,
    Latitude: "1.3264425",
    Longitude: "103.90597216666667",
    VisitNumber: "1",
    Load: "SEA",
    Feature: "WAB",
    Type: "SD",
    ...overrides,
  };
}

describe("getBusArrivals", () => {
  afterEach(() => {
    vi.mocked(fetchLta).mockReset();
  });

  it("keeps a monitored bus's real coordinates", async () => {
    vi.mocked(fetchLta).mockResolvedValue({
      BusStopCode: "83139",
      Services: [{ ServiceNo: "15", Operator: "GAS", NextBus: makeNextBus(), NextBus2: {}, NextBus3: {} }],
    });

    const result = await getBusArrivals("83139");
    const bus = result.services[0].nextArrivals[0];
    expect(bus.latitude).toBeCloseTo(1.3264425);
    expect(bus.longitude).toBeCloseTo(103.90597216666667);
  });

  it("nulls out a bus's position when LTA marks it unmonitored with sentinel (0,0) coordinates", async () => {
    // Confirmed against the live API: LTA sets Monitored=0 and fills
    // Latitude/Longitude with "0.0" for a bus with no GPS fix yet - a real
    // coordinate (off the coast of Africa), not an absent one. Trusting it
    // is how a bus stop's markers end up plotted outside Singapore.
    vi.mocked(fetchLta).mockResolvedValue({
      BusStopCode: "83139",
      Services: [
        {
          ServiceNo: "150",
          Operator: "SBST",
          NextBus: makeNextBus({ Monitored: 0, Latitude: "0.0", Longitude: "0.0" }),
          NextBus2: {},
          NextBus3: {},
        },
      ],
    });

    const result = await getBusArrivals("83139");
    const bus = result.services[0].nextArrivals[0];
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });

  it("nulls out coordinates that are exactly (0,0) even if Monitored is set", async () => {
    vi.mocked(fetchLta).mockResolvedValue({
      BusStopCode: "83139",
      Services: [
        {
          ServiceNo: "150",
          Operator: "SBST",
          NextBus: makeNextBus({ Monitored: 1, Latitude: "0.0", Longitude: "0.0" }),
          NextBus2: {},
          NextBus3: {},
        },
      ],
    });

    const result = await getBusArrivals("83139");
    const bus = result.services[0].nextArrivals[0];
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });

  it("nulls out coordinates when LTA sends a non-numeric value despite Monitored being set", async () => {
    // A garbled/non-numeric Latitude or Longitude used to slip through as
    // NaN (Number("garbage") isn't null, so the old null-only check missed
    // it), which then crashed the map with "Invalid LatLng object: (NaN, NaN)".
    vi.mocked(fetchLta).mockResolvedValue({
      BusStopCode: "83139",
      Services: [
        {
          ServiceNo: "150",
          Operator: "SBST",
          NextBus: makeNextBus({ Monitored: 1, Latitude: "garbage", Longitude: "103.9" }),
          NextBus2: {},
          NextBus3: {},
        },
      ],
    });

    const result = await getBusArrivals("83139");
    const bus = result.services[0].nextArrivals[0];
    expect(bus.latitude).toBeNull();
    expect(bus.longitude).toBeNull();
  });
});
