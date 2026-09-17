import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { getStationCrowding, reportCrowding } from "../services/crowdingService";

export const crowdingRouter = Router();

const querySchema = z.object({
  station: z.string().min(1),
});

crowdingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { station } = querySchema.parse(req.query);
    const result = await getStationCrowding(station);
    res.json(result);
  })
);

const reportSchema = z.object({
  station: z.string().min(1),
  level: z.enum(["low", "medium", "high"]),
});

crowdingRouter.post(
  "/report",
  asyncHandler(async (req, res) => {
    const input = reportSchema.parse(req.body);
    const report = reportCrowding(input);
    res.status(201).json(report);
  })
);
