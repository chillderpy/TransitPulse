import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mutable stub so each test scripts what LTA "returns".
const alerts = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../src/services/trainAlertsService", () => ({ getTrainAlerts: () => alerts.fn() }));
vi.mock("../../src/services/facilitiesService", () => ({ getLiftOutages: async () => [], liftOutagesForStation: () => [] }));
// Webhook targets are DNS-checked; keep the tests offline and deterministic.
vi.mock("dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

import { createApp } from "../../src/app";
import { LtaApiError } from "../../src/lta/client";
import { pollOnce, stopNotificationPoller } from "../../src/services/notificationService";
import { notificationSubscriptionRepository } from "../../src/repositories/notificationSubscriptionRepository";

const disrupted = (line = "EWL") => ({
  overallStatus: "disrupted", generalAdvisories: [], fetchedAt: "",
  lines: [{ line, lineCode: line, status: "disrupted", affectedStations: [], freeBoardingBus: false, freeMrtShuttle: false, messages: [] }],
});

beforeEach(() => { alerts.fn.mockReset(); stopNotificationPoller(); });

describe("TC-R1 rush-hour resilience: a flaky upstream must not take the feature away", () => {
  it("LTA alerts feed down -> still returns a route, flagged as unavailable", async () => {
    alerts.fn.mockRejectedValue(new LtaApiError("upstream 503", 503, "TrainServiceAlerts"));
    const res = await request(createApp()).post("/api/reroute").send({ origin: "Clementi", destination: "Bugis" });
    expect(res.status).toBe(200);
    expect(res.body.disruptionDataStatus).toBe("unavailable");
  });
});

describe("TC-N1 notifications: no false alarms", () => {
  it("a transient LTA blip must not re-notify an ongoing disruption", async () => {
    const hook = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    notificationSubscriptionRepository.add({ webhookUrl: "https://example.com/hook" });
    alerts.fn.mockResolvedValueOnce(disrupted());                                   // baseline: EWL already down
    await pollOnce();
    alerts.fn.mockRejectedValueOnce(new LtaApiError("blip", 503, "TrainServiceAlerts"));
    await expect(pollOnce()).rejects.toThrow("blip");                                // blip: poll aborts, snapshot kept
    alerts.fn.mockResolvedValueOnce(disrupted());                                   // still the same incident
    await pollOnce();
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it("a genuinely NEW disruption notifies exactly once", async () => {
    const hook = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    notificationSubscriptionRepository.add({ webhookUrl: "https://example.com/hook2", lines: ["EWL"] });
    alerts.fn.mockResolvedValueOnce({ overallStatus: "normal", lines: [], generalAdvisories: [], fetchedAt: "" });
    await pollOnce();
    alerts.fn.mockResolvedValueOnce(disrupted());
    await pollOnce();
    alerts.fn.mockResolvedValueOnce(disrupted());
    await pollOnce();
    const calls = hook.mock.calls.filter(([u]) => String(u).includes("hook2"));
    expect(calls).toHaveLength(1);
    hook.mockRestore();
  });
});

describe("TC-S1 security: webhook registration", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data", "https://169.254.169.254/latest/meta-data", "https://localhost:6379",
    "https://10.0.0.5/admin", "https://[::1]/", "http://example.com/hook", "not a url",
  ])("rejects non-public or non-https webhook target %s", async (webhookUrl) => {
    const res = await request(createApp()).post("/api/notifications/subscribe").send({ webhookUrl });
    expect(res.status).toBe(400);
  });

  it("accepts a public https webhook", async () => {
    const res = await request(createApp()).post("/api/notifications/subscribe").send({ webhookUrl: "https://example.com/hook" });
    expect(res.status).toBe(201);
  });
});
