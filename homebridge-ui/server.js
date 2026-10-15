import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { exchangeCode, extractCode, startLogin } from '../dist/api/oauth.js';
import { TokenStore } from '../dist/api/tokenStore.js';
import { tokenPath } from '../dist/settings.js';

class HomeComUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.pending = undefined;
    this.store = () => new TokenStore(tokenPath(this.homebridgeStoragePath));

    this.onRequest('/status', async () => {
      const tokens = await this.store().load();
      return { loggedIn: !!tokens };
    });

    this.onRequest('/start', async () => {
      this.pending = startLogin();
      return { url: this.pending.url };
    });

    this.onRequest('/finish', async ({ callbackUrl }) => {
      if (!this.pending) {
        throw new RequestError('Start the login first', { status: 400 });
      }
      const code = extractCode(callbackUrl ?? '');
      if (!code) {
        throw new RequestError('No authorization code found in that URL', { status: 400 });
      }
      try {
        await this.store().save(await exchangeCode(code, this.pending.verifier));
      } catch (err) {
        throw new RequestError(`Bosch rejected the code: ${err.message}`, { status: 400 });
      }
      this.pending = undefined;
      return { loggedIn: true };
    });

    this.ready();
  }
}

(() => new HomeComUiServer())();
