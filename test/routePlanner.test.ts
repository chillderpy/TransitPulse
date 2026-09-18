import { describe, expect, it } from "vitest";
import { StaticGraphRoutePlanner } from "../src/routing/routePlanner";
import { BusGraph } from "../src/routing/busGraph";
import { TrainAlertsDto } from "../src/types/api";
import { MOCK_DISRUPTION_SCENARIOS } from "../src/services/mockDisruptions";

const noAlerts: TrainAlertsDto = {
  overallStatus: "normal",
  lines: [],
  generalAdvisories: [],
  fetchedAt: new Date().toISOString(),
};

// Reuses the same canned scenarios the /api/reroute `mockDisruption` demo
// param serves (src/services/mockDisruptions.ts), so the fixtures backing
// these tests and the ones a demo actually clicks through never drift apart.
const ewlDisruptedAtBuonaVista = MOCK_DISRUPTION_SCENARIOS.ewlBuonaVista;
const ewlDisruptedPayaLebarBugis = MOCK_DISRUPTION_SCENARIOS.ewlPayaLebarBugis;

// A fixed, deterministic "leave now" for tests that don't care about
// time-of-day effects but still need rail AND buses to be running - using
// the real wall clock here would make these tests flaky around service
// hours (e.g. the 12:30am-5:30am window when neither mode operates).
const OFF_PEAK_WEEKDAY = new Date("2026-09-14T10:00:00+08:00"); // Monday, mid-morning

// Tests inject this instead of the real getBusGraph() - that's a live,
// multi-thousand-row LTA fetch, which would make every test run slow,
// network-dependent, and non-deterministic.
const EMPTY_BUS_GRAPH: BusGraph = { stops: new Map(), edges: [], builtAt: Date.now() };

