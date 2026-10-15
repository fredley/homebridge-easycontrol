import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { GatewayController } from '../gateway.js';
import { num, str, SYSTEM_PATHS, type Write } from '../model.js';
import type { EasyControlPlatform } from '../platform.js';

/** Gateway-wide extras: outdoor temperature, away mode and boost. */
export class SystemAccessory {
  private outdoor?: Service;
  private away?: Service;
  private boost?: Service;

  constructor(
    private readonly platform: EasyControlPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly gateway: GatewayController,
  ) {
    const { Service, Characteristic } = platform.api.hap;
    const cfg = platform.config;

    this.outdoor = this.service(cfg.showOutdoorTemperature ?? true, Service.TemperatureSensor, 'Outdoor temperature', 'outdoor');
    this.outdoor?.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: -50, maxValue: 100 })
      .onGet(() => this.required(num(gateway.state, SYSTEM_PATHS.outdoorTemp)));

    this.away = this.service(cfg.showAway ?? true, Service.Switch, 'Away', 'away');
    this.away?.getCharacteristic(Characteristic.On)
      .onGet(() => this.required(str(gateway.state, SYSTEM_PATHS.away)) === 'true')
      .onSet((v) => this.set('Away', [{ path: SYSTEM_PATHS.away, value: v ? 'true' : 'false' }]));

    this.boost = this.service(cfg.showBoost ?? true, Service.Switch, 'Boost', 'boost');
    this.boost?.getCharacteristic(Characteristic.On)
      .onGet(() => this.required(str(gateway.state, SYSTEM_PATHS.boost)) === 'on')
      .onSet((v) => this.setBoost(v));

    gateway.onUpdate(() => this.push());
  }

  /** Adds (or restores) a named service, or removes it if disabled in config. */
  private service(enabled: boolean, type: typeof Service.Switch, name: string, subtype: string): Service | undefined {
    const { Characteristic } = this.platform.api.hap;
    const existing = this.accessory.getServiceById(type, subtype);
    if (!enabled) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return undefined;
    }
    const svc = existing ?? this.accessory.addService(type, name, subtype);
    svc.setCharacteristic(Characteristic.Name, name);
    if (!svc.testCharacteristic(Characteristic.ConfiguredName)) {
      svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
      svc.setCharacteristic(Characteristic.ConfiguredName, name);
    }
    return svc;
  }

  private required<T>(v: T | undefined): T {
    if (v === undefined) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return v;
  }

  private async set(label: string, writes: Write[]): Promise<void> {
    this.platform.log.info(`${label} -> ${JSON.stringify(writes.at(-1)?.value)}`);
    await this.platform.guard(this.gateway.write(writes));
  }

  private setBoost(on: CharacteristicValue): Promise<void> {
    const { boostTemperature, boostDuration } = this.platform.config;
    const writes: Write[] = [];
    if (on && boostTemperature !== undefined) {
      writes.push({ path: SYSTEM_PATHS.boostTemperature, value: boostTemperature });
    }
    if (on && boostDuration !== undefined) {
      writes.push({ path: SYSTEM_PATHS.boostDuration, value: boostDuration });
    }
    writes.push({ path: SYSTEM_PATHS.boost, value: on ? 'on' : 'off' });
    return this.set('Boost', writes);
  }

  private push(): void {
    const { Characteristic } = this.platform.api.hap;
    const s = this.gateway.state;
    const outdoor = num(s, SYSTEM_PATHS.outdoorTemp);
    if (outdoor !== undefined) {
      this.outdoor?.updateCharacteristic(Characteristic.CurrentTemperature, outdoor);
    }
    const away = str(s, SYSTEM_PATHS.away);
    if (away !== undefined) {
      this.away?.updateCharacteristic(Characteristic.On, away === 'true');
    }
    const boost = str(s, SYSTEM_PATHS.boost);
    if (boost !== undefined) {
      this.boost?.updateCharacteristic(Characteristic.On, boost === 'on');
    }
  }
}
