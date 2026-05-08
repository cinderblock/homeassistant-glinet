# GL.iNet Router HACS Integration Plan

## Goal

Build a Home Assistant custom integration (HACS-compatible) that exposes a GL.iNet router's **repeater** (Wi-Fi client) functionality. Users should be able to see what Wi-Fi network the router is connected to, scan for available networks, and connect to a different one — all from the HA UI.

The router in question is a **GL-XE3000** (Puli AX) running firmware **v4.0**, but the API is common to all GL.iNet 4.x routers, so the integration should be generic.

## Environment / Context

- **Router IP**: 172.16.17.1 (configurable; was 192.168.8.1 earlier)
- **Home Assistant instance**: 172.16.17.162
- **Router admin credentials**: root / Pasword222
- **Working directory**: `C:\Users\camer\git\Personal Projects\homeassistant-glinet`
- **API client library**: already built and tested at `C:\Users\camer\git\Clients\SOS\glinet_api.py` — copy and adapt into the integration
- **Python dependency**: `passlib` (for SHA-256 crypt in the auth flow)

## GL.iNet 4.x JSON-RPC API Reference

All calls go to `POST http://<router_ip>/rpc` with `Content-Type: application/json`. Current router IP is **172.16.17.1**.

### Authentication (challenge-response)

Must complete within ~2 seconds (nonce expires).

**Step 1 — Challenge:**
```json
{"jsonrpc":"2.0","id":1,"method":"challenge","params":{"username":"root"}}
```
Response:
```json
{"result":{"alg":5,"salt":"T4u4h0MEBa8qpJJT","nonce":"<random>","hash-method":"sha256"}}
```

**Step 2 — Compute hash:**
```python
from passlib.hash import sha256_crypt
import hashlib

cipher = sha256_crypt.using(salt=salt, rounds=5000).hash(password)
login_hash = hashlib.sha256(f"{username}:{cipher}:{nonce}".encode()).hexdigest()
```

**Step 3 — Login:**
```json
{"jsonrpc":"2.0","id":2,"method":"login","params":{"username":"root","hash":"<login_hash>"}}
```
Response:
```json
{"result":{"sid":"<session_token>","username":"root"}}
```

### Authenticated API Calls

Format: `{"jsonrpc":"2.0","id":N,"method":"call","params":["<sid>","<namespace>","<method>",{<args>}]}`

On token expiry, the router returns `{"error":{"code":-32000,"message":"Access denied"}}`. Re-authenticate and retry.

### Repeater Methods (namespace: "repeater")

| Method | Args | Returns | Notes |
|--------|------|---------|-------|
| `scan` | `{"all_band":true,"refresh":true}` | `{"res":[...networks...]}` | Takes 5-10s. Returns list of APs. |
| `connect` | `{"ssid":"...","key":"...","bssid":"","band":"","channel":0}` | TBD (not yet tested live) | Joins a network. Router may lose connectivity briefly. |
| `disconnect` | `{}` | TBD | Disconnects from current AP. |
| `get_saved_ap_list` | `{}` | `{"res":[...saved...]}` | Saved networks with passwords. |
| `remove_saved_ap` | `{"ssid":"..."}` | TBD | Forgets a saved network. |
| `get_config` | `{}` | `{"dfs_support":true,"macaddr":"...","auto":true,"smart_reconnect":true}` | Repeater module config. |
| `set_config` | TBD | TBD | |

### Scan Result Shape
```json
{
  "ssid": "NetworkName",
  "bssid": "fa:e2:c6:ff:8e:66",
  "channel": 1,
  "signal": -62,
  "encryption": {"enabled": true, "description": "SAE"},
  "band": "2g"
}
```

### Saved AP Shape
```json
{
  "manual": false,
  "ssid": "Tom Sawyer Labs",
  "auto_portal": false,
  "key": "DoTheMath",
  "disguise": false,
  "macaddr": {"mode": "default", "update": "none"},
  "protocol": "dhcp"
}
```

