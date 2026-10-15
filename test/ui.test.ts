// @vitest-environment node
import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../homebridge-ui/public/index.html', import.meta.url), 'utf8');

const weekday = [{ t: 420, Th: 19, name: 1 }, { t: 540, Th: 17, name: 2 }, { t: 1020, Th: 20, name: 3 }, { t: 1380, Th: 15, name: 0 }];
const weekend = [{ t: 480, Th: 20, name: 1 }, { t: 1380, Th: 15, name: 0 }];
const days = () => ({
  monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: weekend, sunday: weekend,
});
const gateways = () => [{
  gatewayId: 'gw',
  zones: [{ id: 'zn1', name: 'Kitchen', program: 0 }],
  programs: [{ id: 1, name: 'Normal', days: days() }],
}];

async function load() {
  const request = vi.fn(async (path: string, body?: { days: Record<string, unknown> }) => {
    switch (path) {
      case '/status': return { loggedIn: true };
      case '/schedules': return gateways();
      case '/schedules/assign': return { ok: true };
      case '/schedules/save': return { saved: Object.keys(body!.days), days: { ...days(), ...body!.days } };
      default: throw new Error(`unexpected ${path}`);
    }
  });
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  const dom = new JSDOM(`<body>${html}</body>`, {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.assign(window, {
        homebridge: {
          request, toast, showSpinner: vi.fn(), hideSpinner: vi.fn(), showSchemaForm: vi.fn(),
          getPluginConfig: vi.fn(async () => [{ platform: 'EasyControl' }]),
          updatePluginConfig: vi.fn(), savePluginConfig: vi.fn(),
        },
      });
    },
  });
  await vi.waitFor(() => expect(dom.window.document.querySelectorAll('.ec-day')).toHaveLength(7));
  const doc = dom.window.document;
  const change = (node: Element, value: string) => {
    (node as HTMLInputElement).value = value;
    node.dispatchEvent(new dom.window.Event('change'));
  };
  const day = (i: number) => doc.querySelectorAll('.ec-day')[i];
  return { doc, request, toast, change, day };
}

describe('schedule editor', () => {
  it('renders zones and every day of the schedule', async () => {
    const { doc, day } = await load();
    expect(doc.querySelector('.ec-zone')?.textContent).toContain('Kitchen');
    expect((doc.querySelector('.ec-zone select') as HTMLSelectElement).value).toBe('0');
    expect(day(0).querySelectorAll('.ec-point')).toHaveLength(4);
    expect(day(5).querySelectorAll('.ec-point')).toHaveLength(2);
    expect((doc.getElementById('save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves only the edited day, in time order', async () => {
    const { doc, request, toast, change, day } = await load();
    change(day(0).querySelectorAll('input[type=number]')[0], '21');        // Mon 07:00 -> 21 °C
    change(day(0).querySelectorAll('input[type=time]')[3], '06:00');       // Mon 23:00 -> 06:00, re-sorts
    expect(doc.getElementById('dirty')?.textContent).toBe('Unsaved changes: Monday');
    (doc.getElementById('save') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [, body] = request.mock.calls.find(([p]) => p === '/schedules/save')!;
    expect(body).toEqual({
      gatewayId: 'gw', program: 1,
      days: { monday: [{ t: 360, Th: 15, name: 0 }, { t: 420, Th: 21, name: 1 }, { t: 540, Th: 17, name: 2 }, { t: 1020, Th: 20, name: 3 }] },
    });
    expect((doc.getElementById('save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('copies a day to the weekend and can discard it', async () => {
    const { doc, change, day } = await load();
    change(day(0).querySelector('.ec-actions select')!, 'weekend');
    expect(day(6).querySelectorAll('.ec-point')).toHaveLength(4);
    expect(doc.getElementById('dirty')?.textContent).toBe('Unsaved changes: Saturday, Sunday');
    (doc.getElementById('revert') as HTMLButtonElement).click();
    expect(day(6).querySelectorAll('.ec-point')).toHaveLength(2);
  });

  it('adds and removes switch points within the limits', async () => {
    const { change, day } = await load();
    const add = () => (day(5).querySelector('.ec-actions button') as HTMLButtonElement);
    for (let i = 0; i < 4; i++) add().click();
    expect(day(5).querySelectorAll('.ec-point')).toHaveLength(6);
    expect(add().disabled).toBe(true);
    const times = [...day(5).querySelectorAll('input[type=time]')].map((n) => (n as HTMLInputElement).value);
    expect(new Set(times).size).toBe(6);
    (day(6).querySelector('.ec-point button') as HTMLButtonElement).click();
    expect(day(6).querySelectorAll('.ec-point')).toHaveLength(1);
    expect((day(6).querySelector('.ec-point button') as HTMLButtonElement).disabled).toBe(true);
    void change;
  });

  it('assigns a schedule to a zone', async () => {
    const { doc, request, change } = await load();
    change(doc.querySelector('.ec-zone select')!, '1');
    (doc.querySelector('.ec-zone button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('/schedules/assign', { gatewayId: 'gw', zone: 'zn1', program: 1 }));
  });
});
