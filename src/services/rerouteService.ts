import { getTrainAlerts } from "./trainAlertsService";
import { getLiftOutages } from "./facilitiesService";
import { getWeatherNear } from "./weatherService";
import { getNetworkCrowding } from "./crowdingService";
import { routePlanner } from "../routing/routePlanner";
import { parseCoordinate, stationCoords, findStationCode } from "../routing/graph";
import { CrowdLevelDto, Persona, RerouteSuggestionDto, TrainAlertsDto } from "../types/api";
import { LtaNotConfiguredError } from "../lta/client";
import { MOCK_DISRUPTION_SCENARIOS, MockDisruptionScenario } from "./mockDisruptions";

const NO_KNOWN_DISRUPTIONS: TrainAlertsDto = {
  overallStatus: "normal",
  lines: [],
  generalAdvisories: [],
  fetchedAt: new Date(0).toISOString(),
};

function resolvePointForWeather(input: string): { lat: number; lon: number } | null {
  const coordinate = parseCoordinate(input);
  if (coordinate) return coordinate;
  const code = findStationCode(input);
  return code ? stationCoords(code) : null;
}

export async function suggestReroute(
  origin: string,
  destination: string,
  persona: Persona = "standard",
  departAt?: Date,
  mockDisruption?: MockDisruptionScenario
): Promise<RerouteSuggestionDto | { error: string }> {
  // The routing math itself doesn't need LTA, only the disruption check
  // does - so a missing account key degrades to "assume no disruptions"
  // instead of failing the whole endpoint. A real LTA error (rate limit,
  // outage) still propagates as a 502, since that's worth surfacing.
  // Weather and lift-outage data are pure enrichment: any failure there
  // (including no LTA key) just means the response omits that advisory
  // rather than failing the whole reroute.
  // A caller-selected demo scenario (see src/services/mockDisruptions.ts)
  // skips the live LTA fetch entirely and feeds the planner canned alerts
  // instead, so a disruption reroute can be shown on demand rather than
  // waiting for (or faking) a real MRT incident.
  const alertsPromise: Promise<TrainAlertsDto> = mockDisruption
    ? Promise.resolve(MOCK_DISRUPTION_SCENARIOS[mockDisruption])
    : getTrainAlerts().catch((err) => {
        if (err instanceof LtaNotConfiguredError) return NO_KNOWN_DISRUPTIONS;
        throw err;
      });
  const liftOutagesPromise = getLiftOutages().catch(() => []);
  // Crowding is enrichment, same as weather/lift-outages above: any failure
  // (no LTA key, network error) just means the route is planned without a
  // crowding bias rather than failing the whole reroute request.
  const crowdingPromise = getNetworkCrowding().catch(() => new Map<string, CrowdLevelDto>());
  const originPoint = resolvePointForWeather(origin);
  const destPoint = resolvePointForWeather(destination);
  const originWeatherPromise = originPoint
    ? getWeatherNear(originPoint.lat, originPoint.lon).catch(() => null)
    : Promise.resolve(null);
  const destWeatherPromise = destPoint
    ? getWeatherNear(destPoint.lat, destPoint.lon).catch(() => null)
    : Promise.resolve(null);

  const [alerts, liftOutages, originWeather, destinationWeather, crowding] = await Promise.all([
    alertsPromise,
    liftOutagesPromise,
    originWeatherPromise,
    destWeatherPromise,
    crowdingPromise,
  ]);

  return await routePlanner.suggest(origin, destination, alerts, {
    persona,
    liftOutages,
    originWeather,
    destinationWeather,
    departAt,
    crowding,
  });
}
