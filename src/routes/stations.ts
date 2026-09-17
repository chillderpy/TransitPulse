import { Router } from "express";
import { STATIONS } from "../routing/graph";

// Static station list (code/name/coordinates) for the map UI - not derived
// from any live LTA call, so it's safe to serve with no query params.
export const stationsRouter = Router();

stationsRouter.get("/", (_req, res) => {
  res.json({ stations: STATIONS });
});
