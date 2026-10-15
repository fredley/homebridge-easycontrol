import type { PlatformConfig } from 'homebridge';

import type { SetpointBehaviour } from './model.js';

export const PLUGIN_NAME = 'homebridge-homecom';
export const PLATFORM_NAME = 'HomeComPlatform';

export interface HomeComConfig extends PlatformConfig {
  pollInterval?: number; // seconds
  setpointBehaviour?: SetpointBehaviour;
  boostTemperature?: number;
  boostDuration?: number; // hours
  showOutdoorTemperature?: boolean;
  showAway?: boolean;
  showBoost?: boolean;
}

export const DEFAULT_POLL_SECONDS = 60;
export const MIN_POLL_SECONDS = 30;
export const REFRESH_AFTER_WRITE_MS = 4000;

export const tokenPath = (storagePath: string) => `${storagePath}/homecom/tokens.json`;
