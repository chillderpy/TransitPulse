import { Router } from "express";
import { STATIONS } from "../routing/graph";

// Static station list (code/name/coordinates) for the map UI
export const stationsRouter = Router();

stationsRouter.get("/", (_req, res) => {
  res.json({ stations: STATIONS });
});
