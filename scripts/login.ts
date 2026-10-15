// Two-step login, so it works without an interactive terminal:
//   npm run login                      -> prints the Bosch login URL
//   npm run login -- '<callback URL>'  -> exchanges the code, writes .tokens.json
import { readFile, rm, writeFile } from 'node:fs/promises';

import { exchangeCode, extractCode, startLogin, type PendingLogin } from '../src/api/oauth.js';
import { TokenStore } from '../src/api/tokenStore.js';

const PENDING = '.login-pending.json';
const TOKENS = process.env.HOMECOM_TOKENS ?? '.tokens.json';

const arg = process.argv[2];
if (!arg) {
  const login = startLogin();
  await writeFile(PENDING, JSON.stringify(login), { mode: 0o600 });
  console.log('1. Open this URL in a desktop browser and sign in with your Bosch SingleKey ID:\n');
  console.log(login.url);
  console.log('\n2. The browser will fail to open a "com.bosch.tt.dashtt.pointt://app/login?code=..." link.');
  console.log('   Copy that URL (DevTools > Network, or the browser\'s "failed to launch" message) and run:');
  console.log("   npm run login -- '<that URL>'");
} else {
  const code = extractCode(arg);
  if (!code) {
    throw new Error('Could not find an authorization code in that input');
  }
  const pending = JSON.parse(await readFile(PENDING, 'utf8')) as PendingLogin;
  const tokens = await exchangeCode(code, pending.verifier);
  await new TokenStore(TOKENS).save(tokens);
  await rm(PENDING);
  console.log(`Logged in. Tokens saved to ${TOKENS} (access token valid until ${new Date(tokens.expiresAt).toISOString()}).`);
}