### Other Useful Methods

| Namespace | Method | Notes |
|-----------|--------|-------|
| `system` | `get_status` | System info, uptime, model name |
| `clients` | `get_list` | Connected clients |
| `modem` | `get_status` | Cellular modem info |

## Decisions Already Made

- **HACS custom integration** (not shell commands or REST sensors) — best UX, publishable.
- **Domain name**: `glinet` — short, clear, matches the brand.
- **Config flow UI** — no YAML configuration. User enters host, username, password in the UI.
- **DataUpdateCoordinator** pattern — standard HA polling approach.
- **`passlib` as a pip dependency** in `manifest.json` — required for the SHA-256 crypt auth.
- **The final auth hash is SHA-256** (not MD5 as some online docs incorrectly state). Do not change this.

## File Structure

```
homeassistant-glinet/
├── custom_components/
│   └── glinet/
│       ├── __init__.py          # async_setup_entry, coordinator setup
│       ├── manifest.json        # integration metadata
│       ├── const.py             # DOMAIN, defaults, keys
│       ├── config_flow.py       # UI-based setup (host, user, password)
│       ├── api.py               # GlInetApi class (adapted from glinet_api.py)
│       ├── coordinator.py       # DataUpdateCoordinator subclass
│       ├── sensor.py            # Sensor entities (SSID, signal, band, IP)
│       ├── select.py            # Select entity (pick network to join)
│       ├── button.py            # Button entities (scan, disconnect)
│       ├── strings.json         # Config flow translations
│       └── translations/
│           └── en.json          # English translations
├── hacs.json
├── README.md
└── plans/
    └── hacs-integration.md      # This file
```

## Entities to Create

### Sensors
| Entity ID | Name | State | Attributes | Update |
|-----------|------|-------|------------|--------|
| `sensor.glinet_repeater_ssid` | Repeater SSID | Current SSID or "Disconnected" | bssid, band, channel, signal, ip_address, gateway, dns | Coordinator poll (60s) |
| `sensor.glinet_repeater_signal` | Repeater Signal | Signal strength (dBm) or "unknown" | — | Coordinator poll |

### Select
| Entity ID | Name | Options | Behavior |
|-----------|------|---------|----------|
| `select.glinet_repeater_network` | Repeater Network | List of scanned SSIDs (deduplicated) | On select: if network is saved (has key), connect directly. If unknown, user needs to provide key — set up a service call or use a companion text input. |

### Buttons
| Entity ID | Name | Behavior |
|-----------|------|----------|
| `button.glinet_repeater_scan` | Scan Wi-Fi | Triggers a fresh scan, updates the select entity's options |
| `button.glinet_repeater_disconnect` | Disconnect Wi-Fi | Disconnects repeater from current AP |

### Services (custom)
| Service | Fields | Behavior |
|---------|--------|----------|
| `glinet.connect_wifi` | `ssid` (required), `key` (optional) | Connect to a specific SSID with optional password |

The custom service is important because the Select entity alone can't handle the password for new networks. The service gives automations and the UI (via Developer Tools > Services or a Lovelace card) full control.

## Coordinator Design

```python
class GlInetCoordinator(DataUpdateCoordinator):
    """Polls the router for repeater status and scan results."""

    def __init__(self, hass, api: GlInetApi):
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=timedelta(seconds=60))
        self.api = api
        self.scan_results: list[dict] = []
        self.saved_networks: list[dict] = []
        self.repeater_config: dict = {}
        # The "status" data (current connection) comes from system/get_status
        # or from the repeater connection info on the internet page.

    async def _async_update_data(self):
        """Fetch repeater status. Scans are triggered manually via button."""
        def _fetch():
            config = self.api.repeater_get_config()
            saved = self.api.repeater_saved_networks()
            return {"config": config, "saved": saved}
        return await self.hass.async_add_executor_job(_fetch)

    async def async_scan(self):
        """Trigger a Wi-Fi scan (called by the scan button)."""
        def _scan():
            return self.api.repeater_scan()
        self.scan_results = await self.hass.async_add_executor_job(_scan)
        self.async_set_updated_data(self.data)  # Notify entities
```

