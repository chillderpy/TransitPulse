import { describe, expect, it } from "vitest";
import { StaticGraphRoutePlanner } from "../src/routing/routePlanner";
import { TrainAlertsDto } from "../src/types/api";

const noAlerts: TrainAlertsDto = {
  overallStatus: "normal",
  lines: [],
  fetchedAt: new Date().toISOString(),
};

const ewlDisruptedAtBuonaVista: TrainAlertsDto = {
  overallStatus: "disrupted",
  lines: [
    {
      line: "EAST-WEST LINE",
      lineCode: "EWL",
      status: "disrupted",
      affectedStations: ["Clementi", "Buona Vista", "Commonwealth"],
      freeBoardingBus: true,
      freeMrtShuttle: false,
      messages: ["Train services are disrupted between Clementi and Commonwealth."],
    },
  ],
  fetchedAt: new Date().toISOString(),
};

describe("StaticGraphRoutePlanner", () => {
  const planner = new StaticGraphRoutePlanner();

  it("returns the fastest route with no delta when there is no disruption", () => {
    const result = planner.suggest("Jurong East", "Raffles Place", noAlerts);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.deltaMinutes).toBe(0);
    expect(result.disruptionReason).toBeNull();
  });

  it("reroutes around a disrupted East-West Line segment and reports the delay", () => {
    const result = planner.suggest("Jurong East", "Raffles Place", ewlDisruptedAtBuonaVista);
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

  it("reports an error for a station outside the MRT network", () => {
    const result = planner.suggest("Jurong East", "Somewhere Fictional", noAlerts);
    expect("error" in result).toBe(true);
  });
});
