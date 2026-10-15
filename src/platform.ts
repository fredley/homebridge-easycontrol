import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

import { SystemAccessory } from './accessories/system.js';
import { ZoneAccessory } from './accessories/zone.js';
import { PointtClient } from './api/client.js';
import { AuthError } from './api/oauth.js';
import { TokenStore } from './api/tokenStore.js';
import { GatewayController } from './gateway.js';
import { decodeName, str, zoneIds, zonePaths } from './model.js';
import {
  DEFAULT_POLL_SECONDS, type EasyControlConfig, MIN_POLL_SECONDS, PLATFORM_NAME, PLUGIN_NAME, tokenPath,
} from './settings.js';

const DISCOVERY_RETRY_MS = 60_000;

export class EasyControlPlatform implements DynamicPlatformPlugin {
  readonly config: EasyControlConfig;
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly gateways: GatewayController[] = [];

  constructor(
    readonly log: Logging,
    config: EasyControlConfig,
    readonly api: API,
  ) {
    this.config = config;
    api.on('didFinishLaunching', () => void this.discover());
    api.on('shutdown', () => this.gateways.forEach((g) => g.stop()));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  /** Turns write failures into a HomeKit "No Response" for the characteristic. */
  async guard(p: Promise<void>): Promise<void> {
    try {
      await p;
    } catch (err) {
      this.log.error(`Write failed: ${(err as Error).message}`);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async discover(): Promise<void> {
    const tokens = new TokenStore(tokenPath(this.api.user.storagePath()));
    if (!(await tokens.load())) {
      this.log.error('Not logged in to Bosch HomeCom. Open the plugin settings in the Homebridge UI and log in.');
      return;
    }
    const client = new PointtClient(tokens);
    try {
      await this.setup(client);
    } catch (err) {
      if (err instanceof AuthError) {
        this.log.error(`${err.message}. Log in again from the plugin settings in the Homebridge UI.`);
        return;
      }
      this.log.warn(`Discovery failed (${(err as Error).message}); retrying in ${DISCOVERY_RETRY_MS / 1000}s`);
      setTimeout(() => void this.discover(), DISCOVERY_RETRY_MS);
    }
  }

  private async setup(client: PointtClient): Promise<void> {
    const pollMs = Math.max(this.config.pollInterval ?? DEFAULT_POLL_SECONDS, MIN_POLL_SECONDS) * 1000;
    const gateways = (await client.getGateways()).filter((g) => g.deviceType === 'rrc2');
    if (!gateways.length) {
      this.log.warn('No EasyControl (rrc2) gateways found on this Bosch account');
    }
    const keep = new Set<string>();

    for (const gw of gateways) {
      const zones = zoneIds(await client.get(gw.deviceId, '/zones'));
      const info = await client.bulkGet(gw.deviceId, [
        '/gateway/versionFirmware', ...zones.map((z) => zonePaths(z).name),
      ]);
      const firmware = str(info, '/gateway/versionFirmware') ?? 'unknown';
      const controller = new GatewayController(gw.deviceId, zones, client, this.log, pollMs);
      this.log.info(`Gateway ${gw.deviceId} (firmware ${firmware}): zones ${zones.join(', ') || 'none'}`);

      // Seed state before wiring characteristics, so setpoint limits come from the device.
      await controller.poll();

      for (const zone of zones) {
        const name = decodeName(info.get(zonePaths(zone).name)?.value, zone);
        const acc = this.accessory(`${gw.deviceId}:${zone}`, name, gw.deviceId, firmware, keep);
        new ZoneAccessory(this, acc, controller, zone);
      }
      const sys = this.accessory(`${gw.deviceId}:system`, this.config.name ?? 'Bosch CT200', gw.deviceId, firmware, keep);
      new SystemAccessory(this, sys, controller);
      this.gateways.push(controller);
    }

    const stale = [...this.cached.values()].filter((a) => !keep.has(a.UUID));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private accessory(key: string, name: string, serial: string, firmware: string, keep: Set<string>): PlatformAccessory {
    const { Service, Characteristic } = this.api.hap;
    const uuid = this.api.hap.uuid.generate(key);
    keep.add(uuid);
    let acc = this.cached.get(uuid);
    if (!acc) {
      acc = new this.api.platformAccessory(name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
      this.log.info(`Added accessory ${name}`);
    }
    acc.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Bosch')
      .setCharacteristic(Characteristic.Model, 'EasyControl CT200')
      .setCharacteristic(Characteristic.SerialNumber, `${serial}${key.slice(serial.length)}`)
      .setCharacteristic(Characteristic.FirmwareRevision, firmware);
    return acc;
  }
}
