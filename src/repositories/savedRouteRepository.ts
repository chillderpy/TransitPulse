import { randomUUID } from "crypto";
import { SavedRouteDto, SavedRouteInput } from "../types/api";

/**
 * In-memory saved-routes store. This is the piece the write-up's mock
 * frontend claims but doesn't actually have (the save form and the saved
 * list aren't wired together in the current Flutter code) - this repository
 * is what real add/list/remove state looks like, ready for the app to call
 * over HTTP instead of holding a hardcoded list. Swap for a real database
 * once routes need to survive a server restart or be shared across devices
 * for the same account.
 */
class SavedRouteRepository {
  private routes = new Map<string, SavedRouteDto>();

  add(input: SavedRouteInput): SavedRouteDto {
    const id = randomUUID();
    const route: SavedRouteDto = {
      id,
      ownerId: input.ownerId,
      name: input.name?.trim() || `${input.originStation} to ${input.destinationStation}`,
      originStation: input.originStation,
      destinationStation: input.destinationStation,
      createdAt: new Date().toISOString(),
    };
    this.routes.set(id, route);
    return route;
  }

  listForOwner(ownerId: string): SavedRouteDto[] {
    return [...this.routes.values()]
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  remove(ownerId: string, id: string): boolean {
    const route = this.routes.get(id);
    if (!route || route.ownerId !== ownerId) return false;
    return this.routes.delete(id);
  }
}

export const savedRouteRepository = new SavedRouteRepository();
