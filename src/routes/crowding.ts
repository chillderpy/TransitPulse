import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { getStationCrowding, reportCrowding } from "../services/crowdingService";
import { TRAIN_LINES, TrainLineCode } from "../lta/endpoints";

export const crowdingRouter = Router();

const lineCodes = Object.keys(TRAIN_LINES) as [TrainLineCode, ...TrainLineCode[]];

const querySchema = z.object({
  trainLine: z.enum(lineCodes),
  station: z.string().min(1),
});

crowdingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { trainLine, station } = querySchema.parse(req.query);
    const result = await getStationCrowding(trainLine, station);
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
