import { describe, it, expect } from "vitest";
import { routePlanner, normalizeLineCode } from "../../src/routing/routePlanner";
import { MOCK_DISRUPTION_SCENARIOS } from "../../src/services/mockDisruptions";
import { EDGES, STATIONS } from "../../src/routing/graph";
import { CrowdLevelDto, TrainAlertsDto } from "../../src/types/api";

// Rail-only graph + fixed Thursday 18:00 SGT keeps every test deterministic and offline.
const NO_BUSES = { stops: new Map(), edges: [], builtAt: 0 };
const PM_PEAK = new Date("2026-10-29T18:00:00+08:00");
const NORMAL: TrainAlertsDto = { overallStatus: "normal", lines: [], generalAdvisories: [], fetchedAt: "" };

/** Alert shaped the way LTA publishes it: bare line code, codes or names in Stations. */
const ltaAlert = (line: string, stations: string[]): TrainAlertsDto => ({
  overallStatus: "disrupted", generalAdvisories: [], fetchedAt: "",
  lines: [{ line, lineCode: line, status: "disrupted", affectedStations: stations,
            freeBoardingBus: false, freeMrtShuttle: false, messages: [] }],
});

const suggest = (o: string, d: string, alerts: TrainAlertsDto, crowding?: Map<string, CrowdLevelDto>) =>
  routePlanner.suggest(o, d, alerts, { busGraph: NO_BUSES, departAt: PM_PEAK, crowding }) as Promise<any>;

const ridesLine = (route: any, line: string) =>
  route.steps.some((s: any) => s.mode === "train" && s.note.startsWith(`${line} line`));

describe("TC-D1 line-name normalisation (LTA publishes codes, not names)", () => {
  it.each([
    ["EWL", "EWL"], ["ewl", "EWL"], ["EAST-WEST LINE", "EWL"], ["East West Line", "EWL"],
    ["NORTH-SOUTH LINE", "NSL"], ["NORTH EAST LINE", "NEL"], ["NEL", "NEL"],
    ["THOMSON-EAST COAST LINE", "TEL"], ["Downtown Line", "DTL"], ["CCL", "CCL"],
  ])("%s -> %s", (raw, code) => expect(normalizeLineCode(raw)).toBe(code));

  it("returns null (not a wrong line) for things we can't map", () => {
    expect(normalizeLineCode("BPL")).toBeNull();
    expect(normalizeLineCode("")).toBeNull();
    expect(normalizeLineCode(undefined)).toBeNull();
  });
});

describe("TC-D2 an LTA-format disruption must actually change the route", () => {
  const variants: Array<[string, TrainAlertsDto]> = [
    ["full-name + station names (old mock format)", MOCK_DISRUPTION_SCENARIOS.ewlBuonaVista],
    ["code + station names", ltaAlert("EWL", ["Clementi", "Buona Vista", "Commonwealth"])],
    ["code + station codes", ltaAlert("EWL", ["EW23", "EW22", "EW21", "EW20"])],
  ];
  it.each(variants)("blocks the span - %s", async (_label, alerts) => {
    const base = await suggest("Clementi", "Bugis", NORMAL);
    const live = await suggest("Clementi", "Bugis", alerts);
    expect(ridesLine(base, "EWL")).toBe(true);
    expect(live.disruptionReason).toMatch(/Avoiding disruption on the EWL/);
    expect(live.deltaMinutes).toBeGreaterThan(0);
    // The planner must not still send the commuter through the blocked hop.
    expect(live.steps.map((s: any) => s.station)).not.toContain("Buona Vista");
  });

  it("fails SAFE: line disrupted but stations unresolvable -> whole line avoided, never ignored", async () => {
    const live = await suggest("Jurong East", "Tanah Merah", ltaAlert("EWL", ["XX99"]));
    expect(live.disruptionReason).not.toBeNull();
    expect(ridesLine(live, "EWL")).toBe(false);
  });
});

describe("TC-D3 honesty of the message shown to a stressed commuter", () => {
  it("never claims to 'avoid' a line the trip doesn't use", async () => {
    const crowd = new Map<string, CrowdLevelDto>([["NS27", "high"]]);
    const r = await suggest("Marina Bay", "Orchard", MOCK_DISRUPTION_SCENARIOS.ewlPayaLebarBugis, crowd);
    expect(r.disruptionReason).toBeNull();
  });

  it("says so plainly when NO alternative exists (instead of 'avoiding' the blocked route)", async () => {
    const r = await suggest("Clementi", "Bugis", ltaAlert("EWL", []));   // whole EWL out, no bus graph
    expect(r.disruptionReason).toMatch(/No alternative found/);
    expect(r.disruptionReason).not.toMatch(/^Avoiding/);
  });

  it("reports real travel minutes, not the crowding ranking cost (same route must not become '+5 min')", async () => {
    const crowd = new Map<string, CrowdLevelDto>([["NS27", "high"]]);
    const r = await suggest("Marina Bay", "Orchard", NORMAL, crowd);
    expect(r.deltaMinutes).toBeCloseTo(0);
    expect(r.totalMinutes).toBe(r.usualMinutes);
  });

  it("flags where the disruption data came from", async () => {
    expect((await suggest("Marina Bay", "Orchard", NORMAL)).disruptionDataStatus).toBe("live");
    expect((await suggest("Marina Bay", "Orchard", { ...NORMAL, dataStatus: "stale" })).disruptionDataStatus).toBe("stale");
  });
});

describe("TC-D4 invariant: no returned option ever rides a hop that is currently blocked", () => {
  const lines = ["NSL", "EWL", "CCL", "DTL", "TEL", "NEL"];
  const ids = STATIONS.map((s) => s.name);
  // Deterministic pseudo-random OD pairs (LCG) so failures are reproducible.
  let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const pairs = Array.from({ length: 40 }, () => [ids[Math.floor(rnd() * ids.length)], ids[Math.floor(rnd() * ids.length)]]);

  it.each(lines)("line %s fully out: options 1..3 for 40 random OD pairs avoid it", async (line) => {
    for (const [o, d] of pairs) {
      if (o === d) continue;
      const r = await suggest(o, d, ltaAlert(line, []));
      if (r.error || /No alternative/.test(r.disruptionReason ?? "")) continue;   // legit: line is the only way
      for (const opt of r.routes) {
        const usesBlocked = opt.steps.some((s: any) => s.mode === "train" && s.note.startsWith(`${line} line`));
        expect(usesBlocked, `${o} -> ${d} option ${opt.id} still rides ${line}`).toBe(false);
        expect(Number.isFinite(opt.totalMinutes) && opt.totalMinutes > 0).toBe(true);
      }
    }
  });
  it("sanity: graph really has edges on every line we test", () => {
    for (const l of lines) expect(EDGES.some((e) => e.line === l)).toBe(true);
  });
});
