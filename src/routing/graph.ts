export interface StationNode {
  code: string;
  name: string;
  lat: number; // WGS84 decimal degrees
  lon: number;
}

export interface StationEdge {
  from: string; // station code
  to: string; // station code
  line: string; // "NSL" | "EWL" | "CCL" | "DTL" | "TEL" | "NEL" - matches TrainServiceAlerts line codes loosely
  minutes: number;
}

/**
 * The full Singapore heavy-rail MRT network (NSL, EWL incl. the Changi
 * Airport branch, CCL, DTL, TEL, NEL) - not the earlier small illustrative
 * subgraph. LRT (Bukit Panjang / Sengkang / Punggol LRT) is intentionally
 * out of scope here; it's a separate light-rail feeder system.
 *
 * Coordinates (WGS84) are real station locations sourced from Singapore's
 * OneMap/URA geospatial data via
 * github.com/elliotwutingfeng/singapore_train_station_coordinates, plus the
 * three Circle Line Stage 6 stations (Keppel, Cantonment, Prince Edward
 * Road) that opened 12 Jul 2026, sourced from their Wikipedia infoboxes
 * since they postdate that dataset snapshot.
 *
 * An interchange (e.g. Jurong East, City Hall, Dhoby Ghaut) is one physical
 * station shared by multiple lines, so it gets a single STATIONS entry
 * keyed by whichever line's official code comes first in this priority
 * order: NSL, EWL, CCL, DTL, TEL, NEL. Each line's own EDGES still use that
 * shared code, which is how lines meet at a junction.
 *
 * Edge weights are NOT derived from these coordinates (no straight-line/
 * haversine distance anywhere below), and are no longer a flat per-line
 * average either. Each edge's `minutes` is the real, individual
 * station-to-station running time taken from LTA's own official
 * station-running-time diagrams (the "next train" line-diagram signage
 * shown at platforms), stored in `src/reference/` (CCL-SRD-2026.png,
 * NSL-LD.png, EWL-LD-1920x3723.png, "DTL Travel Time_280225.jpg", NEL.jpg,
 * TEL-LD-Stage-5.png). Those diagrams give cumulative travel time from a
 * reference station to every other station on the line; each edge here is
 * the difference between two adjacent stations' cumulative values (or, for
 * the CCL and DTL/NEL diagrams that already label segments directly, that
 * label as-is). This is why segment times vary per hop (e.g. mostly 2 min
 * on the CCL, but 5 min between Botanic Gardens and Caldecott, which has no
 * intermediate station) instead of one flat rate.
 *
 * Three TEL stations shown on the Stage 5 diagram - Mount Pleasant (TE10),
 * Marina South (TE21), and Founders' Memorial (TE22A) - are built but not
 * yet open to the public, so they're intentionally left out of STATIONS;
 * the edges that span them (Caldecott-Stevens, Marina Bay-Gardens by the
 * Bay, Gardens by the Bay-Tanjong Rhu) instead use the combined
 * pass-through time from the diagram. Bedok South (TE30) and Sungei Bedok
 * (TE31) are a further unopened extension, so the TEL here still ends at
 * Bayshore (TE29), matching the live network today.
 *
 * The Changi Airport branch (Tanah Merah - Expo - Changi Airport) uses its
 * own labelled times from the EWL diagram (3 min, then 5 min) rather than
 * the EWL's general rate.
 *
 * Two real, non-sequential connections don't fall out of simply chaining
 * consecutive station codes, so they're appended explicitly at the end of
 * RAW_EDGES: the Changi Airport branch attaches at Tanah Merah (EW4), and
 * the Circle Line loop closes from Bayfront (CC34, the last Stage 6
 * station) back to Promenade (CC4) - Dhoby Ghaut (CC1) through Promenade
 * (CC4) remains a stub off that ring, not part of the loop itself.
 */
