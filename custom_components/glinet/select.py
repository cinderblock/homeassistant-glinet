"""Select entity for GL.iNet Router integration — network picker."""

from __future__ import annotations

import logging

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import GlInetCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up GL.iNet select entities."""
    coordinator: GlInetCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([GlInetNetworkSelect(coordinator, entry)])


class GlInetNetworkSelect(CoordinatorEntity[GlInetCoordinator], SelectEntity):
    """Select entity populated by scan results.

    Selecting a network connects to it if a saved password exists.
    For new networks (no saved key), use the glinet.connect_wifi service instead.
    """

    _attr_has_entity_name = True
    _attr_name = "Repeater Network"
    _attr_icon = "mdi:wifi-cog"

    def __init__(self, coordinator: GlInetCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_repeater_network"
        self._attr_device_info = _device_info(entry)

    @property
    def options(self) -> list[str]:
        """Return deduplicated list of SSIDs from the last scan."""
        seen: set[str] = set()
        result: list[str] = []
        for net in self.coordinator.scan_results:
            ssid = net.get("ssid", "")
            if ssid and ssid not in seen:
                seen.add(ssid)
                result.append(ssid)
        return result if result else ["(scan first)"]

    @property
    def current_option(self) -> str | None:
        """Return the currently connected SSID."""
        rs = self.coordinator.data.get("repeater_status", {})
        if rs.get("running") and rs.get("ssid"):
            ssid = rs["ssid"]
            if ssid in self.options:
                return ssid
        return None

    @property
    def extra_state_attributes(self) -> dict:
        """Expose deduplicated scan results for the Lovelace card.

        Multiple BSSIDs for the same SSID+encryption are collapsed into one
        entry with the best signal and a combined band list (e.g. "2g / 5g").
        """
        grouped: dict[tuple[str, str], dict] = {}
        for net in self.coordinator.scan_results:
            ssid = net.get("ssid", "")
            if not ssid:
                continue
            encryption = net.get("encryption", {}).get("description", "")
            key = (ssid, encryption)
            signal = net.get("signal")
            band = net.get("band", "")

            if key not in grouped:
                grouped[key] = {
                    "ssid": ssid,
                    "signal": signal,
                    "bands": {band} if band else set(),
                    "encryption": encryption,
                }
            else:
                entry = grouped[key]
                if signal is not None and (
                    entry["signal"] is None or signal > entry["signal"]
                ):
                    entry["signal"] = signal
                if band:
                    entry["bands"].add(band)

        networks = []
        for entry in grouped.values():
            bands = sorted(entry["bands"])
            networks.append(
                {
                    "ssid": entry["ssid"],
                    "signal": entry["signal"],
                    "band": " / ".join(bands) if bands else None,
                    "encryption": entry["encryption"],
                }
            )
        # Repeater connection details
        rs = self.coordinator.data.get("repeater_status", {})
        ipv4 = rs.get("ipv4", {}) if rs.get("running") else {}
        repeater_info = {
            "ip_address": ipv4.get("ip"),
            "gateway": ipv4.get("gateway"),
            "dns": ipv4.get("dns"),
            "macaddr": rs.get("macaddr"),
            "bssid": rs.get("bssid"),
            "channel": rs.get("channel"),
            "connected": rs.get("connected"),
        } if rs.get("running") else {}

        # WAN interface statuses from system status
        sys_status = self.coordinator.data.get("system_status", {})
        wan_interfaces = []
        for iface in sys_status.get("network", []):
            wan_interfaces.append({
                "interface": iface.get("interface"),
                "up": iface.get("up"),
                "online": iface.get("online"),
            })
        lan_ip = sys_status.get("system", {}).get("lan_ip")

        # Connected clients
        clients_raw = self.coordinator.data.get("clients", [])
        clients = [
            {
                "name": c.get("alias") or c.get("name", ""),
                "ip": c.get("ip"),
                "mac": c.get("mac"),
                "iface": c.get("iface"),
                "online": c.get("online"),
            }
            for c in clients_raw
        ]

        # Cellular modem
        modem_status = self.coordinator.data.get("modem_status", {})
        modem_info_raw = self.coordinator.data.get("modem_info", {})
        modem_config = self.coordinator.data.get("modem_config", {})
        modems = modem_status.get("modems", [])
        modem_hw = modem_info_raw.get("modems", [{}])[0] if modem_info_raw.get("modems") else {}
        modem_info = {}
        if modem_hw:
            modem_info = {
                "model": modem_hw.get("name"),
                "imei": modem_hw.get("imei"),
                "firmware": modem_hw.get("version"),
                "apn": modem_config.get("apn"),
                "traffic_bytes": int(modems[0]["network"]["traffic_total"]) if modems and modems[0].get("network", {}).get("traffic_total") else None,
                "sms_unread": modem_status.get("new_sms_count"),
                "sim": modems[0].get("current_sim") if modems else None,
            }

        # VPN / services
        services = sys_status.get("service", [])
        vpn_services = [
            {"name": s.get("name"), "active": s.get("status") != 0}
            for s in services
        ]

        # Wi-Fi radios
        wifi_radios = [
            {
                "band": w.get("band"),
                "ssid": w.get("ssid"),
                "up": w.get("up"),
                "guest": w.get("guest"),
                "hidden": w.get("hidden"),
                "name": w.get("name"),
            }
            for w in sys_status.get("wifi", [])
        ]

        # System stats
        sys_info = sys_status.get("system", {})
        mcu = sys_info.get("mcu", {})
        system_stats = {
            "cpu_temp": sys_info.get("cpu", {}).get("temperature"),
            "battery_percent": mcu.get("charge_percent"),
            "battery_charging": mcu.get("charging_status", 0) != 0,
            "memory_total": sys_info.get("memory_total"),
            "memory_free": sys_info.get("memory_free"),
            "uptime": sys_info.get("uptime"),
            "lan_ip": sys_info.get("lan_ip"),
            "lan_netmask": sys_info.get("lan_netmask"),
        }

        # Client summary from system status
        client_summary = sys_status.get("client", [{}])[0] if sys_status.get("client") else {}

        return {
            "scan_results": networks,
            "repeater_info": repeater_info,
            "wan_interfaces": wan_interfaces,
            "lan_ip": lan_ip,
            "clients": clients,
            "client_summary": client_summary,
            "modem_info": modem_info,
            "vpn_services": vpn_services,
            "wifi_radios": wifi_radios,
            "system_stats": system_stats,
        }

    async def async_select_option(self, option: str) -> None:
        """Connect to the selected network."""
        if option == "(scan first)":
            return

        # Check if we have a saved key for this network
        saved = self.coordinator.data.get("saved", [])
        key = ""
        for net in saved:
            if net.get("ssid") == option:
                key = net.get("key", "")
                break

        _LOGGER.info("Connecting to Wi-Fi network: %s", option)
        await self.coordinator.async_connect(option, key)


def _device_info(entry: ConfigEntry) -> dict:
    """Return device info for grouping entities."""
    return {
        "identifiers": {(DOMAIN, entry.entry_id)},
        "name": f"GL.iNet Router ({entry.data['host']})",
        "manufacturer": "GL.iNet",
    }
