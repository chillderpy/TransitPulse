import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { savedRouteRepository } from "../repositories/savedRouteRepository";

export const savedRoutesRouter = Router();

// No account system yet, so callers identify themselves with a
// client-generated device id (e.g. a UUID the app creates once and persists
// locally). Swap for a real user id once auth exists. Returns null (and
// writes the 400 response itself) when the header is missing, so route
// handlers can just early-return.
function requireOwnerId(req: import("express").Request, res: import("express").Response): string | null {
  const id = req.header("x-device-id");
  if (!id) {
    res.status(400).json({ error: "Missing X-Device-Id header" });
    return null;
  }
  return id;
}

const createSchema = z.object({
  name: z.string().optional(),
  originStation: z.string().min(1),
  destinationStation: z.string().min(1),
});

savedRoutesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    res.json(savedRouteRepository.listForOwner(ownerId));
  })
);

savedRoutesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    const input = createSchema.parse(req.body);
    const route = savedRouteRepository.add({ ownerId, ...input });
    res.status(201).json(route);
  })
);

savedRoutesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    const removed = savedRouteRepository.remove(ownerId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Saved route not found" });
      return;
    }
    res.status(204).send();
  })
);
