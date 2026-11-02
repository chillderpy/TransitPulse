import { parseCoordinate } from "../routing/graph";
import { isInSingapore } from "./singaporeBoundary";

/**
 * True only for a "lat,lon" input that parses but falls outside Singapore.
 * Station names/codes (and anything that doesn't parse as a coordinate) are
 * not this function's concern - they're resolved, or rejected, elsewhere.
 */
export function isCoordinateOutsideSingapore(input: string): boolean {
  const coordinate = parseCoordinate(input);
  return coordinate !== null && !isInSingapore(coordinate.lat, coordinate.lon);
}

/**
 * Error message for a reroute request whose origin and/or destination is a
 * coordinate outside Singapore, or null when both are acceptable.
 */
export function outOfBoundsMessage(origin: string, destination: string): string | null {
  const offenders = [
    { label: "Origin", value: origin },
    { label: "Destination", value: destination },
  ].filter((e) => isCoordinateOutsideSingapore(e.value));
  if (offenders.length === 0) return null;
  const who = offenders.map((e) => `${e.label} (${e.value.trim()})`).join(" and ");
  return `${who} ${offenders.length === 1 ? "is" : "are"} outside Singapore. TransitPulse only plans journeys within Singapore.`;
}