export const STATIONS: StationNode[] = [
  { code: "CC2", name: "Bras Basah", lat: 1.296830, lon: 103.850659 },
  { code: "CC3", name: "Esplanade", lat: 1.293272, lon: 103.855614 },
  { code: "CC4", name: "Promenade", lat: 1.293144, lon: 103.860948 },
  { code: "CC5", name: "Nicoll Highway", lat: 1.299803, lon: 103.863633 },
  { code: "CC6", name: "Stadium", lat: 1.302854, lon: 103.875348 },
  { code: "CC7", name: "Mountbatten", lat: 1.306194, lon: 103.882547 },
  { code: "CC8", name: "Dakota", lat: 1.308375, lon: 103.888668 },
  { code: "CC10", name: "MacPherson", lat: 1.326229, lon: 103.889817 },
  { code: "CC11", name: "Tai Seng", lat: 1.335453, lon: 103.888164 },
  { code: "CC12", name: "Bartley", lat: 1.342847, lon: 103.879725 },
  { code: "CC13", name: "Serangoon", lat: 1.350074, lon: 103.873049 },
  { code: "CC14", name: "Lorong Chuan", lat: 1.351620, lon: 103.864144 },
  { code: "CC16", name: "Marymount", lat: 1.348778, lon: 103.839410 },
  { code: "CC17", name: "Caldecott", lat: 1.337539, lon: 103.839865 },
  { code: "CC19", name: "Botanic Gardens", lat: 1.322256, lon: 103.815619 },
  { code: "CC20", name: "Farrer Road", lat: 1.317455, lon: 103.807489 },
  { code: "CC21", name: "Holland Village", lat: 1.311946, lon: 103.796233 },
  { code: "CC23", name: "one-north", lat: 1.299651, lon: 103.787391 },
  { code: "CC24", name: "Kent Ridge", lat: 1.293401, lon: 103.784498 },
  { code: "CC25", name: "Haw Par Villa", lat: 1.282503, lon: 103.781821 },
  { code: "CC26", name: "Pasir Panjang", lat: 1.276230, lon: 103.791342 },
  { code: "CC27", name: "Labrador Park", lat: 1.272323, lon: 103.802928 },
  { code: "CC28", name: "Telok Blangah", lat: 1.270582, lon: 103.809740 },
  { code: "CC29", name: "HarbourFront", lat: 1.265311, lon: 103.821507 },
  { code: "CC30", name: "Keppel", lat: 1.270000, lon: 103.831110 },
  { code: "CC31", name: "Cantonment", lat: 1.272780, lon: 103.836670 },
  { code: "CC32", name: "Prince Edward Road", lat: 1.273330, lon: 103.847220 },
  { code: "CC34", name: "Bayfront", lat: 1.281872, lon: 103.859075 },
  { code: "CG2", name: "Changi Airport", lat: 1.357319, lon: 103.988348 },
  { code: "DT1", name: "Bukit Panjang", lat: 1.378485, lon: 103.762353 },
  { code: "DT2", name: "Cashew", lat: 1.369366, lon: 103.764699 },
  { code: "DT3", name: "Hillview", lat: 1.362337, lon: 103.767423 },
  { code: "DT4", name: "Hume", lat: 1.354511, lon: 103.769104 },
  { code: "DT5", name: "Beauty World", lat: 1.341227, lon: 103.775792 },
  { code: "DT6", name: "King Albert Park", lat: 1.334742, lon: 103.783084 },
  { code: "DT7", name: "Sixth Avenue", lat: 1.330802, lon: 103.797263 },
  { code: "DT8", name: "Tan Kah Kee", lat: 1.325872, lon: 103.807331 },
  { code: "DT10", name: "Stevens", lat: 1.319901, lon: 103.825833 },
  { code: "DT12", name: "Little India", lat: 1.307164, lon: 103.849278 },
  { code: "DT13", name: "Rochor", lat: 1.303928, lon: 103.852440 },
  { code: "DT17", name: "Downtown", lat: 1.279442, lon: 103.852842 },
  { code: "DT18", name: "Telok Ayer", lat: 1.282280, lon: 103.848323 },
  { code: "DT19", name: "Chinatown", lat: 1.284498, lon: 103.844004 },
  { code: "DT20", name: "Fort Canning", lat: 1.292403, lon: 103.844289 },
  { code: "DT21", name: "Bencoolen", lat: 1.298738, lon: 103.850260 },
  { code: "DT22", name: "Jalan Besar", lat: 1.305377, lon: 103.855429 },
  { code: "DT23", name: "Bendemeer", lat: 1.313660, lon: 103.862969 },
  { code: "DT24", name: "Geylang Bahru", lat: 1.321510, lon: 103.871901 },
  { code: "DT25", name: "Mattar", lat: 1.326866, lon: 103.883253 },
  { code: "DT27", name: "Ubi", lat: 1.329955, lon: 103.899249 },
  { code: "DT28", name: "Kaki Bukit", lat: 1.334963, lon: 103.908455 },
  { code: "DT29", name: "Bedok North", lat: 1.334756, lon: 103.917877 },
  { code: "DT30", name: "Bedok Reservoir", lat: 1.336599, lon: 103.932288 },
  { code: "DT31", name: "Tampines West", lat: 1.345514, lon: 103.938434 },
  { code: "DT33", name: "Tampines East", lat: 1.356212, lon: 103.954858 },
  { code: "DT34", name: "Upper Changi", lat: 1.341740, lon: 103.961473 },
  { code: "DT35", name: "Expo", lat: 1.334898, lon: 103.961963 },
  { code: "EW1", name: "Pasir Ris", lat: 1.372010, lon: 103.949334 },
  { code: "EW2", name: "Tampines", lat: 1.354221, lon: 103.944090 },
  { code: "EW3", name: "Simei", lat: 1.343197, lon: 103.953377 },
  { code: "EW4", name: "Tanah Merah", lat: 1.327254, lon: 103.946548 },
  { code: "EW5", name: "Bedok", lat: 1.324011, lon: 103.930173 },
  { code: "EW6", name: "Kembangan", lat: 1.321038, lon: 103.912947 },
  { code: "EW7", name: "Eunos", lat: 1.319761, lon: 103.903256 },
  { code: "EW8", name: "Paya Lebar", lat: 1.317743, lon: 103.892671 },
  { code: "EW9", name: "Aljunied", lat: 1.316433, lon: 103.882905 },
  { code: "EW10", name: "Kallang", lat: 1.311412, lon: 103.871312 },
  { code: "EW11", name: "Lavender", lat: 1.307372, lon: 103.862838 },
  { code: "EW12", name: "Bugis", lat: 1.299998, lon: 103.856269 },
  { code: "EW15", name: "Tanjong Pagar", lat: 1.276631, lon: 103.846013 },
  { code: "EW16", name: "Outram Park", lat: 1.280839, lon: 103.839250 },
  { code: "EW17", name: "Tiong Bahru", lat: 1.286220, lon: 103.827034 },
  { code: "EW18", name: "Redhill", lat: 1.289630, lon: 103.816773 },
  { code: "EW19", name: "Queenstown", lat: 1.294611, lon: 103.806045 },
  { code: "EW20", name: "Commonwealth", lat: 1.302448, lon: 103.798291 },
  { code: "EW21", name: "Buona Vista", lat: 1.306871, lon: 103.790287 },
  { code: "EW22", name: "Dover", lat: 1.311395, lon: 103.778649 },
  { code: "EW23", name: "Clementi", lat: 1.315931, lon: 103.765604 },
  { code: "EW25", name: "Chinese Garden", lat: 1.342145, lon: 103.732814 },
  { code: "EW26", name: "Lakeside", lat: 1.344264, lon: 103.720967 },
  { code: "EW27", name: "Boon Lay", lat: 1.338356, lon: 103.705320 },
  { code: "EW28", name: "Pioneer", lat: 1.337595, lon: 103.697415 },
  { code: "EW29", name: "Joo Koon", lat: 1.327745, lon: 103.678286 },
  { code: "EW30", name: "Gul Circle", lat: 1.319703, lon: 103.660737 },
  { code: "EW31", name: "Tuas Crescent", lat: 1.321138, lon: 103.648965 },
  { code: "EW32", name: "Tuas West Road", lat: 1.330037, lon: 103.639573 },
  { code: "EW33", name: "Tuas Link", lat: 1.340270, lon: 103.636751 },
  { code: "NE5", name: "Clarke Quay", lat: 1.288606, lon: 103.846645 },
  { code: "NE8", name: "Farrer Park", lat: 1.312448, lon: 103.854270 },
  { code: "NE9", name: "Boon Keng", lat: 1.319447, lon: 103.861681 },
  { code: "NE10", name: "Potong Pasir", lat: 1.331387, lon: 103.869070 },
  { code: "NE11", name: "Woodleigh", lat: 1.339161, lon: 103.870792 },
  { code: "NE13", name: "Kovan", lat: 1.360180, lon: 103.885091 },
  { code: "NE14", name: "Hougang", lat: 1.371215, lon: 103.891749 },
  { code: "NE15", name: "Buangkok", lat: 1.382772, lon: 103.893092 },
  { code: "NE16", name: "Sengkang", lat: 1.391551, lon: 103.895426 },
  { code: "NE17", name: "Punggol", lat: 1.405165, lon: 103.902404 },
  { code: "NE18", name: "Punggol Coast", lat: 1.414939, lon: 103.910214 },
  { code: "NS1", name: "Jurong East", lat: 1.333050, lon: 103.742107 },
  { code: "NS2", name: "Bukit Batok", lat: 1.348997, lon: 103.749541 },
  { code: "NS3", name: "Bukit Gombak", lat: 1.358672, lon: 103.751910 },
  { code: "NS4", name: "Choa Chu Kang", lat: 1.385125, lon: 103.744344 },
  { code: "NS5", name: "Yew Tee", lat: 1.397550, lon: 103.747402 },
  { code: "NS7", name: "Kranji", lat: 1.425189, lon: 103.762059 },
  { code: "NS8", name: "Marsiling", lat: 1.432578, lon: 103.774043 },
  { code: "NS9", name: "Woodlands", lat: 1.436449, lon: 103.787055 },
  { code: "NS10", name: "Admiralty", lat: 1.440589, lon: 103.800975 },
  { code: "NS11", name: "Sembawang", lat: 1.449067, lon: 103.820188 },
  { code: "NS12", name: "Canberra", lat: 1.443235, lon: 103.829540 },
  { code: "NS13", name: "Yishun", lat: 1.429572, lon: 103.834973 },
  { code: "NS14", name: "Khatib", lat: 1.417575, lon: 103.833038 },
  { code: "NS15", name: "Yio Chu Kang", lat: 1.381753, lon: 103.844807 },
  { code: "NS16", name: "Ang Mo Kio", lat: 1.369673, lon: 103.850251 },
  { code: "NS17", name: "Bishan", lat: 1.351048, lon: 103.848682 },
  { code: "NS18", name: "Braddell", lat: 1.340357, lon: 103.846795 },
  { code: "NS19", name: "Toa Payoh", lat: 1.332668, lon: 103.847445 },
  { code: "NS20", name: "Novena", lat: 1.320430, lon: 103.843818 },
  { code: "NS21", name: "Newton", lat: 1.312912, lon: 103.838035 },
  { code: "NS22", name: "Orchard", lat: 1.303445, lon: 103.831874 },
  { code: "NS23", name: "Somerset", lat: 1.300260, lon: 103.839075 },
  { code: "NS24", name: "Dhoby Ghaut", lat: 1.299149, lon: 103.845812 },
  { code: "NS25", name: "City Hall", lat: 1.292935, lon: 103.852608 },
  { code: "NS26", name: "Raffles Place", lat: 1.284067, lon: 103.851459 },
  { code: "NS27", name: "Marina Bay", lat: 1.275809, lon: 103.854982 },
  { code: "NS28", name: "Marina South Pier", lat: 1.271377, lon: 103.862911 },
  { code: "TE1", name: "Woodlands North", lat: 1.448392, lon: 103.785966 },
  { code: "TE3", name: "Woodlands South", lat: 1.427115, lon: 103.793898 },
  { code: "TE4", name: "Springleaf", lat: 1.398141, lon: 103.817921 },
  { code: "TE5", name: "Lentor", lat: 1.384945, lon: 103.836340 },
  { code: "TE6", name: "Mayflower", lat: 1.372108, lon: 103.836782 },
  { code: "TE7", name: "Bright Hill", lat: 1.363282, lon: 103.834472 },
  { code: "TE8", name: "Upper Thomson", lat: 1.354429, lon: 103.832860 },
  { code: "TE12", name: "Napier", lat: 1.306666, lon: 103.819083 },
  { code: "TE13", name: "Orchard Boulevard", lat: 1.302666, lon: 103.823848 },
  { code: "TE15", name: "Great World", lat: 1.294468, lon: 103.833426 },
  { code: "TE16", name: "Havelock", lat: 1.288442, lon: 103.833590 },
  { code: "TE18", name: "Maxwell", lat: 1.280596, lon: 103.843924 },
  { code: "TE19", name: "Shenton Way", lat: 1.277591, lon: 103.850675 },
  { code: "TE22", name: "Gardens by the Bay", lat: 1.279200, lon: 103.867955 },
  { code: "TE23", name: "Tanjong Rhu", lat: 1.297245, lon: 103.873455 },
  { code: "TE24", name: "Katong Park", lat: 1.297801, lon: 103.886236 },
  { code: "TE25", name: "Tanjong Katong", lat: 1.299371, lon: 103.897449 },
  { code: "TE26", name: "Marine Parade", lat: 1.302866, lon: 103.905508 },
  { code: "TE27", name: "Marine Terrace", lat: 1.306767, lon: 103.915266 },
  { code: "TE28", name: "Siglap", lat: 1.309881, lon: 103.929917 },
  { code: "TE29", name: "Bayshore", lat: 1.312936, lon: 103.941842 },
];

