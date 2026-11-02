import { describe, expect, it } from "vitest";
import {
  classifyPeriod,
  getServiceAvailability,
  isRailOperating,
  isRegularBusOperating,
  scaleEdgesForTime,
  speedMultiplier,
} from "../src/routing/timeOfDay";

// All fixture instants are given with an explicit +08:00 offset so the
// assertions hold regardless of the machine timezone running the suite.
const MON_AM_PEAK = new Date("2026-09-14T08:00:00+08:00"); // Monday
const MON_PM_PEAK = new Date("2026-09-14T18:30:00+08:00");
const MON_MIDDAY = new Date("2026-09-14T13:00:00+08:00");
const MON_LATE_NIGHT = new Date("2026-09-14T00:30:00+08:00");
const SAT_AM_PEAK_HOUR = new Date("2026-09-19T08:00:00+08:00"); // Saturday, same clock time as AM peak

describe("classifyPeriod", () => {
  it("detects weekday morning peak", () => {
    expect(classifyPeriod(MON_AM_PEAK)).toBe("amPeak");
  });

  it("detects weekday evening peak", () => {
    expect(classifyPeriod(MON_PM_PEAK)).toBe("pmPeak");
  });

  it("detects late night regardless of weekday", () => {
    expect(classifyPeriod(MON_LATE_NIGHT)).toBe("night");
  });

  it("treats weekday midday as off-peak", () => {
    expect(classifyPeriod(MON_MIDDAY)).toBe("offPeak");
  });

  it("treats the same clock time on a weekend as off-peak, not peak", () => {
    expect(classifyPeriod(SAT_AM_PEAK_HOUR)).toBe("offPeak");
  });
});

describe("speedMultiplier", () => {
  it("slows buses down more than trains during peak", () => {
    const period = classifyPeriod(MON_AM_PEAK);
    expect(speedMultiplier("BUS:15", period)).toBeGreaterThan(speedMultiplier("EWL", period));
  });

  it("never scales walking edges", () => {
    expect(speedMultiplier("WALK", classifyPeriod(MON_AM_PEAK))).toBe(1);
    expect(speedMultiplier("WALK", classifyPeriod(MON_LATE_NIGHT))).toBe(1);
  });

  it("speeds buses up at night versus off-peak", () => {
    const night = classifyPeriod(MON_LATE_NIGHT);
    const offPeak = classifyPeriod(MON_MIDDAY);
    expect(speedMultiplier("BUS:15", night)).toBeLessThan(speedMultiplier("BUS:15", offPeak));
  });
});

describe("isRailOperating", () => {
  it("is closed in the small hours after an ordinary weeknight", () => {
    // Tuesday 2am - Monday night doesn't get the weekend extension.
    expect(isRailOperating(new Date("2026-09-15T02:00:00+08:00"))).toBe(false);
  });

  it("is open past midnight after a Friday or Saturday night", () => {
    // Saturday 00:45am, i.e. Friday night's extended last-train window.
    expect(isRailOperating(new Date("2026-09-19T00:45:00+08:00"))).toBe(true);
  });

  it("is closed once the Friday-night extension itself ends", () => {
    // Saturday 1:30am - past even the ~1am extended closing time.
    expect(isRailOperating(new Date("2026-09-19T01:30:00+08:00"))).toBe(false);
  });

  it("is open during normal daytime/evening hours", () => {
    expect(isRailOperating(MON_MIDDAY)).toBe(true);
    expect(isRailOperating(MON_PM_PEAK)).toBe(true);
  });
});

describe("isRegularBusOperating", () => {
  it("is closed in the small hours regardless of weekday", () => {
    // Tuesday 2am - well past the ~12:30am last-bus window.
    expect(isRegularBusOperating(new Date("2026-09-15T02:00:00+08:00"))).toBe(false);
  });

  it("is still open just after midnight, before the last-bus cutoff", () => {
    // Tuesday 00:15am - before the ~12:30am last bus, no weekend exception needed.
    expect(isRegularBusOperating(new Date("2026-09-15T00:15:00+08:00"))).toBe(true);
  });

  it("is open during normal daytime/evening hours", () => {
    expect(isRegularBusOperating(MON_MIDDAY)).toBe(true);
  });
});

describe("getServiceAvailability", () => {
  it("reports both modes running with no note during the day", () => {
    const availability = getServiceAvailability(MON_MIDDAY);
    expect(availability).toEqual({ railOpen: true, busOpen: true, note: null });
  });

  it("flags MRT as closed while a late-running weeknight bus is still on the road", () => {
    // Tuesday 00:15am: past MRT's ordinary midnight close, before the bus's ~12:30am one.
    const availability = getServiceAvailability(new Date("2026-09-15T00:15:00+08:00"));
    expect(availability.railOpen).toBe(false);
    expect(availability.busOpen).toBe(true);
    expect(availability.note).toMatch(/MRT isn't running/);
  });

  it("flags buses as closed while the Friday-night MRT extension is still running", () => {
    const availability = getServiceAvailability(new Date("2026-09-19T00:45:00+08:00"));
    expect(availability.railOpen).toBe(true);
    expect(availability.busOpen).toBe(false);
    expect(availability.note).toMatch(/bus services aren't running/);
  });

  it("flags both as closed deep in an ordinary weeknight", () => {
    const availability = getServiceAvailability(new Date("2026-09-15T02:00:00+08:00"));
    expect(availability.railOpen).toBe(false);
    expect(availability.busOpen).toBe(false);
    expect(availability.note).toMatch(/5:30am/);
  });
});

describe("scaleEdgesForTime", () => {
  const edges = [
    { from: "A", to: "B", line: "EWL", minutes: 10 },
    { from: "C", to: "D", line: "BUS:15", minutes: 10 },
    { from: "E", to: "F", line: "WALK", minutes: 10 },
  ];

  it("scales rail and bus edges but leaves walk edges untouched", () => {
    const scaled = scaleEdgesForTime(edges, MON_AM_PEAK);
    expect(scaled[0].minutes).toBeGreaterThan(10);
    expect(scaled[1].minutes).toBeGreaterThan(10);
    expect(scaled[2].minutes).toBe(10);
  });
});
