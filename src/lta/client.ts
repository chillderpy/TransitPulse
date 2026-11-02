import NodeCache from "node-cache";
import { env, isLtaConfigured } from "../config/env";

export class LtaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = "LtaApiError";
  }
}

export class LtaNotConfiguredError extends Error {
  constructor() {
    super(
      "LTA_ACCOUNT_KEY is not set. Register for a key at " +
        "https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html " +
        "and set it in your .env file."
    );
    this.name = "LtaNotConfiguredError";
  }
}

// TTLs are chosen per dataset's own refresh cadence rather than one global
// value: bus arrivals change second to second, while crowd density and
// alerts are documented as refreshing roughly every ~30 min / few minutes.
const cache = new NodeCache({ checkperiod: 60 });

export type CacheTtlSeconds = number;

interface FetchOptions {
  params?: Record<string, string | number | undefined>;
  cacheTtlSeconds?: CacheTtlSeconds;
  cacheKeyExtra?: string;
}

function buildQuery(params?: FetchOptions["params"]): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== ""
  ) as [string, string | number][];
  if (entries.length === 0) return "";
  const search = new URLSearchParams();
  for (const [k, v] of entries) search.set(k, String(v));
  return `?${search.toString()}`;
}

/**
 * Calls an LTA DataMall OData endpoint, with response caching so we don't
 * hammer LTA's servers (and don't burn through the shared account key's
 * rate limit) on every app poll.
 */
export async function fetchLta<T>(
  endpointPath: string,
  options: FetchOptions = {}
): Promise<T> {
  if (!isLtaConfigured()) {
    throw new LtaNotConfiguredError();
  }

  const query = buildQuery(options.params);
  const cacheKey = `${endpointPath}${query}${options.cacheKeyExtra ?? ""}`;

  if (options.cacheTtlSeconds) {
    const cached = cache.get<T>(cacheKey);
    if (cached !== undefined) return cached;
  }

  const url = `${env.ltaBaseUrl}/${endpointPath}${query}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        AccountKey: env.ltaAccountKey,
        accept: "application/json",
      },
    });
  } catch (err) {
    throw new LtaApiError(
      `Network error calling LTA DataMall: ${(err as Error).message}`,
      undefined,
      endpointPath
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LtaApiError(
      `LTA DataMall returned ${response.status} for ${endpointPath}: ${body.slice(0, 300)}`,
      response.status,
      endpointPath
    );
  }

  const data = (await response.json()) as T;

  if (options.cacheTtlSeconds) {
    cache.set(cacheKey, data, options.cacheTtlSeconds);
  }

  return data;
}

export function clearLtaCache(): void {
  cache.flushAll();
}
