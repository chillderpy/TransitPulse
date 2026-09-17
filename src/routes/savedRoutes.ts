import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { savedRouteRepository } from "../repositories/savedRouteRepository";

export const savedRoutesRouter = Router();

// No account system yet, so callers identify themselves with a
// client-generated device id (a UUID the app creates once and persists
// locally, via crypto.randomUUID() in public/app.js). Swap for a real user
// id once auth exists. Requiring the UUID shape (rather than any non-empty
// string) matters here specifically because this id is the *only* access
// control on saved routes: a short, guessable value like "device1" would
// let one client stumble into another's routes, where a random UUID's
// keyspace makes that practically impossible. Returns null (and writes the
// error response itself) when the header is missing/malformed, so route
// handlers can just early-return.
const deviceIdSchema = z.string().uuid();

function requireOwnerId(req: import("express").Request, res: import("express").Response): string | null {
  const id = req.header("x-device-id");
  if (!id) {
    res.status(400).json({ error: "Missing X-Device-Id header" });
    return null;
  }
  if (!deviceIdSchema.safeParse(id).success) {
    res.status(400).json({ error: "X-Device-Id must be a UUID" });
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
