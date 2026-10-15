# homebridge-homecom

Homebridge plugin for the **Bosch EasyControl CT200** thermostat, using the cloud API behind Bosch's HomeCom Easy and EasyControl apps (the "POINTT" API).

It replaces the XMPP-based CT200 plugins. Those can't log in to accounts migrated to Bosch SingleKey ID.

> **Unofficial.** This API isn't documented by Bosch. The plugin uses the HomeCom app's public OAuth client, and Bosch can change or block it at any time. The CT200 has no local API, so the plugin needs internet access, and HomeKit sees changes made elsewhere only on the next poll.

## What you get

- **Thermostat** per zone:
  - current and target temperature
  - indoor humidity
  - heating / idle
  - Auto (follow the schedule) or Heat (manual)
- **Outdoor temperature** sensor. This value comes from the weather service Bosch uses.
- **Away** switch.
- **Boost** switch, with optional temperature and duration overrides.

When you change the target temperature while the zone follows its schedule, the plugin sets a temporary override by default. The override lasts until the next switch point, the same as turning the dial on the thermostat. To switch the zone to manual mode instead, set **Changing the temperature while on the schedule** to "Switch the zone to manual mode".

## Setup

1. Install the plugin and open its settings in the Homebridge UI.
2. Click **Open Bosch login** and sign in with your SingleKey ID. Before you sign in, open the browser's developer tools on the Network tab and tick **Preserve log**.
3. After you sign in, the browser tries to open a `com.bosch.tt.dashtt.pointt://app/login?code=…` link and fails. Find the `authorize/callback` request in the Network tab and copy its `Location` response header.
4. Paste that URL into the plugin settings and click **Complete login**. The code expires after a few minutes.
5. Restart the child bridge.

The plugin stores tokens in `<homebridge storage>/homecom/tokens.json` and refreshes them automatically. Bosch's refresh tokens are single-use, so don't copy this file to a second Homebridge instance. Each instance needs its own login.

## Development

```sh
npm install
npm test             # unit tests
npm run build
npm run login        # CLI login -> .tokens.json (two steps; follow the prompts)
npm run probe        # read-only dump of every gateway resource to fixtures/ (contains personal data, git-ignored)
npx homebridge -D -I -U ./test-hb -P .   # run against test-hb/ (put tokens in test-hb/homecom/tokens.json)
```

## Credits

The API details come from [serbanb11/homecom_alt](https://github.com/serbanb11/homecom_alt) and [CaseyRo/ha_bosch](https://github.com/CaseyRo/ha_bosch).
