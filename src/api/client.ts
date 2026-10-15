import { AuthError } from './oauth.js';
import type { TokenStore } from './tokenStore.js';

export const API_ROOT = 'https://pointt-api.bosch-thermotechnology.com/pointt-api/api/v1/';
const BULK_MAX_PATHS = 30;
const RETRIES = 3;

/** A POINTT resource payload, e.g. `{ id, type: "floatValue", value: 22.7, minValue, ... }`. */
export interface Resource {
  id: string;
  type: string;
  value?: unknown;
  writeable?: 0 | 1;
  available?: string;
  used?: string;
  minValue?: number;
  maxValue?: number;
  stepSize?: number;
  references?: { id: string }[];
}

export interface Gateway {
  deviceId: string;
  deviceType: string;
}

interface BulkResponse {
  gatewayId: string;
  resourcePaths: {
    resourcePath: string;
    serverStatus: number;
    gatewayResponse?: { status: number; payload?: Resource } | null;
  }[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PointtClient {
  constructor(
    private readonly tokens: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryDelayMs = 1000,
  ) {}

  getGateways(): Promise<Gateway[]> {
    return this.request('GET', 'gateways/') as Promise<Gateway[]>;
  }

  /** Returns undefined when the gateway doesn't have the resource (403/404). */
  async get(gatewayId: string, path: string): Promise<Resource | undefined> {
    try {
      return (await this.request('GET', `gateways/${gatewayId}/resource${path}`)) as Resource;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        return undefined;
      }
      throw err;
    }
  }

  async put(gatewayId: string, path: string, value: unknown): Promise<void> {
    await this.request('PUT', `gateways/${gatewayId}/resource${path}`, { value });
  }

  /**
   * Batch read. Results are keyed by path; paths the gateway refused or doesn't
   * have are simply absent. The bulk API doesn't preserve request order.
   */
  async bulkGet(gatewayId: string, paths: string[]): Promise<Map<string, Resource>> {
    const out = new Map<string, Resource>();
    for (let i = 0; i < paths.length; i += BULK_MAX_PATHS) {
      const chunk = paths.slice(i, i + BULK_MAX_PATHS);
      const res = (await this.request('POST', 'bulk', [{ gatewayId, resourcePaths: chunk }])) as BulkResponse[];
      for (const entry of res?.[0]?.resourcePaths ?? []) {
        const gw = entry.gatewayResponse;
        if (entry.serverStatus === 200 && gw?.status === 200 && gw.payload) {
          out.set(entry.resourcePath, gw.payload);
        }
      }
    }
    return out;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let forcedRefresh = false;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(API_ROOT + path, {
          method,
          headers: {
            Authorization: `Bearer ${await this.tokens.accessToken(forcedRefresh)}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        if (err instanceof AuthError || attempt >= RETRIES) {
          throw err;
        }
        await sleep(this.retryDelayMs * attempt);
        continue;
      }

      if (res.status === 401 && !forcedRefresh) {
        forcedRefresh = true;
        continue;
      }
      if (res.status >= 500 && attempt < RETRIES) {
        await sleep(this.retryDelayMs * attempt);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401) {
          throw new AuthError(`Bosch API rejected the login (401) for ${method} ${path}`);
        }
        throw new ApiError(`${method} ${path} failed with ${res.status}: ${text.slice(0, 200)}`, res.status);
      }
      return text ? JSON.parse(text) : undefined;
    }
  }
}
