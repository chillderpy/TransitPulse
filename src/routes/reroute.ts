import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { suggestReroute } from "../services/rerouteService";

export const rerouteRouter = Router();

const bodySchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
});

rerouteRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { origin, destination } = bodySchema.parse(req.body);
    const result = await suggestReroute(origin, destination);
    if ("error" in result) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  })
);
