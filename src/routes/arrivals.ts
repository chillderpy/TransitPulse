import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { getBusArrivals } from "../services/busArrivalService";

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
