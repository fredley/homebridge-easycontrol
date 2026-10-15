import type { PointtClient, Resource } from './api/client.js';
import { decodeName, zoneIds, zonePaths } from './model.js';
import {
  changedDays, type Day, DAYS, normaliseDay, programPath, type SwitchPoint, type WeekProgram,
} from './schedule.js';

export interface ZoneInfo {
  id: string;
  name: string;
  program: number; // 0 = no schedule
}

export interface ProgramInfo {
  id: number;
  name: string;
  days: WeekProgram;
}

export interface GatewaySchedules {
  gatewayId: string;
  zones: ZoneInfo[];
  programs: ProgramInfo[];
}

const clockProgramPath = (zone: string) => `/zones/${zone}/clockProgram`;

const points = (r: Resource | undefined): SwitchPoint[] =>
  Array.isArray(r?.value) ? (r.value as SwitchPoint[]).map(({ t, Th, name }) => ({ t, Th, name })) : [];

export async function loadSchedules(client: PointtClient): Promise<GatewaySchedules[]> {
  const gateways = (await client.getGateways()).filter((g) => g.deviceType === 'rrc2');
  return Promise.all(gateways.map(async ({ deviceId }) => {
    const [zonesRes, listRes] = await Promise.all([client.get(deviceId, '/zones'), client.get(deviceId, '/programs/list')]);
    const zones = zoneIds(zonesRes);
    const list = (Array.isArray(listRes?.value) ? listRes.value : []) as { id: number; name: string }[];

    const data = await client.bulkGet(deviceId, [
      ...zones.flatMap((z) => [zonePaths(z).name, clockProgramPath(z)]),
      ...list.flatMap((p) => DAYS.map((d) => programPath(p.id, d))),
    ]);

    return {
      gatewayId: deviceId,
      zones: zones.map((z) => ({
        id: z,
        name: decodeName(data.get(zonePaths(z).name)?.value, z),
        program: Number(data.get(clockProgramPath(z))?.value ?? 0),
      })),
      programs: list.map((p) => ({
        id: p.id,
        name: decodeName(p.name, `Schedule ${p.id}`),
        days: Object.fromEntries(DAYS.map((d) => [d, points(data.get(programPath(p.id, d)))])) as WeekProgram,
      })),
    };
  }));
}

/**
 * Writes only the days that changed, after validating all of them, and returns
 * what the device reports back afterwards.
 */
export async function saveProgram(
  client: PointtClient, gatewayId: string, program: number, edited: Partial<WeekProgram>,
): Promise<{ saved: Day[]; days: WeekProgram }> {
  const normalised = Object.fromEntries(
    Object.entries(edited).filter(([d]) => (DAYS as readonly string[]).includes(d))
      .map(([d, pts]) => [d, normaliseDay(d, pts ?? [])]),
  ) as Partial<WeekProgram>;

  const before = await readProgram(client, gatewayId, program);
  const saved = changedDays(before, normalised);
  for (const day of saved) {
    await client.put(gatewayId, programPath(program, day), normalised[day]);
  }
  return { saved, days: saved.length ? await readProgram(client, gatewayId, program) : before };
}

export async function assignProgram(client: PointtClient, gatewayId: string, zone: string, program: number): Promise<void> {
  if (!Number.isInteger(program) || program < 0) {
    throw new Error('Invalid schedule number');
  }
  await client.put(gatewayId, clockProgramPath(zone), program);
}

async function readProgram(client: PointtClient, gatewayId: string, program: number): Promise<WeekProgram> {
  const data = await client.bulkGet(gatewayId, DAYS.map((d) => programPath(program, d)));
  return Object.fromEntries(DAYS.map((d) => [d, points(data.get(programPath(program, d)))])) as WeekProgram;
}
