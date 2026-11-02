import { Router } from "express";
import { env, isLtaConfigured } from "../config/env";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    ltaConfigured: isLtaConfigured(),
    mockDisruptionsEnabled: env.enableMockDisruptions,
    time: new Date().toISOString(),
  });
});