## Config Flow Design

**Step 1 (user):** Form with fields: host (default 172.16.17.1), password (required). Username is always "root" (can be hidden or shown as advanced).

**Validation:** Attempt a login during config flow. If it fails, show the error. If it succeeds, create the config entry.

**Unique ID:** Use the router's MAC address or model+host as unique_id to prevent duplicate entries.

## Plan / Steps

1. **Initialize the repo** — `git init`, create directory structure, write `hacs.json`, `manifest.json`
2. **Copy and adapt `api.py`** from `C:\Users\camer\git\Clients\SOS\glinet_api.py` — make it async-friendly (sync methods called via `async_add_executor_job`)
3. **Write `const.py`** — DOMAIN, config keys, defaults
4. **Write `config_flow.py`** — UI setup with host + password, login validation
5. **Write `strings.json` + `translations/en.json`** — config flow text
6. **Write `coordinator.py`** — DataUpdateCoordinator with polling and scan trigger
7. **Write `__init__.py`** — setup/unload entry, register service
8. **Write `sensor.py`** — SSID and signal sensors
9. **Write `button.py`** — scan and disconnect buttons
10. **Write `select.py`** — network picker (populated by scan results)
11. **Register the `glinet.connect_wifi` service** in `__init__.py`
12. **Write `README.md`** — installation, configuration, usage
13. **Test** by copying `custom_components/glinet/` to the HA instance at 172.16.17.162
14. **Iterate** on entity behavior and error handling

## Gotchas / Things Not To Do

- **Auth hash is SHA-256**, not MD5. Some online docs are wrong. Do not change this.
- **Nonce expires in ~2 seconds.** Challenge + hash + login must be a single fast burst. Don't add any I/O between them.
- **Don't spam login attempts.** The router rate-limits after ~5 failures and locks out for up to 600 seconds. Re-auth only on token expiry (-32000 error), not proactively.
- **Scan takes 5-10 seconds.** Don't put it in the coordinator's regular poll — make it a manual trigger (button entity). The coordinator polls `repeater.get_status` + `system.get_status` (lightweight).
- **The `connect` API hasn't been fully tested live** (we avoided disrupting the active connection). The params format is based on what the web UI sends. Test carefully.
- **`passlib` must be in `manifest.json` requirements** — HA will pip-install it automatically.
- **All API calls are synchronous** (urllib). Wrap them in `async_add_executor_job()` in the HA integration. Don't try to rewrite the API client with aiohttp — the challenge-response timing is tight and simpler with synchronous urllib.
- **`register_static_path` no longer exists** in modern HA — use `await hass.http.async_register_static_paths([StaticPathConfig(...)])` from `homeassistant.components.http`. Fixed in commit f4cf9ce.
- **`frontend_extra_module_url` is a `UrlManager`, not a set** — don't use `in` operator. Use `hass.data.get(f"{DOMAIN}_card_registered")` flag. Fixed in commit ecb26ff.
- **Custom card JS must be loaded as `js` type, not `module`** when registered as a Lovelace resource. The `add_extra_js_url` call alone is not sufficient for user-created dashboards. Register via `lovelace/resources/create` with `res_type: 'js'`.
- **Browser caches card JS aggressively** — after HACS update + HA restart, a hard page reload (Ctrl+Shift+R) is needed to pick up new JS. Hot-patching the prototype via JS injection works momentarily but HA's `set hass()` re-renders from the originally loaded class.
- **`repeater.get_status`** returns rich live data: IP (with CIDR), MAC, gateway, DNS, BSSID, signal, SSID, channel, connected time, state. Much better than deriving status from saved networks list.
- **`system.get_status`** returns network interface up/online states, LAN IP, Wi-Fi AP config, CPU temp, memory, battery (MCU), uptime. Interface list includes wan, wwan, tethering, modem, secondwan (and IPv6 variants).

