import type { Logging } from 'homebridge';

import type { PointtClient, Resource } from './api/client.js';
import { AuthError } from './api/oauth.js';
import { applyWrites, pollPaths, type Write } from './model.js';
import { REFRESH_AFTER_WRITE_MS } from './settings.js';

/** Owns the polled state for one gateway and serialises writes to it. */
export class GatewayController {
  readonly state = new Map<string, Resource>();
  private readonly listeners = new Set<() => void>();
  private timer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private writeChain: Promise<unknown> = Promise.resolve();
  private failing = false;

  constructor(
    readonly id: string,
    readonly zones: string[],
    private readonly client: PointtClient,
    private readonly log: Logging,
    private readonly pollMs: number,
  ) {}

  onUpdate(fn: () => void): void {
    this.listeners.add(fn);
  }

  start(): void {
    void this.poll();
  }

  stop(): void {
    clearTimeout(this.timer);
    clearTimeout(this.refreshTimer);
  }

  async poll(): Promise<void> {
    clearTimeout(this.timer);
    try {
      const fresh = await this.client.bulkGet(this.id, pollPaths(this.zones));
      this.log.debug(`Polled ${fresh.size} resources: ${[...fresh].map(([p, r]) => `${p}=${JSON.stringify(r.value)}`).join(' ')}`);
      for (const [path, resource] of fresh) {
        this.state.set(path, resource);
      }
      if (this.failing) {
        this.log.info(`Connection to gateway ${this.id} restored`);
        this.failing = false;
      }
      this.listeners.forEach((fn) => fn());
    } catch (err) {
      if (err instanceof AuthError) {
        this.log.error(`${err.message}. Log in again from the plugin settings in the Homebridge UI.`);
      } else if (!this.failing) {
        this.log.warn(`Polling gateway ${this.id} failed: ${(err as Error).message}`);
      } else {
        this.log.debug(`Polling gateway ${this.id} still failing: ${(err as Error).message}`);
      }
      this.failing = true;
    } finally {
      this.timer = setTimeout(() => void this.poll(), this.pollMs);
    }
  }

  /** PUT each write in order, update the cache optimistically, and re-read shortly after. */
  write(writes: Write[], optimistic: Write[] = []): Promise<void> {
    const run = this.writeChain.then(async () => {
      for (const w of writes) {
        this.log.debug(`PUT ${w.path} = ${JSON.stringify(w.value)}`);
        await this.client.put(this.id, w.path, w.value);
      }
      applyWrites(this.state, [...writes, ...optimistic]);
      this.listeners.forEach((fn) => fn());
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.poll(), REFRESH_AFTER_WRITE_MS);
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}
