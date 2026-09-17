import { randomUUID } from "crypto";

export interface CrowdReport {
  id: string;
  station: string;
  level: "low" | "medium" | "high";
  reportedAt: Date;
  expiresAt: Date;
}

const REPORT_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory store for crowdsourced "report crowding here" submissions.
 * Swap for a real database (the write-up's planned "persistent storage")
 * once this needs to survive a restart or scale beyond one process; the
 * interface below (add/listActiveForStation) is what a DB-backed
 * implementation should preserve.
 */
class CrowdReportRepository {
  private reports: CrowdReport[] = [];

  add(station: string, level: CrowdReport["level"]): CrowdReport {
    const now = new Date();
    const report: CrowdReport = {
      id: randomUUID(),
      station,
      level,
      reportedAt: now,
      expiresAt: new Date(now.getTime() + REPORT_TTL_MS),
    };
    this.reports.push(report);
    this.prune();
    return report;
  }

  listActiveForStation(station: string): CrowdReport[] {
    this.prune();
    return this.reports.filter(
      (r) => r.station.toLowerCase() === station.toLowerCase()
    );
  }

  private prune(): void {
    const now = Date.now();
    this.reports = this.reports.filter((r) => r.expiresAt.getTime() > now);
  }
}

export const crowdReportRepository = new CrowdReportRepository();
