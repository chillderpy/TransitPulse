import { TrainAlertsDto } from "../types/api";

// Canned TrainAlertsDto fixtures for demoing/showcasing the reroute engine's
// disruption handling without waiting for a real MRT incident (or without an
// LTA_ACCOUNT_KEY at all). Opt-in only - see rerouteService.suggestReroute,
// which only reaches for one of these when the caller explicitly names it;
// every other call still hits the live LTA feed exactly as before.
export const MOCK_DISRUPTION_SCENARIOS = {
  ewlBuonaVista: {
    overallStatus: "disrupted",
    generalAdvisories: [],
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
    fetchedAt: new Date(0).toISOString(),
  },
  cclBuonaVistaHollandVillage: {
    overallStatus: "disrupted",
    generalAdvisories: [],
    lines: [
      {
        line: "CIRCLE LINE",
        lineCode: "CCL",
        status: "disrupted",
        affectedStations: ["Buona Vista", "Holland Village"],
        freeBoardingBus: false,
        freeMrtShuttle: false,
        messages: ["Train services are disrupted between Buona Vista and Holland Village."],
      },
    ],
    fetchedAt: new Date(0).toISOString(),
  },
  twoLinesEwlCcl: {
    overallStatus: "disrupted",
    generalAdvisories: [],
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
      {
        line: "CIRCLE LINE",
        lineCode: "CCL",
        status: "disrupted",
        affectedStations: ["Buona Vista", "Holland Village"],
        freeBoardingBus: false,
        freeMrtShuttle: false,
        messages: ["Train services are disrupted between Buona Vista and Holland Village."],
      },
    ],
    fetchedAt: new Date(0).toISOString(),
  },
  networkWideOutage: {
    overallStatus: "disrupted",
    generalAdvisories: ["Network-wide disruption drill - all lines affected."],
    lines: (["NSL", "EWL", "CCL", "DTL", "TEL", "NEL"] as const).map((lineCode) => ({
      line: lineCode,
      lineCode,
      status: "disrupted" as const,
      affectedStations: [],
      freeBoardingBus: true,
      freeMrtShuttle: true,
      messages: ["Train services suspended network-wide."],
    })),
    fetchedAt: new Date(0).toISOString(),
  },
} satisfies Record<string, TrainAlertsDto>;

export type MockDisruptionScenario = keyof typeof MOCK_DISRUPTION_SCENARIOS;

export const MOCK_DISRUPTION_SCENARIO_KEYS = Object.keys(
  MOCK_DISRUPTION_SCENARIOS
) as MockDisruptionScenario[];

export function isMockDisruptionScenario(value: string): value is MockDisruptionScenario {
  return Object.prototype.hasOwnProperty.call(MOCK_DISRUPTION_SCENARIOS, value);
}
