import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { getBusArrivals } from "../services/busArrivalService";
import { getNearbyBusStops } from "../services/nearbyBusStopsService";
import { isInSingapore } from "../geo/singaporeBoundary";

export const arrivalsRouter = Router();

const paramsSchema = z.object({
  busStopCode: z.string().regex(/^\d{5}$/, "busStopCode must be a 5-digit LTA bus stop code"),
});
const querySchema = z.object({ serviceNo: z.string().optional() });

arrivalsRouter.get(
  "/bus/:busStopCode",
  asyncHandler(async (req, res) => {
    const { busStopCode } = paramsSchema.parse(req.params);
    const { serviceNo } = querySchema.parse(req.query);
    const result = await getBusArrivals(busStopCode, serviceNo);
    res.json(result);
  })
);

const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(50).max(2000).default(500),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

// Bus stops near a GPS position - lets the UI offer stops to pick instead of
// asking the user to type a 5-digit busStopCode
arrivalsRouter.get(
  "/nearby",
  asyncHandler(async (req, res) => {
    const { lat, lon, radius, limit } = nearbyQuerySchema.parse(req.query);
    if (!isInSingapore(lat, lon)) {
      res.status(400).json({
        error: "Your location is outside Singapore. TransitPulse can only find bus stops within Singapore.",
      });
      return;
    }
    res.json(await getNearbyBusStops(lat, lon, radius, limit));
  })
);
