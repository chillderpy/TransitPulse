import { randomUUID } from "crypto";
import { SavedRouteDto, SavedRouteInput } from "../types/api";
import { loadJsonFile, saveJsonFile } from "./fileStore";

const FILE_NAME = "saved-routes.json";

/**
 * File-backed saved-routes store (see fileStore.ts) - the write-up's
 * planned "persistent storage" for the piece the mock frontend claims but
 * doesn't actually have (the save form and the saved list aren't wired
 * together in the current Flutter code). Good enough that a route survives
 * a server restart without a real database; swap for one once routes need
 * to be shared across devices for the same account or scale past one
 * process's disk.
 */
class SavedRouteRepository {
  private routes = new Map<string, SavedRouteDto>(
    loadJsonFile<SavedRouteDto[]>(FILE_NAME, []).map((r) => [r.id, r])
  );

  private persist(): void {
    saveJsonFile(FILE_NAME, [...this.routes.values()]);
  }

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
    this.persist();
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
    const removed = this.routes.delete(id);
    if (removed) this.persist();
    return removed;
  }
}

export const savedRouteRepository = new SavedRouteRepository();
