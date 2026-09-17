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

  it("POST /api/saved-routes creates a route for the given device", async () => {
    const res = await request(app)
      .post("/api/saved-routes")
      .set("X-Device-Id", "test-device")
      .send({ originStation: "Jurong East", destinationStation: "Raffles Place" });
    expect(res.status).toBe(201);
    expect(res.body.originStation).toBe("Jurong East");

    const list = await request(app)
      .get("/api/saved-routes")
      .set("X-Device-Id", "test-device");
    expect(list.body).toHaveLength(1);
  });

  it("POST /api/reroute uses the sample graph without needing an LTA key", async () => {
    const res = await request(app)
      .post("/api/reroute")
      .send({ origin: "Jurong East", destination: "Raffles Place" });
    expect(res.status).toBe(200);
    expect(res.body.originStation).toBe("Jurong East");
  });

  it("GET /api/train-alerts returns 503 when LTA_ACCOUNT_KEY is unset", async () => {
    const res = await request(app).get("/api/train-alerts");
    expect(res.status).toBe(503);
  });
});
