import { StationEdge } from "./graph";

/**
 * Singapore has no DST and a fixed UTC+8 offset, but the server process
 * itself could run in any timezone - so "is it 8am" has to be asked in
 * Singapore local time explicitly rather than via the server's own clock.
 */
const SGT_TIMEZONE = "Asia/Singapore";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function sgtParts(date: Date): { weekday: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SGT_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    minutesOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export type TimePeriod = "amPeak" | "pmPeak" | "night" | "offPeak";

export const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
  amPeak: "Morning peak",
  pmPeak: "Evening peak",
  night: "Late night",
  offPeak: "Off-peak",
};

// Boundaries follow LTA's own commonly-cited weekday peak windows
// (roughly 7:30-9:30am and 5:30-8pm); night runs 11pm-5am, when MRT/bus
// frequencies drop to their lowest and road traffic is lightest. Everything
// else - including all-day weekends - is off-peak. These are planning-grade
// bands, not measured traffic data (same spirit as the per-hop minutes in
// graph.ts and busGraph.ts).
const NIGHT_START = 23 * 60;
const NIGHT_END = 5 * 60;
const AM_PEAK_START = 7 * 60 + 30;
const AM_PEAK_END = 9 * 60 + 30;
const PM_PEAK_START = 17 * 60 + 30;
const PM_PEAK_END = 20 * 60;

export function classifyPeriod(date: Date = new Date()): TimePeriod {
  const { weekday, minutesOfDay } = sgtParts(date);
  if (minutesOfDay >= NIGHT_START || minutesOfDay < NIGHT_END) return "night";

  const isWeekday = weekday >= 1 && weekday <= 5;
  if (isWeekday) {
    if (minutesOfDay >= AM_PEAK_START && minutesOfDay < AM_PEAK_END) return "amPeak";
    if (minutesOfDay >= PM_PEAK_START && minutesOfDay < PM_PEAK_END) return "pmPeak";
  }
  return "offPeak";
}

// MRT trains run on fixed guideways, so peak/off-peak doesn't slow the
// running time itself the way road traffic does - the effect here is
// smaller and comes from crowding-lengthened station dwell times at peak,
// and from longer waits between trains (wider headways) late at night.
// Buses share the road with everyone else, so congestion swings their
// travel time much harder in both directions.
const MRT_MULTIPLIERS: Record<TimePeriod, number> = {
  amPeak: 1.05,
  pmPeak: 1.05,
  night: 1.15,
  offPeak: 1.0,
};

const BUS_MULTIPLIERS: Record<TimePeriod, number> = {
  amPeak: 1.35,
  pmPeak: 1.35,
  night: 0.85,
  offPeak: 1.0,
};

/** WALK and CYCLE edges are unaffected - pedestrian/cycling pace doesn't change with traffic the way road/rail service does. */
export function speedMultiplier(line: string, period: TimePeriod): number {
  if (line.startsWith("BUS:")) return BUS_MULTIPLIERS[period];
  if (line === "WALK" || line === "CYCLE") return 1;
  return MRT_MULTIPLIERS[period];
}

// Neither buses nor trains arrive the instant you reach the stop/platform -
// boarding one means waiting out some fraction of its headway first. LTA
// doesn't publish per-service headways as machine-readable data (same gap
// as the per-hop minutes above), so these are planning-grade averages of
// half the typical headway at each period, not measured figures:
//  - MRT: ~2-3 min peak headway, ~5-7 min off-peak, ~10-12 min near closing.
//  - Bus: ~8-10 min peak headway, ~12-15 min off-peak, ~20+ min late night
//    (when most services have stopped and only a few remain).
// Modelling this cost is what keeps the planner from stringing together
// many "free" transfers that look fast only because waiting time is
// otherwise assumed to be zero - each extra boarding now costs real minutes,
// so the optimizer only takes it when it's actually worth it.
const MRT_WAIT_MINUTES: Record<TimePeriod, number> = {
  amPeak: 1.5,
  pmPeak: 1.5,
  night: 6,
  offPeak: 3,
};

