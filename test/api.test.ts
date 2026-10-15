import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PointtClient } from '../src/api/client.js';
import { AuthError, extractCode } from '../src/api/oauth.js';
import { TokenStore } from '../src/api/tokenStore.js';
import { ct200 } from './fixtures.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function storeWith(expiresInMs: number) {
  const path = join(await mkdtemp(join(tmpdir(), 'homecom-')), 'tokens.json');
  await writeFile(path, JSON.stringify({ accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + expiresInMs }));
  return { path, store: new TokenStore(path) };
}

describe('extractCode', () => {
  it('pulls the code out of the app callback URL', () => {
    expect(extractCode('com.bosch.tt.dashtt.pointt://app/login?code=ABC123DEF456GHI789-1&state=x&iss=y'))
      .toBe('ABC123DEF456GHI789-1');
  });
  it('does not mistake code_challenge for a code', () => {
    expect(extractCode('https://singlekey-id.com/auth/connect/authorize/callback?client_id=x&code_challenge=abc')).toBeUndefined();
  });
  it('accepts a bare code', () => {
    expect(extractCode('  BD9D87A3D16758B0D8468C80-1 ')).toBe('BD9D87A3D16758B0D8468C80-1');
  });
});

describe('TokenStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a still-valid access token without refreshing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { store } = await storeWith(60 * 60_000);
    expect(await store.accessToken()).toBe('old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once for concurrent callers and persists the rotated refresh token', async () => {
    const fetchMock = vi.fn(async () => json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const { path, store } = await storeWith(60_000); // inside the 5-minute margin
    const results = await Promise.all([store.accessToken(), store.accessToken(), store.accessToken()]);
    expect(results).toEqual(['new', 'new', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain('refresh_token=r1');
    expect(JSON.parse(await readFile(path, 'utf8')).refreshToken).toBe('r2');
  });

  it('throws AuthError when there are no tokens', async () => {
    const store = new TokenStore(join(tmpdir(), 'does-not-exist', 'tokens.json'));
    await expect(store.accessToken()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('PointtClient', () => {
  let tokens: TokenStore;
  beforeEach(async () => {
    tokens = (await storeWith(60 * 60_000)).store;
  });

  it('bulkGet keys results by path and drops per-path failures', async () => {
    const fetchMock = vi.fn(async () => json([{
      gatewayId: 'gw',
      resourcePaths: [
        { resourcePath: '/zones/zn1/humidity', serverStatus: 403, gatewayResponse: null },
        { resourcePath: ct200[0].id, serverStatus: 200, gatewayResponse: { status: 200, payload: ct200[0] } },
        { resourcePath: '/x', serverStatus: 200, gatewayResponse: { status: 404 } },
      ],
    }]));
    const client = new PointtClient(tokens, fetchMock as typeof fetch, 0);
    const out = await client.bulkGet('gw', [ct200[0].id, '/zones/zn1/humidity', '/x']);
    expect([...out.keys()]).toEqual([ct200[0].id]);
    expect(out.get(ct200[0].id)?.value).toBe(22.7);
  });

  it('bulkGet splits requests into chunks of 30 paths', async () => {
    const fetchMock = vi.fn(async () => json([{ gatewayId: 'gw', resourcePaths: [] }]));
    const client = new PointtClient(tokens, fetchMock as typeof fetch, 0);
    await client.bulkGet('gw', Array.from({ length: 31 }, (_, i) => `/p${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('put sends {value} and accepts 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new PointtClient(tokens, fetchMock as typeof fetch, 0);
    await client.put('gw', '/zones/zn1/userMode', 'manual');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/gateways\/gw\/resource\/zones\/zn1\/userMode$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ value: 'manual' });
  });

  it('get returns undefined for resources the gateway forbids', async () => {
    const fetchMock = vi.fn(async () => json({ code: 403 }, 403));
    const client = new PointtClient(tokens, fetchMock as typeof fetch, 0);
    expect(await client.get('gw', '/heatSources/hybrid')).toBeUndefined();
  });

  it('retries once with a forced refresh on 401', async () => {
    const spy = vi.spyOn(tokens, 'accessToken');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(json([]));
    spy.mockResolvedValue('t');
    const client = new PointtClient(tokens, fetchMock as typeof fetch, 0);
    await client.getGateways();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });

  it('retries 5xx then gives up with ApiError', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    const client = new PointtClient(tokens, fetchMock as typeof fetch, 0);
    await expect(client.getGateways()).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
