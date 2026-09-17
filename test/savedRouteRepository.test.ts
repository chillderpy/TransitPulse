import { describe, expect, it } from "vitest";
import { savedRouteRepository } from "../src/repositories/savedRouteRepository";

describe("savedRouteRepository", () => {
  it("adds a route with a default name derived from the stations", () => {
    const route = savedRouteRepository.add({
      ownerId: "device-a",
      originStation: "Jurong East",
      destinationStation: "Raffles Place",
    });
    expect(route.name).toBe("Jurong East to Raffles Place");
    expect(route.id).toBeTruthy();
  });

  it("only lists routes belonging to the requesting owner", () => {
    savedRouteRepository.add({
      ownerId: "device-b",
      originStation: "Bishan",
      destinationStation: "Dhoby Ghaut",
    });
    const forA = savedRouteRepository.listForOwner("device-a");
    const forB = savedRouteRepository.listForOwner("device-b");
    expect(forA.every((r) => r.ownerId === "device-a")).toBe(true);
    expect(forB.every((r) => r.ownerId === "device-b")).toBe(true);
  });

  it("refuses to remove another owner's route", () => {
    const route = savedRouteRepository.add({
      ownerId: "device-c",
      originStation: "Newton",
      destinationStation: "Orchard",
    });
    expect(savedRouteRepository.remove("device-x", route.id)).toBe(false);
    expect(savedRouteRepository.remove("device-c", route.id)).toBe(true);
  });
});