const BUS_WAIT_MINUTES: Record<TimePeriod, number> = {
  amPeak: 5,
  pmPeak: 5,
  night: 12,
  offPeak: 7,
};

/** Average wait to board `line` if you just arrived (on foot, or via a different line) at `period`. WALK/CYCLE never wait - you set off the moment you start. */
export function boardingWaitMinutes(line: string, period: TimePeriod): number {
  if (line === "WALK" || line === "CYCLE") return 0;
  if (line.startsWith("BUS:")) return BUS_WAIT_MINUTES[period];
  return MRT_WAIT_MINUTES[period];
}

/** Applies the time-of-day multiplier to every rail/bus edge's minutes, leaving walk edges as-is. */
export function scaleEdgesForTime(edges: StationEdge[], date: Date = new Date()): StationEdge[] {
  const period = classifyPeriod(date);
  return edges.map((edge) => ({
    ...edge,
    minutes: Math.round(edge.minutes * speedMultiplier(edge.line, period) * 10) / 10,
  }));
}

// Real per-service first/last-train and first/last-bus times aren't
// published as machine-readable LTA data (same gap as the per-hop minutes
// above), so these are planning-grade, network-wide constants rather than
// per-line/per-service facts:
//  - MRT: every line runs ~5:30am-midnight daily. On the night before a
//    Saturday or Sunday (i.e. Friday and Saturday nights), SMRT/SBS Transit
//    extend last-train timings to roughly 1am the following morning.
//  - Regular (non-NightRider) buses: ~5:30am-12:30am. NightRider services
//    run overnight on a small set of routes, but busGraph.ts's live graph
//    has no per-service operating-hours field to tell a NightRider route
//    apart from a regular one, so that exception isn't modelled here.
const RAIL_FIRST_TRAIN = 5 * 60 + 30;
const RAIL_EXTENDED_LAST_TRAIN = 60; // ~1am, Fri/Sat nights only
const BUS_FIRST_BUS = 5 * 60 + 30;
const BUS_LAST_BUS = 30; // ~12:30am

const FRIDAY = 5;
const SATURDAY = 6;

export function isRailOperating(date: Date = new Date()): boolean {
  const { weekday, minutesOfDay } = sgtParts(date);
  if (minutesOfDay >= RAIL_FIRST_TRAIN) return true;
  const previousDay = (weekday + 6) % 7;
  const extendedLastTrain = previousDay === FRIDAY || previousDay === SATURDAY ? RAIL_EXTENDED_LAST_TRAIN : 0;
  return minutesOfDay < extendedLastTrain;
}

export function isRegularBusOperating(date: Date = new Date()): boolean {
  const { minutesOfDay } = sgtParts(date);
  if (minutesOfDay >= BUS_FIRST_BUS) return true;
  return minutesOfDay < BUS_LAST_BUS;
}

export interface ServiceAvailability {
  railOpen: boolean;
  busOpen: boolean;
  /** Rider-facing explanation of whatever isn't currently running, or null when both are. */
  note: string | null;
}

export function getServiceAvailability(date: Date = new Date()): ServiceAvailability {
  const railOpen = isRailOperating(date);
  const busOpen = isRegularBusOperating(date);
  let note: string | null = null;
  if (!railOpen && !busOpen) {
    note =
      "MRT and regular bus services aren't running at this hour - both typically resume around 5:30am. " +
      "Only overnight NightRider bus routes (not covered by this planner) may be available.";
  } else if (!railOpen) {
    note =
      "MRT isn't running at this hour (typically 5:30am-midnight, extended to ~1am the night before a " +
      "weekend) - showing bus/walking options only.";
  } else if (!busOpen) {
    note = "Regular bus services aren't running at this hour (typically 5:30am-12:30am) - showing MRT/walking options only.";
  }
  return { railOpen, busOpen, note };
}