const RAW_EDGES: Array<[string, string, string, number]> = [
  ["NS1", "NS2", "NSL", 2],
  ["NS2", "NS3", "NSL", 2],
  ["NS3", "NS4", "NSL", 4],
  ["NS4", "NS5", "NSL", 3],
  ["NS5", "NS7", "NSL", 5],
  ["NS7", "NS8", "NSL", 3],
  ["NS8", "NS9", "NSL", 2],
  ["NS9", "NS10", "NSL", 3],
  ["NS10", "NS11", "NSL", 3],
  ["NS11", "NS12", "NSL", 3],
  ["NS12", "NS13", "NSL", 3],
  ["NS13", "NS14", "NSL", 2],
  ["NS14", "NS15", "NSL", 6],
  ["NS15", "NS16", "NSL", 2],
  ["NS16", "NS17", "NSL", 4],
  ["NS17", "NS18", "NSL", 2],
  ["NS18", "NS19", "NSL", 2],
  ["NS19", "NS20", "NSL", 3],
  ["NS20", "NS21", "NSL", 2],
  ["NS21", "NS22", "NSL", 3],
  ["NS22", "NS23", "NSL", 2],
  ["NS23", "NS24", "NSL", 2],
  ["NS24", "NS25", "NSL", 3],
  ["NS25", "NS26", "NSL", 2],
  ["NS26", "NS27", "NSL", 2],
  ["NS27", "NS28", "NSL", 3],
  ["EW1", "EW2", "EWL", 3],
  ["EW2", "EW3", "EWL", 2],
  ["EW3", "EW4", "EWL", 4],
  ["EW4", "EW5", "EWL", 3],
  ["EW5", "EW6", "EWL", 2],
  ["EW6", "EW7", "EWL", 3],
  ["EW7", "EW8", "EWL", 2],
  ["EW8", "EW9", "EWL", 2],
  ["EW9", "EW10", "EWL", 2],
  ["EW10", "EW11", "EWL", 2],
  ["EW11", "EW12", "EWL", 2],
  ["EW12", "NS25", "EWL", 2],
  ["NS25", "NS26", "EWL", 2],
  ["NS26", "EW15", "EWL", 2],
  ["EW15", "EW16", "EWL", 2],
  ["EW16", "EW17", "EWL", 3],
  ["EW17", "EW18", "EWL", 2],
  ["EW18", "EW19", "EWL", 2],
  ["EW19", "EW20", "EWL", 2],
  ["EW20", "EW21", "EWL", 2],
  ["EW21", "EW22", "EWL", 2],
  ["EW22", "EW23", "EWL", 3],
  ["EW23", "NS1", "EWL", 4],
  ["NS1", "EW25", "EWL", 2],
  ["EW25", "EW26", "EWL", 3],
  ["EW26", "EW27", "EWL", 2],
  ["EW27", "EW28", "EWL", 2],
  ["EW28", "EW29", "EWL", 4],
  ["EW29", "EW30", "EWL", 3],
  ["EW30", "EW31", "EWL", 3],
  ["EW31", "EW32", "EWL", 2],
  ["EW32", "EW33", "EWL", 1],
  ["NS24", "CC2", "CCL", 3],
  ["CC2", "CC3", "CCL", 3],
  ["CC3", "CC4", "CCL", 3],
  ["CC4", "CC5", "CCL", 2],
  ["CC5", "CC6", "CCL", 2],
  ["CC6", "CC7", "CCL", 2],
  ["CC7", "CC8", "CCL", 2],
  ["CC8", "EW8", "CCL", 2],
  ["EW8", "CC10", "CCL", 4],
  ["CC10", "CC11", "CCL", 2],
  ["CC11", "CC12", "CCL", 2],
  ["CC12", "CC13", "CCL", 2],
  ["CC13", "CC14", "CCL", 2],
  ["CC14", "NS17", "CCL", 2],
  ["NS17", "CC16", "CCL", 2],
  // Marymount-Caldecott: the CCL diagram only shows this pair via the long
  // way around the loop (63 min), an artifact of it being a one-direction
  // "next train" sign - inferred as 2 min by the pattern of every other
  // directly-labelled CCL hop, not a value read directly off the diagram.
  ["CC16", "CC17", "CCL", 2],
  ["CC17", "CC19", "CCL", 5],
  ["CC19", "CC20", "CCL", 2],
  ["CC20", "CC21", "CCL", 2],
  ["CC21", "EW21", "CCL", 2],
  ["EW21", "CC23", "CCL", 2],
  ["CC23", "CC24", "CCL", 2],
  ["CC24", "CC25", "CCL", 2],
  ["CC25", "CC26", "CCL", 2],
  ["CC26", "CC27", "CCL", 2],
  ["CC27", "CC28", "CCL", 2],
  ["CC28", "CC29", "CCL", 2],
  ["CC29", "CC30", "CCL", 2],
  ["CC30", "CC31", "CCL", 2],
  ["CC31", "CC32", "CCL", 2],
  ["CC32", "NS27", "CCL", 2],
  ["NS27", "CC34", "CCL", 2],
  ["DT1", "DT2", "DTL", 2],
  ["DT2", "DT3", "DTL", 1],
  ["DT3", "DT4", "DTL", 2],
  ["DT4", "DT5", "DTL", 3],
  ["DT5", "DT6", "DTL", 2],
  ["DT6", "DT7", "DTL", 2],
  ["DT7", "DT8", "DTL", 2],
  ["DT8", "CC19", "DTL", 2],
  ["CC19", "DT10", "DTL", 2],
  ["DT10", "NS21", "DTL", 2],
  ["NS21", "DT12", "DTL", 3],
  ["DT12", "DT13", "DTL", 2],
  ["DT13", "EW12", "DTL", 1],
  ["EW12", "CC4", "DTL", 2],
  ["CC4", "CC34", "DTL", 2],
  ["CC34", "DT17", "DTL", 2],
  ["DT17", "DT18", "DTL", 2],
  ["DT18", "DT19", "DTL", 1],
  ["DT19", "DT20", "DTL", 2],
  ["DT20", "DT21", "DTL", 2],
  ["DT21", "DT22", "DTL", 2],
  ["DT22", "DT23", "DTL", 2],
  ["DT23", "DT24", "DTL", 2],
  ["DT24", "DT25", "DTL", 2],
  ["DT25", "CC10", "DTL", 1],
  ["CC10", "DT27", "DTL", 3],
  ["DT27", "DT28", "DTL", 2],
  ["DT28", "DT29", "DTL", 2],
  ["DT29", "DT30", "DTL", 2],
  ["DT30", "DT31", "DTL", 2],
  ["DT31", "EW2", "DTL", 3],
  ["EW2", "DT33", "DTL", 3],
  ["DT33", "DT34", "DTL", 3],
  ["DT34", "DT35", "DTL", 2],
  ["TE1", "NS9", "TEL", 1],
  ["NS9", "TE3", "TEL", 2],
  ["TE3", "TE4", "TEL", 5],
  ["TE4", "TE5", "TEL", 3],
  ["TE5", "TE6", "TEL", 2],
  ["TE6", "TE7", "TEL", 3],
  ["TE7", "TE8", "TEL", 1],
  ["TE8", "CC17", "TEL", 3],
  ["CC17", "DT10", "TEL", 5],
  ["DT10", "TE12", "TEL", 2],
  ["TE12", "TE13", "TEL", 2],
  ["TE13", "NS22", "TEL", 1],
  ["NS22", "TE15", "TEL", 2],
  ["TE15", "TE16", "TEL", 2],
  ["TE16", "EW16", "TEL", 2],
  ["EW16", "TE18", "TEL", 1],
  ["TE18", "TE19", "TEL", 2],
  ["TE19", "NS27", "TEL", 2],
  ["NS27", "TE22", "TEL", 3],
  ["TE22", "TE23", "TEL", 3],
  ["TE23", "TE24", "TEL", 2],
  ["TE24", "TE25", "TEL", 2],
  ["TE25", "TE26", "TEL", 2],
  ["TE26", "TE27", "TEL", 1],
  ["TE27", "TE28", "TEL", 2],
  ["TE28", "TE29", "TEL", 2],
  ["CC29", "EW16", "NEL", 4],
  ["EW16", "DT19", "NEL", 1],
  ["DT19", "NE5", "NEL", 2],
  ["NE5", "NS24", "NEL", 3],
  ["NS24", "DT12", "NEL", 1],
  ["DT12", "NE8", "NEL", 1],
  ["NE8", "NE9", "NEL", 2],
  ["NE9", "NE10", "NEL", 3],
  ["NE10", "NE11", "NEL", 1],
  ["NE11", "CC13", "NEL", 3],
  ["CC13", "NE13", "NEL", 3],
  ["NE13", "NE14", "NEL", 2],
  ["NE14", "NE15", "NEL", 2],
  ["NE15", "NE16", "NEL", 2],
  ["NE16", "NE17", "NEL", 3],
  ["NE17", "NE18", "NEL", 3],
  ["DT35", "CG2", "EWL", 5],
  ["EW4", "DT35", "EWL", 3],
  ["CC34", "CC4", "CCL", 2],
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

export function stationCoords(code: string): { lat: number; lon: number } {
  const station = STATIONS.find((s) => s.code === code);
  return { lat: station?.lat ?? 0, lon: station?.lon ?? 0 };
}
