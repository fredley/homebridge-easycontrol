// Read-only discovery against the live account: lists gateways, then walks the
// RRC2 resource tree and writes each payload to fixtures/<deviceId>/.
import { mkdir, writeFile } from 'node:fs/promises';

import { TokenStore } from '../src/api/tokenStore.js';

const API = 'https://pointt-api.bosch-thermotechnology.com/pointt-api/api/v1/';
const store = new TokenStore(process.env.HOMECOM_TOKENS ?? '.tokens.json');

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${await store.accessToken()}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch { /* leave as text */ }
  return { status: res.status, body };
}

const ROOTS = [
  '/gateway', '/zones', '/system', '/system/sensors', '/system/awayMode/enabled',
  '/heatingCircuits', '/heatingCircuits/hc1', '/dhwCircuits', '/dhwCircuits/dhw1',
  '/heatSources', '/devices', '/devices/list', '/notifications',
];

const gateways = await get('gateways/');
console.log('gateways/', gateways.status, JSON.stringify(gateways.body));
const list = gateways.body as { deviceId: string; deviceType: string }[];
const gw = list.find((g) => g.deviceType === 'rrc2') ?? list[0];
if (!gw) {
  throw new Error('No gateways on this account');
}

const outDir = `fixtures/${gw.deviceId}`;
await mkdir(outDir, { recursive: true });
const seen = new Set<string>();
const queue = [...ROOTS];
const MAX_DEPTH = 4;

while (queue.length) {
  const path = queue.shift()!;
  if (seen.has(path) || path.split('/').length > MAX_DEPTH + 1) {
    continue;
  }
  seen.add(path);
  const { status, body } = await get(`gateways/${gw.deviceId}/resource${path}`);
  const b = body as { type?: string; value?: unknown; references?: { id: string }[] };
  const summary = b?.type === 'refEnum' ? `refEnum[${b.references?.length}]` : JSON.stringify(b?.value ?? body).slice(0, 80);
  console.log(String(status).padEnd(4), path.padEnd(55), b?.type ?? '', summary);
  await writeFile(`${outDir}/${path.replaceAll('/', '__')}.json`, JSON.stringify({ status, body }, null, 2));
  if (b?.type === 'refEnum') {
    for (const ref of b.references ?? []) {
      queue.push(ref.id);
    }
  }
}
console.log(`\nWrote ${seen.size} resources to ${outDir}/`);
