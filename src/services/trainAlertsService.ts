import { fetchLta } from "../lta/client";
import { LTA_ENDPOINTS } from "../lta/endpoints";
import { LtaTrainServiceAlertsResponse } from "../types/lta";
import { LineDisruptionDto, TrainAlertsDto } from "../types/api";

// TrainServiceAlerts is documented as near-real-time (updated as incidents
// are declared), so a short cache is enough to avoid hammering LTA on every
// poll without meaningfully delaying disruption detection.
const ALERTS_CACHE_TTL_SECONDS = 60;

export async function getTrainAlerts(): Promise<TrainAlertsDto> {
  const data = await fetchLta<LtaTrainServiceAlertsResponse>(
    LTA_ENDPOINTS.TRAIN_SERVICE_ALERTS,
    { cacheTtlSeconds: ALERTS_CACHE_TTL_SECONDS }
  );

  const statuses = data.value ?? [];
  const overallDisrupted = statuses.some((s) => s.Status === "2");

  const lines: LineDisruptionDto[] = statuses.flatMap((status) => {
    if (status.Status !== "2") return [];
    const segments = status.AffectedSegments ?? [];
    if (segments.length === 0) {
      return [
        {
          line: "Unspecified",
          lineCode: null,
          status: "disrupted" as const,
          affectedStations: [],
          freeBoardingBus: false,
          freeMrtShuttle: false,
          messages: (status.Message ?? []).map((m) => m.Content),
        },
      ];
    }
    return segments.map((seg) => ({
      line: seg.Line,
      lineCode: seg.Line || null,
      status: "disrupted" as const,
      affectedStations: seg.Stations ? seg.Stations.split(",").map((s) => s.trim()) : [],
      freeBoardingBus: seg.FreePublicBus === "Free",
      freeMrtShuttle: seg.FreeMRTShuttle === "Free",
      messages: (status.Message ?? []).map((m) => m.Content),
    }));
  });

  return {
    overallStatus: overallDisrupted ? "disrupted" : "normal",
    lines,
    fetchedAt: new Date().toISOString(),
  };
}

export async function isLineDisrupted(lineCode: string): Promise<boolean> {
  const alerts = await getTrainAlerts();
  return alerts.lines.some(
    (l) => l.status === "disrupted" && l.line.toUpperCase().includes(lineCode.toUpperCase())
  );
}
