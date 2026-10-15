// CT200 weekly schedules ("clock programs"): /programs/pgN/<day> holds a list of
// switch points, each { t: minutes after midnight, Th: °C, name: label index }.
// A zone follows the program whose number is in /zones/znX/clockProgram (0 = none).

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Day = typeof DAYS[number];

export interface SwitchPoint {
  t: number;
  Th: number;
  name?: number;
}
export type WeekProgram = Record<Day, SwitchPoint[]>;

// Limits from the resource metadata and the EasyControl app; maxPoints is the app's.
export const LIMITS = { maxPoints: 6, minTemp: 5, maxTemp: 30, tempStep: 0.5, timeStep: 15 } as const;

export class ScheduleError extends Error {}

export const programPath = (program: number, day: Day) => `/programs/pg${program}/${day}`;

/**
 * Validates and sorts one day's switch points. The device labels points
 * 1, 2, 3... in time order with the last one 0, so labels are reassigned here.
 */
export function normaliseDay(day: string, points: SwitchPoint[]): SwitchPoint[] {
  if (!points.length) {
    throw new ScheduleError(`${day}: needs at least one switch point`);
  }
  if (points.length > LIMITS.maxPoints) {
    throw new ScheduleError(`${day}: at most ${LIMITS.maxPoints} switch points`);
  }
  const sorted = [...points].sort((a, b) => a.t - b.t);
  sorted.forEach((p, i) => {
    if (!Number.isInteger(p.t) || p.t < 0 || p.t >= 24 * 60 || p.t % LIMITS.timeStep !== 0) {
      throw new ScheduleError(`${day}: times must be on a ${LIMITS.timeStep}-minute boundary`);
    }
    if (i > 0 && sorted[i - 1].t === p.t) {
      throw new ScheduleError(`${day}: two switch points at ${formatTime(p.t)}`);
    }
    if (typeof p.Th !== 'number' || p.Th < LIMITS.minTemp || p.Th > LIMITS.maxTemp
      || Math.round(p.Th / LIMITS.tempStep) * LIMITS.tempStep !== p.Th) {
      throw new ScheduleError(`${day}: temperatures must be ${LIMITS.minTemp}–${LIMITS.maxTemp} °C in ${LIMITS.tempStep} steps`);
    }
  });
  return sorted.map((p, i) => ({ t: p.t, Th: p.Th, name: i === sorted.length - 1 ? 0 : i + 1 }));
}

const sameDay = (a: SwitchPoint[] = [], b: SwitchPoint[] = []) =>
  a.length === b.length && a.every((p, i) => p.t === b[i].t && p.Th === b[i].Th);

/** Days whose switch points differ (labels are ignored). */
export function changedDays(before: Partial<WeekProgram>, after: Partial<WeekProgram>): Day[] {
  return DAYS.filter((d) => after[d] !== undefined && !sameDay(before[d], after[d]));
}

export const formatTime = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

export const encodeName = (name: string) => Buffer.from(name, 'utf8').toString('base64');
