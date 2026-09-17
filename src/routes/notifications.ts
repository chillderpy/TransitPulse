import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { notificationSubscriptionRepository } from "../repositories/notificationSubscriptionRepository";

export const notificationsRouter = Router();

const subscribeSchema = z.object({
  webhookUrl: z.string().url(),
  lines: z.array(z.string()).optional(),
  stations: z.array(z.string()).optional(),
});

// Registers a webhook to be POSTed to when a new disruption or lift outage
// appears on a watched line/station (or on anything, if both are omitted).
// See src/services/notificationService.ts for why this is a webhook and
// not an actual phone push.
notificationsRouter.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const input = subscribeSchema.parse(req.body);
    const subscription = notificationSubscriptionRepository.add(input);
    res.status(201).json(subscription);
  })
);

notificationsRouter.delete(
  "/subscribe/:id",
  asyncHandler(async (req, res) => {
    const removed = notificationSubscriptionRepository.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    res.status(204).send();
  })
);
