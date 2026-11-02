import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { getTrainAlerts } from "../services/trainAlertsService";

export const trainAlertsRouter = Router();

trainAlertsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await getTrainAlerts();
    res.json(result);
  })
);
