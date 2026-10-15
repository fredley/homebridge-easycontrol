import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AuthError, refreshTokens, type TokenSet } from './oauth.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Persists the rotating token set. SingleKey refresh tokens are single-use, so
 * every refresh is serialised and written to disk before it's used.
 */
export class TokenStore {
  private tokens?: TokenSet;
  private inflight?: Promise<TokenSet>;

  constructor(private readonly path: string) {}

  async load(): Promise<TokenSet | undefined> {
    try {
      this.tokens = JSON.parse(await readFile(this.path, 'utf8')) as TokenSet;
    } catch {
      this.tokens = undefined;
    }
    return this.tokens;
  }

  async save(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  /** Returns a valid access token, refreshing if it's near expiry or `force` is set. */
  async accessToken(force = false): Promise<string> {
    if (!this.tokens) {
      await this.load();
    }
    if (!this.tokens) {
      throw new AuthError('Not logged in to Bosch HomeCom');
    }
    if (!force && Date.now() < this.tokens.expiresAt - REFRESH_MARGIN_MS) {
      return this.tokens.accessToken;
    }
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return (await this.inflight).accessToken;
  }

  private async refresh(): Promise<TokenSet> {
    const used = this.tokens!.refreshToken;
    try {
      const next = await refreshTokens(used);
      await this.save(next);
      return next;
    } catch (err) {
      // The user may have logged in again from the UI, which writes a new file.
      const onDisk = await this.load();
      if (onDisk && onDisk.refreshToken !== used) {
        return Date.now() < onDisk.expiresAt - REFRESH_MARGIN_MS ? onDisk : this.refresh();
      }
      this.tokens = onDisk;
      throw err;
    }
  }
}
