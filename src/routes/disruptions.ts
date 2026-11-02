import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { getActivePlannedRoadWorks } from "../services/roadWorksService";

export const disruptionsRouter = Router();

// Planned disruptions (roadworks) as distinct from live TrainServiceAlerts
disruptionsRouter.get(
  "/planned",
  asyncHandler(async (req, res) => {
    const roadNameFilter = typeof req.query.roadName === "string" ? req.query.roadName.toUpperCase() : null;
    const roadWorks = await getActivePlannedRoadWorks();
    const filtered = roadNameFilter
      ? roadWorks.filter((r) => r.roadName.toUpperCase().includes(roadNameFilter))
      : roadWorks;
    res.json({ roadWorks: filtered, fetchedAt: new Date().toISOString() });
  })
);
