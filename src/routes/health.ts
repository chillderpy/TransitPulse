import { Router } from "express";
import { isLtaConfigured } from "../config/env";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    ltaConfigured: isLtaConfigured(),
    time: new Date().toISOString(),
  });
});
