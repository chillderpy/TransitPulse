import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crowdReportRepository } from "../src/repositories/crowdReportRepository";

describe("crowdReportRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an active report for the reported station", () => {
    crowdReportRepository.add("Jurong East", "high");
    const active = crowdReportRepository.listActiveForStation("Jurong East");
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe("high");
  });

  it("expires reports after 15 minutes", () => {
    crowdReportRepository.add("Bishan", "medium");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(crowdReportRepository.listActiveForStation("Bishan")).toHaveLength(0);
  });
});