## Findings / Progress Log

- [x] All integration files written and committed
- [x] Pushed to GitHub under `cinderblock/homeassistant-glinet`
- [x] Added to HACS, downloaded, configured with router at 172.16.17.1
- [x] Fixed `register_static_path` → `async_register_static_paths` (commit f4cf9ce)
- [x] Fixed `UrlManager` not-iterable error (commit ecb26ff)
- [x] Integration loads successfully — all 5 entities created:
  - `sensor.gl_inet_router_172_16_17_1_repeater_ssid` → "Tom Sawyer Labs"
  - `sensor.gl_inet_router_172_16_17_1_repeater_signal` → "-65 dBm"
  - `button.gl_inet_router_172_16_17_1_scan_wi_fi` → working
  - `button.gl_inet_router_172_16_17_1_disconnect_wi_fi` → working
  - `select.gl_inet_router_172_16_17_1_repeater_network` → "Tom Sawyer Labs"
- [x] Wi-Fi scan working — returns 20+ APs across 2g/5g bands
- [x] Custom Lovelace card rendering on "Network" dashboard with scan results, signal, bands, Join buttons, and Manual Connect form
- [x] Card JS resource registered as `js` type in Lovelace resources
- [x] Created "Network" dashboard with panel view showing the card
- [x] Deduplicate scan results — collapse same SSID+encryption, combine bands (commit 069a106)
- [x] Colored band pills (blue 2.4 GHz, purple 5 GHz) + band filter in scan results header
- [x] Condensed network list to single-line rows (commit 24ef9e4)
- [x] CSS Wi-Fi strength bars replacing block-character signal indicators
- [x] Removed "GL.iNet Repeater" title bar
- [x] Added `repeater.get_status` and `system.get_status` to coordinator poll — live IP, MAC, gateway, uptime, channel, signal (commit 802e714)
- [x] Status section now shows IP address, MAC, gateway, uptime, channel
- [x] Active WAN interfaces displayed with status dots (online/up/down)
- [x] Signal sensor now uses live `repeater_status` instead of scan-result matching
- [x] Full network overview dashboard: WAN sources, connected clients, Wi-Fi radios, services, cellular, system stats (commit b7bc39b)
- [x] Layout rearranged: sys stats bar → top, Services (left) ↔ Wi-Fi Radios (right), repeater details below grids (commit ddc6d48)
- [x] VPN client status via `vpn-client.get_status` API — shows WireGuard/OpenVPN tunnel name, IP, endpoint, TX/RX (commit ddc6d48)
- [x] Scan list uses grid columns for aligned data; current network shown as disabled "Current" button (commit ddc6d48)
- [x] Band labels use "2.4 GHz" / "5 GHz" format throughout (commit 31dc9d0)
- **HACS Python caching**: supervisor container restart (`/homeassistant/restart` via supervisor API) is more reliable than `homeassistant/restart` for picking up Python file changes. `homeassistant/restart` alone may not clear bytecache on HA OS installations.

## Open Questions

1. ~~How to handle `connect` when the target network needs a password the router doesn't have saved?~~ **Resolved**: The `glinet.connect_wifi` service accepts a `key` field, and the custom Lovelace card has a Manual Connect form with SSID and password inputs.
2. ~~Should we expose the cellular/modem status too, or keep scope to repeater only for v1?~~ **Resolved**: Full dashboard now includes cellular modem stats (APN, traffic, SMS count, IMEI) and VPN client tunnels.
3. ~~What's the HA custom_components path on the instance at 172.16.17.162?~~ **Resolved**: `/config/custom_components/` — HACS handles this automatically.
