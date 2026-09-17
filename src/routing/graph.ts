export interface StationNode {
  code: string;
  name: string;
}

export interface StationEdge {
  from: string; // station code
  to: string; // station code
  line: string; // e.g. "NSL", "EWL" - matches TrainServiceAlerts line codes loosely
  minutes: number;
}

/**
 * A small, illustrative subgraph of central Singapore MRT interchanges and
 * their immediate neighbours - NOT the full rail network. It exists so the
 * disruption-aware reroute endpoint has real graph search + live data to
 * react to for a demo, standing in for the "planned next phase" multi-modal
 * routing engine described in the write-up (full station coverage, bus
 * legs, shortest-path search with dynamically updated edge weights, persona
 * weighting). Extend STATIONS/EDGES with more real stations as needed, or
 * swap this whole module out once the real engine exists - callers only
 * depend on the RoutePlanner interface in routePlanner.ts.
 */
export const STATIONS: StationNode[] = [
  { code: "JUR", name: "Jurong East" },
  { code: "CLE", name: "Clementi" },
  { code: "BNV", name: "Buona Vista" },
  { code: "COM", name: "Commonwealth" },
  { code: "QUE", name: "Queenstown" },
  { code: "RDH", name: "Redhill" },
  { code: "TIB", name: "Tiong Bahru" },
  { code: "OTP", name: "Outram Park" },
  { code: "TPG", name: "Tanjong Pagar" },
  { code: "RFP", name: "Raffles Place" },
  { code: "CTH", name: "City Hall" },
  { code: "DBG", name: "Dhoby Ghaut" },
  { code: "SOM", name: "Somerset" },
  { code: "ORC", name: "Orchard" },
  { code: "NEW", name: "Newton" },
  { code: "BBT", name: "Bukit Batok" },
  { code: "BGB", name: "Bukit Gombak" },
  { code: "CCK", name: "Choa Chu Kang" },
];

const RAW_EDGES: Array<[string, string, string, number]> = [
  // East-West Line, Jurong East <-> City Hall stretch
  ["JUR", "CLE", "EWL", 4],
  ["CLE", "BNV", "EWL", 3],
  ["BNV", "COM", "EWL", 2],
  ["COM", "QUE", "EWL", 2],
  ["QUE", "RDH", "EWL", 2],
  ["RDH", "TIB", "EWL", 2],
  ["TIB", "OTP", "EWL", 2],
  ["OTP", "TPG", "EWL", 2],
  ["TPG", "RFP", "EWL", 2],
  ["RFP", "CTH", "EWL", 2],
  // North-South Line, Jurong East <-> City Hall via the north stretch
  ["JUR", "BBT", "NSL", 3],
  ["BBT", "BGB", "NSL", 2],
  ["BGB", "CCK", "NSL", 3],
  ["CCK", "ORC", "NSL", 14], // collapses the long northern loop into one demo edge
  ["ORC", "SOM", "NSL", 2],
  ["SOM", "DBG", "NSL", 2],
  ["DBG", "CTH", "NSL", 3],
  ["CTH", "RFP", "NSL", 2],
  // Circle Line link used by the Buona Vista interchange
  ["BNV", "DBG", "CCL", 9],
  // Downtown Line link via Newton, another way around a Buona Vista disruption
  ["NEW", "OTP", "DTL", 8],
  ["ORC", "NEW", "NSL", 2],
];

export const EDGES: StationEdge[] = RAW_EDGES.flatMap(([from, to, line, minutes]) => [
  { from, to, line, minutes },
  { from: to, to: from, line, minutes },
]);

export function findStationCode(nameOrCode: string): string | null {
  const needle = nameOrCode.trim().toUpperCase();
  const byCode = STATIONS.find((s) => s.code === needle);
  if (byCode) return byCode.code;
  const byName = STATIONS.find((s) => s.name.toUpperCase() === needle);
  return byName?.code ?? null;
}

export function stationName(code: string): string {
  return STATIONS.find((s) => s.code === code)?.name ?? code;
}
