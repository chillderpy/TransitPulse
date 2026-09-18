import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("app", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/arrivals/bus/:code rejects a malformed bus stop code", async () => {
    const res = await request(app).get("/api/arrivals/bus/abc");
    expect(res.status).toBe(400);
  });

  it("GET /api/saved-routes requires an X-Device-Id header", async () => {
    const res = await request(app).get("/api/saved-routes");
    expect(res.status).toBe(400);
  });

  const TEST_DEVICE_ID = "5b3a6f1e-6b8b-4b8a-9b8a-6b8b4b8a9b8a";

  it("POST /api/saved-routes creates a route for the given device", async () => {
    const res = await request(app)
      .post("/api/saved-routes")
      .set("X-Device-Id", TEST_DEVICE_ID)
      .send({ originStation: "Jurong East", destinationStation: "Raffles Place" });
    expect(res.status).toBe(201);
    expect(res.body.originStation).toBe("Jurong East");

    const list = await request(app)
      .get("/api/saved-routes")
      .set("X-Device-Id", TEST_DEVICE_ID);
    expect(list.body).toHaveLength(1);
  });

  it("GET /api/saved-routes rejects a non-UUID X-Device-Id", async () => {
    const res = await request(app)
      .get("/api/saved-routes")
      .set("X-Device-Id", "not-a-uuid");
    expect(res.status).toBe(400);
  });

  it(
    "POST /api/reroute uses the sample graph without needing an LTA key",
    async () => {
      const res = await request(app)
        .post("/api/reroute")
        .send({ origin: "Jurong East", destination: "Raffles Place" });
      expect(res.status).toBe(200);
      expect(res.body.originStation).toBe("Jurong East");
    },
    // This hits the real live LTA bus-stop endpoint uncached (no busGraph
    // override, unlike routePlanner.test.ts) - a cold fetch across ~5,200
    // stops alone measured at 3-4s, and now also runs kShortestPaths (see
    // multiRouteDijkstra.ts) against that real graph on top of it, so the
    // default 5s test timeout leaves too little margin for real network
    // variance.
    15000
  );

  it("GET /api/train-alerts returns 503 when LTA_ACCOUNT_KEY is unset", async () => {
    const res = await request(app).get("/api/train-alerts");
    expect(res.status).toBe(503);
  });
});
