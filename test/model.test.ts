import { describe, expect, it } from 'vitest';

import { decodeName, isHeating, pollPaths, setpointWrites, zoneIds } from '../src/model.js';
import { stateOf, zonesRefEnum } from './fixtures.js';

describe('zoneIds', () => {
  it('keeps only znN references', () => {
    expect(zoneIds(zonesRefEnum)).toEqual(['zn1']);
    expect(zoneIds(undefined)).toEqual([]);
  });
});

describe('decodeName', () => {
  it('decodes base64 zone names', () => {
    expect(decodeName('S2l0Y2hlbg==', 'zn1')).toBe('Kitchen');
  });
  it('leaves plain names alone and falls back when empty', () => {
    expect(decodeName('Living room', 'zn1')).toBe('Living room');
    expect(decodeName('', 'zn1')).toBe('zn1');
    expect(decodeName(undefined, 'zn1')).toBe('zn1');
  });
});

describe('pollPaths', () => {
  it('covers zone and system resources but not the static name', () => {
    const paths = pollPaths(['zn1']);
    expect(paths).toContain('/zones/zn1/temperatureActual');
    expect(paths).toContain('/system/awayMode/enabled');
    expect(paths).not.toContain('/zones/zn1/name');
    expect(paths.length).toBeLessThanOrEqual(30);
  });
});

describe('isHeating', () => {
  it('is false when idle with the flame off', () => {
    expect(isHeating(stateOf(), 'zn1')).toBe(false);
  });
  it('is true when the flame is on', () => {
    const s = stateOf();
    s.set('/heatSources/flameIndication', { ...s.get('/heatSources/flameIndication')!, value: 'on' });
    expect(isHeating(s, 'zn1')).toBe(true);
  });
});

describe('setpointWrites', () => {
  it('uses the temporary clock override on schedule by default', () => {
    expect(setpointWrites(stateOf(), 'zn1', 21, 'override')).toEqual([
      { path: '/zones/zn1/clockOverride/temperatureHeating', value: 21 },
    ]);
  });
  it('switches to manual first when configured to', () => {
    expect(setpointWrites(stateOf(), 'zn1', 21, 'manual')).toEqual([
      { path: '/zones/zn1/userMode', value: 'manual' },
      { path: '/zones/zn1/manualTemperatureHeating', value: 21 },
    ]);
  });
  it('writes the manual setpoint when already manual', () => {
    const s = stateOf();
    s.set('/zones/zn1/userMode', { ...s.get('/zones/zn1/userMode')!, value: 'manual' });
    expect(setpointWrites(s, 'zn1', 19.5, 'override')).toEqual([
      { path: '/zones/zn1/manualTemperatureHeating', value: 19.5 },
    ]);
  });
});
