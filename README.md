# GL.iNet Router Integration for Home Assistant

A [HACS](https://hacs.xyz/) custom integration that exposes your GL.iNet router's **repeater** (Wi-Fi client) functionality in Home Assistant. See what network the router is connected to, scan for available networks, and switch connections — all from the HA UI or automations.

Works with any GL.iNet router running firmware **4.x** (tested on GL-XE3000 / Puli AX).

## Features

- **Repeater SSID sensor** — shows the currently connected Wi-Fi network
- **Signal strength sensor** — reports signal level in dBm (updated after scans)
- **Scan button** — triggers a fresh Wi-Fi scan (takes 5-10 seconds)
- **Disconnect button** — disconnects from the current network
- **Network select** — pick a network from scan results to connect
- **`glinet.connect_wifi` service** — connect to any SSID with an optional password (for automations or new networks)

## Installation

### HACS (recommended)

1. Open HACS in Home Assistant
2. Go to **Integrations** → three-dot menu → **Custom repositories**
3. Add this repository URL, category **Integration**
4. Search for "GL.iNet Router" and install
5. Restart Home Assistant

### Manual

1. Copy `custom_components/glinet/` into your Home Assistant `config/custom_components/` directory
2. Restart Home Assistant

## Configuration

1. Go to **Settings** → **Devices & Services** → **Add Integration**
2. Search for "GL.iNet Router"
3. Enter your router's IP address and admin password
4. The integration validates the connection during setup

## Entities

| Entity | Type | Description |
|--------|------|-------------|
| Repeater SSID | Sensor | Currently connected Wi-Fi SSID |
| Repeater Signal | Sensor | Signal strength (dBm) of connected network |
| Scan Wi-Fi | Button | Trigger a fresh network scan |
| Disconnect Wi-Fi | Button | Disconnect repeater from current AP |
| Repeater Network | Select | Pick a scanned network to connect to |

## Services

### `glinet.connect_wifi`

Connect to a Wi-Fi network by SSID with an optional password.

| Field | Required | Description |
|-------|----------|-------------|
| `ssid` | Yes | Network name to connect to |
| `key` | No | Network password (omit for saved/open networks) |

Example automation:
```yaml
service: glinet.connect_wifi
data:
  ssid: "MyNetwork"
  key: "my-password"
```

## How It Works

The integration communicates with the GL.iNet router via its local JSON-RPC API (HTTP, port 80). Authentication uses a challenge-response flow with SHA-256 crypt. All API calls are synchronous (urllib) wrapped in Home Assistant's executor for async compatibility.

The coordinator polls the router every 60 seconds for lightweight status (saved networks, config). Wi-Fi scans are only triggered manually via the button entity since they take 5-10 seconds and temporarily block the radio.

## Requirements

- GL.iNet router running firmware 4.x
- Router accessible on the local network via HTTP
- Admin password for the router
