import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { createApp } from "../../src/app";

const post = (deviceId: string, body: object) =>
  request(createApp()).post("/api/saved-routes").set("X-Device-Id", deviceId).send(body);
const route = { originStation: "Jurong East", destinationStation: "Raffles Place" };

describe("TC-V1 saving a named route", () => {
  it("stores the name the user typed, trimmed", async () => {
    const res = await post(randomUUID(), { ...route, name: "  Home to work  " });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Home to work");
  });

  it("only lists a device's own routes", async () => {
    const mine = randomUUID();
    await post(mine, { ...route, name: "Mine" });
    await post(randomUUID(), { ...route, name: "Someone else's" });
    const list = await request(createApp()).get("/api/saved-routes").set("X-Device-Id", mine);
    expect(list.body.map((r: { name: string }) => r.name)).toEqual(["Mine"]);
  });

  it.each(["", "   ", "x".repeat(61)])("rejects an unusable name %j", async (name) => {
    expect((await post(randomUUID(), { ...route, name })).status).toBe(400);
  });
});
