import type { Resource } from '../src/api/client.js';

// Shapes captured from a live CT200 (firmware 05.04.00), personal data removed.
export const zonesRefEnum: Resource = {
  id: '/zones',
  type: 'refEnum',
  references: [
    { id: '/zones/deviceTypeAllowed' },
    { id: '/zones/list' },
    { id: '/zones/zn1' },
  ],
};

const float = (id: string, value: number, extra: Partial<Resource> = {}): Resource =>
  ({ id, type: 'floatValue', writeable: 0, value, ...extra });
const string = (id: string, value: string, extra: Partial<Resource> = {}): Resource =>
  ({ id, type: 'stringValue', writeable: 0, value, ...extra });

export const ct200: Resource[] = [
  float('/zones/zn1/temperatureActual', 22.7),
  float('/zones/zn1/temperatureHeatingSetpoint', 10, { minValue: 5, maxValue: 30, stepSize: 0.5, used: 'true' }),
  float('/zones/zn1/manualTemperatureHeating', 15, { writeable: 1, minValue: 5, maxValue: 30, stepSize: 0.5 }),
  float('/zones/zn1/clockOverride/temperatureHeating', 10, { writeable: 1, minValue: 0, maxValue: 30, stepSize: 0.5 }),
  string('/zones/zn1/userMode', 'clock', { writeable: 1, used: 'true' }),
  string('/zones/zn1/status', 'idle'),
  string('/heatSources/flameIndication', 'off'),
  float('/system/sensors/humidity/indoor_h1', 68.8),
  float('/system/sensors/temperatures/outdoor_t1', 16, { minValue: -25, maxValue: 50, stepSize: 1 }),
  string('/system/awayMode/enabled', 'false', { writeable: 1, used: 'true' }),
  string('/heatingCircuits/hc1/boostMode', 'off', { writeable: 1, used: 'true', available: 'true' }),
];

export const stateOf = (resources: Resource[] = ct200) => new Map(resources.map((r) => [r.id, r]));
