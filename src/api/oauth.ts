import { createHash, randomBytes } from 'node:crypto';

// SingleKey ID OAuth2 + PKCE, using the HomeCom Easy app's public client.
// The redirect URI is an app scheme a browser can't follow, so the user pastes
// the URL (or just the code) they land on.
export const OAUTH_BASE = 'https://singlekey-id.com';
export const CLIENT_ID = '762162C0-FA2D-4540-AE66-6489F189FADC';
export const REDIRECT_URI = 'com.bosch.tt.dashtt.pointt://app/login';
const SCOPES = [
  'openid', 'email', 'profile', 'offline_access',
  'pointt.gateway.list', 'pointt.gateway.users', 'pointt.gateway.resource.dashapp',
];

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface PendingLogin {
  url: string;
  verifier: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function startLogin(): PendingLogin {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    prompt: 'login',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    style_id: 'tt_bsch',
    state: b64url(randomBytes(16)),
    nonce: b64url(randomBytes(16)),
  });
  return { url: `${OAUTH_BASE}/auth/connect/authorize?${params}`, verifier };
}

/** Accepts the full callback URL, a URL fragment containing code=, or a bare code. */
export function extractCode(input: string): string | undefined {
  const s = input.trim();
  const m = s.match(/[?&#]code=([^&\s#]+)/);
  if (m) {
    return decodeURIComponent(m[1]);
  }
  return /^[A-Za-z0-9._~-]{16,}$/.test(s) ? s : undefined;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${OAUTH_BASE}/auth/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AuthError(`Token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

export function exchangeCode(code: string, verifier: string): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export class AuthError extends Error {}
