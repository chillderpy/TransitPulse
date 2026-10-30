import { getTrainAlerts } from "./trainAlertsService";
import { getLiftOutages } from "./facilitiesService";
import { getWeatherNear } from "./weatherService";
import { getNetworkCrowding } from "./crowdingService";
import { routePlanner } from "../routing/routePlanner";
import { parseCoordinate, stationCoords, findStationCode } from "../routing/graph";
import { CrowdLevelDto, Persona, RerouteSuggestionDto, TrainAlertsDto } from "../types/api";
import { LtaApiError, LtaNotConfiguredError } from "../lta/client";
import { MOCK_DISRUPTION_SCENARIOS, MockDisruptionScenario } from "./mockDisruptions";
import { outOfBoundsMessage } from "../geo/endpointValidation";

const NO_KNOWN_DISRUPTIONS: TrainAlertsDto = {
  overallStatus: "normal",
  lines: [],
  generalAdvisories: [],
  fetchedAt: new Date(0).toISOString(),
  dataStatus: "unavailable",
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
  // Reject a "lat,lon" origin/destination that falls outside Singapore (Johor,
  // Batam, open sea) up front, before any LTA / weather calls are made. The
  // route handler turns this { error } into a 422, same as an unknown station.
  const boundaryError = outOfBoundsMessage(origin, destination);
  if (boundaryError) return { error: boundaryError };

  // Fail fast on a name/code we can't place on the graph, before any LTA / weather calls.
  const originPoint = resolvePointForWeather(origin);
  if (!originPoint) {
    return { error: `Unknown origin "${origin}". Use a station name/code, or a "lat,lon" pair within Singapore.` };
  }
  const destPoint = resolvePointForWeather(destination);
  if (!destPoint) {
    return { error: `Unknown destination "${destination}". Use a station name/code, or a "lat,lon" pair within Singapore.` };
  }

  // The routing math itself doesn't need LTA, only the disruption check
  // does - so a missing key or an LTA error with no earlier reading to fall
  // back on degrades to "assume no disruptions", flagged as unavailable in
  // the response, instead of failing the whole endpoint at rush hour.
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
        if (err instanceof LtaNotConfiguredError || err instanceof LtaApiError) return NO_KNOWN_DISRUPTIONS;
        throw err;
      });
  const liftOutagesPromise = getLiftOutages().catch(() => []);
  // Crowding is enrichment, same as weather/lift-outages above: any failure
  // (no LTA key, network error) just means the route is planned without a
  // crowding bias rather than failing the whole reroute request.
  const crowdingPromise = getNetworkCrowding().catch(() => new Map<string, CrowdLevelDto>());
  const originWeatherPromise = getWeatherNear(originPoint.lat, originPoint.lon).catch(() => null);
  const destWeatherPromise = getWeatherNear(destPoint.lat, destPoint.lon).catch(() => null);

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
