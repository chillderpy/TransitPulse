import { randomUUID } from "crypto";

export interface NotificationSubscription {
  id: string;
  webhookUrl: string;
  lines: string[]; // e.g. ["EWL"] - empty means "any line"
  stations: string[]; // e.g. ["Stevens"] - empty means "any station"
  createdAt: string;
}

export interface NotificationSubscriptionInput {
  webhookUrl: string;
  lines?: string[];
  stations?: string[];
}

/**
 * In-memory subscription store for the proactive-alert poller
 * (notificationService.ts). Deliberately not file-backed like saved
 * routes: a webhook subscription only matters while its owner's client is
 * actually running to receive it, so losing it on restart is fine (the
 * client just re-subscribes on next launch), unlike a saved route a user
 * expects to persist indefinitely.
 */
class NotificationSubscriptionRepository {
  private subscriptions = new Map<string, NotificationSubscription>();

  add(input: NotificationSubscriptionInput): NotificationSubscription {
    const subscription: NotificationSubscription = {
      id: randomUUID(),
      webhookUrl: input.webhookUrl,
      lines: input.lines ?? [],
      stations: input.stations ?? [],
      createdAt: new Date().toISOString(),
    };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  remove(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  list(): NotificationSubscription[] {
    return [...this.subscriptions.values()];
  }
}

export const notificationSubscriptionRepository = new NotificationSubscriptionRepository();
