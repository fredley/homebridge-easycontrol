import type { Resource } from './api/client.js';

export type State = ReadonlyMap<string, Resource>;
export type Write = { path: string; value: unknown };
export type SetpointBehaviour = 'override' | 'manual';

export const SYSTEM_PATHS = {
  flame: '/heatSources/flameIndication',
  humidity: '/system/sensors/humidity/indoor_h1',
  outdoorTemp: '/system/sensors/temperatures/outdoor_t1',
  away: '/system/awayMode/enabled',
  boost: '/heatingCircuits/hc1/boostMode',
  boostTemperature: '/heatingCircuits/hc1/boostTemperature',
  boostDuration: '/heatingCircuits/hc1/boostDuration',
} as const;

export function zonePaths(zone: string) {
  const base = `/zones/${zone}`;
  return {
    name: `${base}/name`,
    temperature: `${base}/temperatureActual`,
    setpoint: `${base}/temperatureHeatingSetpoint`,
    manualSetpoint: `${base}/manualTemperatureHeating`,
    overrideSetpoint: `${base}/clockOverride/temperatureHeating`,
    userMode: `${base}/userMode`,
    status: `${base}/status`,
  };
}

/** All resources polled each cycle for the given zones. */
export function pollPaths(zones: string[]): string[] {
  const zoneOnly = zones.flatMap((z) => {
    const { name: _name, ...rest } = zonePaths(z);
    return Object.values(rest);
  });
  return [...zoneOnly, ...Object.values(SYSTEM_PATHS)];
}

/** Zone ids (`zn1`, ...) from the `/zones` refEnum, ignoring `/zones/list` etc. */
export function zoneIds(zones: Resource | undefined): string[] {
  return (zones?.references ?? [])
    .map((r) => r.id.match(/^\/zones\/(zn\d+)$/)?.[1])
    .filter((z): z is string => !!z);
}

/** Bosch stores user-entered names base64-encoded. */
export function decodeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw) {
    return fallback;
  }
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  const looksBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length % 4 === 0;
  return looksBase64 && /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(decoded) ? decoded : raw;
}

export const num = (state: State, path: string): number | undefined => {
  const v = state.get(path)?.value;
  return typeof v === 'number' ? v : undefined;
};

export const str = (state: State, path: string): string | undefined => {
  const v = state.get(path)?.value;
  return typeof v === 'string' ? v : undefined;
};

/** Present in the poll and not flagged unavailable by the gateway. */
export const isAvailable = (state: State, path: string): boolean => {
  const r = state.get(path);
  return !!r && r.available !== 'false';
};

export function isHeating(state: State, zone: string): boolean {
  return str(state, SYSTEM_PATHS.flame) === 'on' || str(state, zonePaths(zone).status) === 'heating';
}

/**
 * Writes needed to change a zone's target temperature from HomeKit.
 * In schedule (`clock`) mode the default is the CT200's own temporary override,
 * which lasts until the next schedule switch point, the same as turning the dial.
 */
export function setpointWrites(state: State, zone: string, temp: number, behaviour: SetpointBehaviour): Write[] {
  const p = zonePaths(zone);
  if (str(state, p.userMode) !== 'clock') {
    return [{ path: p.manualSetpoint, value: temp }];
  }
  if (behaviour === 'override') {
    return [{ path: p.overrideSetpoint, value: temp }];
  }
  return [
    { path: p.userMode, value: 'manual' },
    { path: p.manualSetpoint, value: temp },
  ];
}

/** Apply writes to the cached state, so HomeKit reflects them before the next poll confirms. */
export function applyWrites(state: Map<string, Resource>, writes: Write[]): void {
  for (const w of writes) {
    const r = state.get(w.path);
    if (r) {
      state.set(w.path, { ...r, value: w.value });
    }
  }
}
