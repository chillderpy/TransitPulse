import { describe, expect, it } from "vitest";
import { isInSingapore } from "../src/geo/singaporeBoundary";
import { isCoordinateOutsideSingapore, outOfBoundsMessage } from "../src/geo/endpointValidation";

describe("isInSingapore", () => {
  it.each([
    ["Marina Bay Sands", 1.2834, 103.8607],
    ["Orchard", 1.3048, 103.8318],
    ["Changi Airport T3", 1.3564, 103.9864],
    ["Tuas", 1.32, 103.64],
    ["Woodlands", 1.4369, 103.7865],
    ["Sentosa", 1.2494, 103.8303],
  ])("accepts %s", (_name, lat, lon) => {
    expect(isInSingapore(lat, lon)).toBe(true);
  });

  it.each([
    ["Johor Bahru", 1.4927, 103.7414],
    ["Pasir Gudang (Johor)", 1.45, 103.93],
    ["Batam, Indonesia", 1.13, 104.05],
    ["open sea south of the island", 1.2, 103.85],
    ["Jurong Island (excluded)", 1.265, 103.69],
    ["Pulau Ubin (excluded)", 1.4044, 103.9667],
    ["null island", 0, 0],
  ])("rejects %s", (_name, lat, lon) => {
    expect(isInSingapore(lat, lon)).toBe(false);
  });

  it("rejects non-finite input", () => {
    expect(isInSingapore(NaN, 103.8)).toBe(false);
    expect(isInSingapore(1.3, Infinity)).toBe(false);
  });
});

describe("endpoint validation", () => {
  it("only flags coordinates, never station names", () => {
    expect(isCoordinateOutsideSingapore("Jurong East")).toBe(false);
    expect(isCoordinateOutsideSingapore("NS1")).toBe(false);
    expect(isCoordinateOutsideSingapore("1.3335,103.7430")).toBe(false);
    expect(isCoordinateOutsideSingapore("1.4927,103.7414")).toBe(true);
  });

  it("names which endpoint is out of bounds", () => {
    expect(outOfBoundsMessage("1.4927,103.7414", "Raffles Place")).toMatch(/^Origin \(1\.4927,103\.7414\) is outside Singapore/);
    expect(outOfBoundsMessage("Jurong East", "1.13,104.05")).toMatch(/^Destination .* is outside Singapore/);
    expect(outOfBoundsMessage("1.4927,103.7414", "1.13,104.05")).toMatch(/^Origin .* and Destination .* are outside Singapore/);
    expect(outOfBoundsMessage("Jurong East", "1.3048,103.8318")).toBeNull();
  });
});
