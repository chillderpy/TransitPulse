import { getTrainAlerts } from "./trainAlertsService";
import { routePlanner } from "../routing/routePlanner";
import { RerouteSuggestionDto, TrainAlertsDto } from "../types/api";
import { LtaNotConfiguredError } from "../lta/client";

const NO_KNOWN_DISRUPTIONS: TrainAlertsDto = {
  overallStatus: "normal",
  lines: [],
  fetchedAt: new Date(0).toISOString(),
};

export async function suggestReroute(
  origin: string,
  destination: string
): Promise<RerouteSuggestionDto | { error: string }> {
  // The routing math itself doesn't need LTA, only the disruption check
  // does - so a missing account key degrades to "assume no disruptions"
  // instead of failing the whole endpoint. A real LTA error (rate limit,
  // outage) still propagates as a 502, since that's worth surfacing.
  let alerts: TrainAlertsDto;
  try {
    alerts = await getTrainAlerts();
  } catch (err) {
    if (err instanceof LtaNotConfiguredError) {
      alerts = NO_KNOWN_DISRUPTIONS;
    } else {
      throw err;
    }
  }
  return routePlanner.suggest(origin, destination, alerts);
}
