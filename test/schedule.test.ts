import { describe, expect, it } from 'vitest';

import { decodeName } from '../src/model.js';
import { changedDays, encodeName, normaliseDay, ScheduleError } from '../src/schedule.js';

// Monday from a live CT200 program.
const weekday = [
  { t: 420, Th: 19, name: 1 }, { t: 540, Th: 17, name: 2 }, { t: 1020, Th: 20, name: 3 }, { t: 1380, Th: 15, name: 0 },
];

describe('normaliseDay', () => {
  it('reproduces the device labelling: 1, 2, 3... with the last point 0', () => {
    const shuffled = [weekday[2], weekday[0], weekday[3], weekday[1]].map(({ t, Th }) => ({ t, Th }));
    expect(normaliseDay('monday', shuffled)).toEqual(weekday);
  });

  it('labels a single point 0', () => {
    expect(normaliseDay('sunday', [{ t: 480, Th: 20 }])).toEqual([{ t: 480, Th: 20, name: 0 }]);
  });

  it.each([
    [[], /at least one/],
    [Array.from({ length: 7 }, (_, i) => ({ t: i * 60, Th: 20 })), /at most 6/],
    [[{ t: 425, Th: 20 }], /15-minute/],
    [[{ t: 1440, Th: 20 }], /15-minute/],
    [[{ t: 420, Th: 20 }, { t: 420, Th: 18 }], /two switch points at 07:00/],
    [[{ t: 420, Th: 4.5 }], /5–30/],
    [[{ t: 420, Th: 20.2 }], /0.5 steps/],
  ])('rejects invalid input %#', (points, message) => {
    expect(() => normaliseDay('monday', points)).toThrow(ScheduleError);
    expect(() => normaliseDay('monday', points)).toThrow(message);
  });
});

describe('changedDays', () => {
  it('ignores label differences and days not being saved', () => {
    const relabelled = weekday.map(({ t, Th }) => ({ t, Th, name: 9 }));
    expect(changedDays({ monday: weekday, tuesday: weekday }, { monday: relabelled })).toEqual([]);
  });
  it('detects changed temperatures and times', () => {
    const warmer = weekday.map((p, i) => (i === 0 ? { ...p, Th: 21 } : p));
    expect(changedDays({ monday: weekday, tuesday: weekday }, { monday: weekday, tuesday: warmer })).toEqual(['tuesday']);
  });
});

describe('program names', () => {
  it('round-trips through base64', () => {
    expect(decodeName('TmV3IGNsb2NrIHByb2dyYW0gMQ==', 'pg1')).toBe('New clock program 1');
    expect(decodeName(encodeName('Winter'), 'pg1')).toBe('Winter');
  });
});
