import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { suggestReroute } from "../services/rerouteService";
import { env } from "../config/env";
import { MOCK_DISRUPTION_SCENARIO_KEYS, MockDisruptionScenario } from "../services/mockDisruptions";

export const rerouteRouter = Router();

const bodySchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  persona: z.enum(["standard", "accessible"]).optional(),
  // ISO 8601 timestamp for a "what if I leave at..." query, mirroring
  // Google Maps' depart-at picker; omitted means "leave now".
  departAt: z.string().datetime({ offset: true }).optional(),
  // Demo/showcase-only: names a canned disruption scenario (see
  // src/services/mockDisruptions.ts) to feed the planner instead of live LTA
  // data. Gated by ENABLE_MOCK_DISRUPTIONS so a real deployment can't have
  // its disruption data spoofed by a caller.
  mockDisruption: z
    .enum(MOCK_DISRUPTION_SCENARIO_KEYS as [MockDisruptionScenario, ...MockDisruptionScenario[]])
    .optional(),
});

rerouteRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { origin, destination, persona, departAt, mockDisruption } = bodySchema.parse(req.body);
    if (mockDisruption && !env.enableMockDisruptions) {
      res.status(403).json({
        error: "Mock disruptions are disabled - set ENABLE_MOCK_DISRUPTIONS=true to enable this demo feature.",
      });
      return;
    }
    const result = await suggestReroute(
      origin,
      destination,
      persona,
      departAt ? new Date(departAt) : undefined,
      mockDisruption
    );
    if ("error" in result) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  })
);
