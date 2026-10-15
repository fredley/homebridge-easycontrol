import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { PointtClient } from '../dist/api/client.js';
import { exchangeCode, extractCode, startLogin } from '../dist/api/oauth.js';
import { TokenStore } from '../dist/api/tokenStore.js';
import { ScheduleError } from '../dist/schedule.js';
import { assignProgram, loadSchedules, saveProgram } from '../dist/scheduleService.js';
import { tokenPath } from '../dist/settings.js';

// Surface API and validation errors to the page as toasts.
const handled = (fn) => async (payload) => {
  try {
    return await fn(payload ?? {});
  } catch (err) {
    if (err instanceof RequestError) {
      throw err;
    }
    throw new RequestError(err.message, { status: err instanceof ScheduleError ? 400 : 502 });
  }
};

class EasyControlUiServer extends HomebridgePluginUiServer {
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

    // A fresh TokenStore per request picks up refreshes made by the running plugin.
    const client = () => new PointtClient(this.store());

    this.onRequest('/schedules', handled(() => loadSchedules(client())));

    this.onRequest('/schedules/save', handled(({ gatewayId, program, days }) =>
      saveProgram(client(), gatewayId, Number(program), days)));

    this.onRequest('/schedules/assign', handled(async ({ gatewayId, zone, program }) => {
      await assignProgram(client(), gatewayId, zone, Number(program));
      return { ok: true };
    }));

    this.ready();
  }
}

(() => new EasyControlUiServer())();