describe("StaticGraphRoutePlanner", () => {
  const planner = new StaticGraphRoutePlanner();

  it("returns the fastest route with no delta when there is no disruption", async () => {
    const result = await planner.suggest("Jurong East", "Raffles Place", noAlerts, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.deltaMinutes).toBe(0);
    expect(result.disruptionReason).toBeNull();
  });

  it("keeps the ride description on the destination step for a single-leg, no-transfer journey", async () => {
    // Jurong East -> Raffles Place is a single EWL run with zero interchanges,
    // so the destination step is the ONLY step covering the train leg at
    // all - a regression collapsed this down to a bare "Destination" with no
    // indication a train was ever used.
    const result = await planner.suggest("Jurong East", "Raffles Place", noAlerts, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].mode).toBe("destination");
    expect(result.steps[1].note).toContain("EWL line");
    expect(result.steps[1].note).toContain("Destination");
  });

  it("reroutes around a disrupted East-West Line segment and reports the delay", async () => {
    const result = await planner.suggest("Jurong East", "Raffles Place", ewlDisruptedAtBuonaVista, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.disruptionReason).toContain("EWL");
    expect(result.deltaMinutes).toBeGreaterThan(0);
    // The alert only names the Buona Vista <-> Commonwealth segment, so that's
    // the one edge that gets cut - Commonwealth becomes unreachable without
    // backtracking and drops out of the route, while Clementi (upstream of the
    // cut) still lies on the detour.
    expect(result.steps.some((s) => s.station === "Commonwealth")).toBe(false);
  });

  it("ignores a disruption on a line the route doesn't use", async () => {
    // NSL disrupted way up north (Yishun <-> Khatib) - Jurong East -> Raffles
    // Place never goes near there, so the live route should be identical to
    // the undisrupted baseline.
    const nslDisruptedFarAway: TrainAlertsDto = {
      overallStatus: "disrupted",
      generalAdvisories: [],
      lines: [
        {
          line: "NORTH SOUTH LINE",
          lineCode: "NSL",
          status: "disrupted",
          affectedStations: ["Yishun", "Khatib"],
          freeBoardingBus: false,
          freeMrtShuttle: false,
          messages: ["Train services are disrupted between Yishun and Khatib."],
        },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const result = await planner.suggest("Jurong East", "Raffles Place", nslDisruptedFarAway, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.deltaMinutes).toBe(0);
    expect(result.disruptionReason).toBeNull();
  });

  it("reroutes Rachel's actual Tampines -> Raffles Place commute when the EWL is cut on her segment", async () => {
    // Rachel (WRITEUP.md persona) rides Tampines -> Raffles Place on the EWL
    // at 07:40 on a weekday. ewlBuonaVista/twoLinesEwlCcl above sit on the
    // Jurong side of the line and never touch her route (that's exactly the
    // "why doesn't this disruption affect my commute" case) - this scenario
    // instead cuts the EWL across the stretch she actually rides
    // (Paya Lebar - Bugis), so it should genuinely reroute and delay her.
    const RACHEL_AM_PEAK = new Date("2026-09-14T07:40:00+08:00"); // Monday AM peak
    const result = await planner.suggest("Tampines", "Raffles Place", ewlDisruptedPayaLebarBugis, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: RACHEL_AM_PEAK,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.disruptionReason).toContain("EWL");
    expect(result.deltaMinutes).toBeGreaterThan(0);
    // Paya Lebar itself stays on the route (it's where she interchanges onto
    // the detour), but the blocked interior of the cut segment drops out.
    for (const name of ["Aljunied", "Kallang", "Lavender", "Bugis"]) {
      expect(result.steps.some((s) => s.station === name)).toBe(false);
    }
  });

  it("does NOT block an edge when only one of its two endpoint stations is named as affected", async () => {
    // Same EWL "disrupted" status as ewlDisruptedAtBuonaVista, but the alert
    // only names Buona Vista, not its neighbour Commonwealth - per the
    // "bothNamed" rule in edgesAvoidingDisruptedLines, an edge is only cut
    // when BOTH its endpoints are named, so this segment should stay open
    // and the route should be unaffected.
    const oneSidedNamedStation: TrainAlertsDto = {
      overallStatus: "disrupted",
      generalAdvisories: [],
      lines: [
        {
          line: "EAST-WEST LINE",
          lineCode: "EWL",
          status: "disrupted",
          affectedStations: ["Buona Vista"],
          freeBoardingBus: false,
          freeMrtShuttle: false,
          messages: ["Delays near Buona Vista."],
        },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const result = await planner.suggest("Jurong East", "Raffles Place", oneSidedNamedStation, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.deltaMinutes).toBe(0);
    expect(result.disruptionReason).toBeNull();
  });

  it("falls back to the usual route (no phantom delay) when a fully-disrupted line leaves no live alternative", async () => {
    // No affectedStations at all means "we can't tell which segment, so
    // treat the whole line as down." Tai Seng and Bartley sit on the CCL
    // with no other line or bus stop reaching either of them, so with the
    // bus graph empty, a fully-blocked CCL leaves *no* live path at all -
    // shortestPath returns null, and suggest() falls back to the "usual"
    // (undisrupted) route rather than failing the request. Since live then
    // equals usual, this is NOT reported as a disruption reroute either -
    // there's no alternative being taken, just the same route repeated.
    const cclFullyDisrupted: TrainAlertsDto = {
      overallStatus: "disrupted",
      generalAdvisories: [],
      lines: [
        {
          line: "CIRCLE LINE",
          lineCode: "CCL",
          status: "disrupted",
          affectedStations: [],
          freeBoardingBus: true,
          freeMrtShuttle: false,
          messages: ["Circle Line services suspended network-wide."],
        },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const result = await planner.suggest("Tai Seng", "Bartley", cclFullyDisrupted, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.deltaMinutes).toBe(0);
    expect(result.disruptionReason).toBeNull();
  });

  it("actually blocks disrupted lines for the network-wide outage scenario", async () => {
    // Regression: this scenario used to build each LineDisruptionDto with
    // `line: lineCode` (e.g. "EWL") instead of the full name (e.g.
    // "EAST-WEST LINE") edgesAvoidingDisruptedLines() matches against, so it
    // silently blocked nothing at all. Reuses the synthetic express-bus
    // fixture from the "falls back onto a bus route" test above: with EWL
    // (among the other five) genuinely blocked, the only rail line between
    // Tuas Link and Pasir Ris is down, so the route must go via the bus
    // bridge - before the fix, the unblocked rail path would win instead.
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };
    const result = await planner.suggest("Tuas Link", "Pasir Ris", MOCK_DISRUPTION_SCENARIOS.networkWideOutage, {
      busGraph,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.steps.some((s) => s.mode === "bus" && s.note.includes("999"))).toBe(true);
  });

  it("reroutes around simultaneous disruptions on two different lines", async () => {
    // EWL cut at Buona Vista<->Commonwealth (as above) AND CCL cut at Buona
    // Vista<->Holland Village - the second segment is exactly the detour the
    // single-disruption test above relies on to get around the first, so
    // this forces a real second-choice reroute rather than just falling
    // back onto the same CCL detour.
    const twoLinesDisrupted = MOCK_DISRUPTION_SCENARIOS.twoLinesEwlCcl;
    const result = await planner.suggest("Jurong East", "Raffles Place", twoLinesDisrupted, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.disruptionReason).toContain("EWL");
    expect(result.disruptionReason).toContain("CCL");
    expect(result.deltaMinutes).toBeGreaterThan(0);
  });

  it("offers multiple ranked, distinct routes to choose between when disrupted", async () => {
    // The commuter is choosing between several new disruption-aware routes,
    // not between the old route and one new one - so a disruption with more
    // than one viable detour should come back with more than one option,
    // fastest first, each taking a genuinely different path.
    const result = await planner.suggest("Jurong East", "Raffles Place", ewlDisruptedAtBuonaVista, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.routes.length).toBeGreaterThan(1);
    expect(result.routes.length).toBeLessThanOrEqual(3);

    // Fastest-first ordering.
    for (let i = 1; i < result.routes.length; i++) {
      expect(result.routes[i].totalMinutes).toBeGreaterThanOrEqual(result.routes[i - 1].totalMinutes);
    }

    // Every option is a genuinely different route, not the same path repeated.
    const stationSequences = result.routes.map((r) => r.steps.map((s) => s.station).join(">"));
    expect(new Set(stationSequences).size).toBe(result.routes.length);

    // ids are stable and ordered.
    expect(result.routes.map((r) => r.id)).toEqual(result.routes.map((_, i) => `option-${i + 1}`));

    // Every option is explained as a disruption reroute, and reports a
    // slower time than the pre-disruption baseline kept as context.
    for (const route of result.routes) {
      expect(route.disruptionReason).toContain("EWL");
      expect(route.deltaMinutes).toBeGreaterThan(0);
    }
  });

  it("mirrors the fastest route option into the top-level fields for single-route callers", async () => {
    const result = await planner.suggest("Jurong East", "Raffles Place", ewlDisruptedAtBuonaVista, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const fastest = result.routes[0];
    expect(result.totalMinutes).toBe(fastest.totalMinutes);
    expect(result.deltaMinutes).toBe(fastest.deltaMinutes);
    expect(result.transfers).toBe(fastest.transfers);
    expect(result.disruptionReason).toBe(fastest.disruptionReason);
    expect(result.steps).toEqual(fastest.steps);
    expect(result.livePath).toEqual(fastest.livePath);
  });

  it("falls back to a single route option when there is no alternate path at all", async () => {
    // Same fully-disrupted CCL scenario used above, where the live graph has
    // no path whatsoever and suggest() falls back to the "usual" route -
    // with only one path in existence, there's nothing to offer a second
    // option from, so routes should contain exactly that one fallback.
    const cclFullyDisrupted: TrainAlertsDto = {
      overallStatus: "disrupted",
      generalAdvisories: [],
      lines: [
        {
          line: "CIRCLE LINE",
          lineCode: "CCL",
          status: "disrupted",
          affectedStations: [],
          freeBoardingBus: true,
          freeMrtShuttle: false,
          messages: ["Circle Line services suspended network-wide."],
        },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const result = await planner.suggest("Tai Seng", "Bartley", cclFullyDisrupted, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].id).toBe("option-1");
  });

  it("falls back onto a bus route when the only rail line between two points is fully disrupted", async () => {
    // Same synthetic express-bus pair used elsewhere in this file, but this
    // time paired with an EWL-wide outage (no affectedStations => whole line
    // down) - the rail path Tuas Link -> Pasir Ris becomes impossible, so the
    // live route must be built entirely around the bus leg.
    const ewlFullyDisrupted: TrainAlertsDto = {
      overallStatus: "disrupted",
      generalAdvisories: [],
      lines: [
        {
          line: "EAST-WEST LINE",
          lineCode: "EWL",
          status: "disrupted",
          affectedStations: [],
          freeBoardingBus: true,
          freeMrtShuttle: false,
          messages: ["East-West Line services suspended network-wide."],
        },
      ],
      fetchedAt: new Date().toISOString(),
    };
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };
    const result = await planner.suggest("Tuas Link", "Pasir Ris", ewlFullyDisrupted, {
      busGraph,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.steps.some((s) => s.mode === "bus" && s.note.includes("999"))).toBe(true);
  });

  it("has nothing to reroute around when trains aren't running at all, disruption or not", async () => {
    // A disruption flag layered on top of a departure time when MRT is
    // already closed for the night is a no-op: rail edges are already
    // excluded from both the "usual" and "live" graphs by service hours, so
    // the disrupted-line bookkeeping shouldn't invent a phantom delay.
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };
    const result = await planner.suggest("Tuas Link", "Pasir Ris", ewlDisruptedAtBuonaVista, {
      busGraph,
      departAt: new Date("2026-09-15T00:15:00+08:00"), // MRT closed, buses still running
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.deltaMinutes).toBe(0);
    expect(result.disruptionReason).toBeNull();
  });

  it("reports an error for a station outside the MRT and bus network", async () => {
    const result = await planner.suggest("Jurong East", "Somewhere Fictional", noAlerts, {
      busGraph: EMPTY_BUS_GRAPH,
    });
    expect("error" in result).toBe(true);
  });

  it("walks in from a bare coordinate to the nearest station", async () => {
    // ~110m from Jurong East (NS1 / EW24), well within the standard 1200m radius.
    const result = await planner.suggest("1.3335,103.7430", "Raffles Place", noAlerts, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.originStation).toBe("Your location");
    expect(result.steps[0].mode).toBe("origin");
    expect(result.steps[1].mode).toBe("walk");
    expect(result.steps[1].station).toBe("Jurong East");
    expect(result.steps[1].distanceMeters).toBeGreaterThan(0);
  });

  it("rejects a coordinate too far from any station for the accessible persona's shorter walk radius", async () => {
    // ~110m from Jurong East - within both the standard 1200m and accessible
    // 600m radius, so the accessible persona still succeeds here.
    const nearby = await planner.suggest("1.3335,103.7430", "Raffles Place", noAlerts, {
      persona: "accessible",
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in nearby).toBe(false);

    // >4km from the nearest station (Boon Lay) - well outside either radius.
    const tooFar = await planner.suggest("1.3000,103.7000", "Raffles Place", noAlerts, {
      persona: "accessible",
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in tooFar).toBe(true);
  });

  it("surfaces an accessibility warning when a lift outage is provided for a station on the route", async () => {
    const result = await planner.suggest("Bukit Panjang", "Little India", noAlerts, {
      persona: "accessible",
      liftOutages: [
        { stationCode: "DT10", stationName: "Stevens", line: "DTL", liftDescription: "Test outage" },
      ],
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.accessibilityWarnings.some((w) => w.includes("Stevens"))).toBe(true);
  });

  it("returns a confidence range that brackets the point estimate", async () => {
    const result = await planner.suggest("Jurong East", "Raffles Place", noAlerts, {
      busGraph: EMPTY_BUS_GRAPH,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.confidenceRangeMinutes.min).toBeLessThanOrEqual(result.totalMinutes);
    expect(result.confidenceRangeMinutes.max).toBeGreaterThanOrEqual(result.totalMinutes);
  });

  it("prefers a fast bus leg over a much longer rail detour", async () => {
    // Tuas Link and Pasir Ris sit at opposite ends of the East-West Line -
    // the real rail path between them is ~34 hops. A synthetic express bus
    // stop pair a short walk from each, served by one 5-minute hop of
    // service "999", should win outright over that rail detour.
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };

    const result = await planner.suggest("Tuas Link", "Pasir Ris", noAlerts, {
      busGraph,
      departAt: OFF_PEAK_WEEKDAY,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.steps.some((s) => s.mode === "bus" && s.note.includes("999"))).toBe(true);
    expect(result.totalMinutes).toBeLessThan(20);
  });

  it("estimates the bus ride itself as slower during weekday peak than late at night", async () => {
    // Same synthetic express-bus pair as above - isolates the bus speed
    // multiplier from graph topology since both runs take the identical
    // path. This checks the ride time specifically, not totalMinutes: night
    // buses also run far less often than peak ones, so the boarding wait
    // (src/routing/timeOfDay.ts's boardingWaitMinutes) can now legitimately
    // make the night trip's *total* time longer despite its faster ride -
    // sparse service outweighing an empty road, which is realistic, not a
    // bug.
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };

    const peak = await planner.suggest("Tuas Link", "Pasir Ris", noAlerts, {
      busGraph,
      departAt: new Date("2026-09-14T08:00:00+08:00"), // Monday morning peak
    });
    const night = await planner.suggest("Tuas Link", "Pasir Ris", noAlerts, {
      busGraph,
      departAt: new Date("2026-09-14T00:15:00+08:00"), // late night, still within the ~12:30am last-bus window
    });
    expect("error" in peak).toBe(false);
    expect("error" in night).toBe(false);
    if ("error" in peak || "error" in night) return;

    expect(peak.timeContext.period).toBe("amPeak");
    expect(night.timeContext.period).toBe("night");

    const busRideMinutes = (result: typeof peak) => {
      const step = result.steps.find((s) => s.note.includes("999"));
      const match = step?.note.match(/([\d.]+) min ride/);
      return match ? Number(match[1]) : NaN;
    };
    expect(busRideMinutes(peak)).toBeGreaterThan(busRideMinutes(night));
  });

  it("excludes MRT overnight but still finds a bus route that's running", async () => {
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };

    // Tuesday 00:15am: past MRT's ordinary midnight close, before the ~12:30am last bus.
    const result = await planner.suggest("Tuas Link", "Pasir Ris", noAlerts, {
      busGraph,
      departAt: new Date("2026-09-15T00:15:00+08:00"),
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.steps.some((s) => s.mode === "bus" && s.note.includes("999"))).toBe(true);
    expect(result.serviceHoursNote).toMatch(/MRT isn't running/);
  });

  it("reports a helpful error when neither MRT nor buses are running at all", async () => {
    const busGraph: BusGraph = {
      builtAt: Date.now(),
      stops: new Map([
        ["90001", { code: "90001", description: "Near Tuas Link", roadName: "Test Rd", lat: 1.3403, lon: 103.6368 }],
        ["90002", { code: "90002", description: "Near Pasir Ris", roadName: "Test Rd", lat: 1.3720, lon: 103.9493 }],
      ]),
      edges: [
        { from: "90001", to: "90002", line: "BUS:999", minutes: 5 },
        { from: "90001", to: "EW33", line: "WALK", minutes: 1 },
        { from: "EW33", to: "90001", line: "WALK", minutes: 1 },
        { from: "90002", to: "EW1", line: "WALK", minutes: 1 },
        { from: "EW1", to: "90002", line: "WALK", minutes: 1 },
      ],
    };

    // Tuesday 2am: well past both MRT's and the regular bus network's last service.
    const result = await planner.suggest("Tuas Link", "Pasir Ris", noAlerts, {
      busGraph,
      departAt: new Date("2026-09-15T02:00:00+08:00"),
    });
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toMatch(/5:30am/);
  });
});
