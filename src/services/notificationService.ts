import { getTrainAlerts } from "./trainAlertsService";
import { getLiftOutages } from "./facilitiesService";
import { notificationSubscriptionRepository, NotificationSubscription } from "../repositories/notificationSubscriptionRepository";

// PS2 frames "proactive" as the whole point - a push at 07:30 about the
// 08:15 platform, not a screen the commuter has to remember to open. A
// backend can't deliver an actual phone notification without a mobile push
// provider (FCM/APNs) and device tokens, which are outside this project's
// scope - a webhook is the equivalent server-to-server building block: the
// client's own backend (or a simple test receiver) registers a URL and
// gets POSTed to the moment a *new* disruption or lift outage appears on
// what it's watching, rather than having to poll this API itself.
const POLL_INTERVAL_MS = 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 5000;

interface DisruptionSnapshot {
  disruptedLines: Set<string>;
  affectedStations: Set<string>;
  liftOutageStations: Set<string>;
}

let previousSnapshot: DisruptionSnapshot | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function buildSnapshot(): Promise<DisruptionSnapshot> {
  const [alerts, liftOutages] = await Promise.all([
    getTrainAlerts().catch(() => ({ overallStatus: "normal" as const, lines: [], generalAdvisories: [], fetchedAt: "" })),
    getLiftOutages().catch(() => []),
  ]);

  const disruptedLines = new Set<string>();
  const affectedStations = new Set<string>();
  for (const line of alerts.lines) {
    if (line.status !== "disrupted") continue;
    disruptedLines.add(line.line.toUpperCase());
    for (const station of line.affectedStations) affectedStations.add(station.toUpperCase());
  }

  const liftOutageStations = new Set(liftOutages.map((o) => o.stationName.toUpperCase()));

  return { disruptedLines, affectedStations, liftOutageStations };
}

function matches(subscription: NotificationSubscription, newlyBad: Set<string>): boolean {
  const watched = [...subscription.lines, ...subscription.stations].map((s) => s.toUpperCase());
  if (watched.length === 0) return newlyBad.size > 0; // watching everything
  return watched.some((w) => newlyBad.has(w));
}

async function notify(subscription: NotificationSubscription, payload: unknown): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(subscription.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // A subscriber's webhook being down shouldn't take out the poller or
    // any other subscriber's delivery.
  } finally {
    clearTimeout(timeout);
  }
}

export async function pollOnce(): Promise<void> {
  const snapshot = await buildSnapshot();
  const subscriptions = notificationSubscriptionRepository.list();

  if (previousSnapshot && subscriptions.length > 0) {
    const newlyBad = new Set<string>();
    for (const line of snapshot.disruptedLines) {
      if (!previousSnapshot.disruptedLines.has(line)) newlyBad.add(line);
    }
    for (const station of snapshot.affectedStations) {
      if (!previousSnapshot.affectedStations.has(station)) newlyBad.add(station);
    }
    for (const station of snapshot.liftOutageStations) {
      if (!previousSnapshot.liftOutageStations.has(station)) newlyBad.add(station);
    }

    if (newlyBad.size > 0) {
      const payload = {
        type: "new-disruption",
        newlyAffected: [...newlyBad],
        detectedAt: new Date().toISOString(),
      };
      await Promise.all(
        subscriptions.filter((s) => matches(s, newlyBad)).map((s) => notify(s, payload))
      );
    }
  }

  previousSnapshot = snapshot;
}

export function startNotificationPoller(): void {
  if (timer) return;
  timer = setInterval(() => {
    pollOnce().catch(() => {
      // A single poll failing (e.g. a transient LTA error) shouldn't stop
      // future polls - buildSnapshot's own .catch already degrades to
      // "nothing known", so this is a last-resort guard.
    });
  }, POLL_INTERVAL_MS);
}

export function stopNotificationPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
  previousSnapshot = null;
}
